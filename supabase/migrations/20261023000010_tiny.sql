-- =============================================================================
-- Venner Gestão · Leitura automática do Tiny (Olist ERP)
-- O sistema só LÊ o Tiny: pedidos de venda, contas a receber, contas a pagar,
-- categorias, contas financeiras, clientes, fornecedores e produtos citados.
-- A cada 5 minutos o próprio banco (pg_cron + pg_net) chama o endereço
-- /integracoes/robo do sistema, que busca no Tiny o que mudou e grava aqui pelas
-- funções robo_tiny_*. As chaves do aplicativo do Tiny são coladas numa tela do
-- sistema e ficam em tabela sem acesso direto (só funções conferindo o perfil).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Chaves do aplicativo criado no Tiny (Client ID e Client Secret). Cada CNPJ
-- tem a sua conta no Tiny, e o aplicativo é criado dentro de cada conta.
-- -----------------------------------------------------------------------------
create table public.integracoes_aplicativos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  canal text not null check (canal in ('tiny')),
  client_id text not null,
  client_secret text not null,
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, canal)
);
alter table public.integracoes_aplicativos enable row level security;
revoke all on public.integracoes_aplicativos from anon, authenticated;

-- Auditoria sem as chaves (nem tokens nem o segredo do aplicativo).
create or replace function public.auditar_integracao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.auditoria (tabela, registro_id, acao, dados_antes, dados_depois, usuario_id)
  values (tg_table_name, coalesce(new.id, old.id)::text, tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'access_token' - 'refresh_token' - 'client_secret' end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'access_token' - 'refresh_token' - 'client_secret' end,
    (select auth.uid()));
  return coalesce(new, old);
end;
$$;

create trigger auditoria after insert or update or delete on public.integracoes_aplicativos
  for each row execute function public.auditar_integracao();

alter table public.integracoes_plataforma drop constraint integracoes_plataforma_canal_check;
alter table public.integracoes_plataforma add constraint integracoes_plataforma_canal_check
  check (canal in ('mercado_livre', 'shopee', 'tiny'));

-- -----------------------------------------------------------------------------
-- Estado da leitura automática de cada conta ligada (sem auditoria: muda a
-- cada 5 minutos). chave = senha gerada pelo banco que o robô apresenta.
-- -----------------------------------------------------------------------------
create table public.integracao_robo (
  integracao_id uuid primary key references public.integracoes_plataforma(id) on delete cascade,
  chave text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  -- Endereço público do sistema (para o banco chamar o robô).
  endereco text,
  -- Até quando ler também as contas a pagar (carga inicial: depois as despesas
  -- são lançadas só aqui). Vazio = não lê.
  ler_pagar_ate date default '2026-11-02',
  estado jsonb not null default '{}',
  executando_ate timestamptz,
  executado_em timestamptz,
  ok_em timestamptz,
  ultimo_erro text,
  resumo jsonb
);
alter table public.integracao_robo enable row level security;
revoke all on public.integracao_robo from anon, authenticated;

-- Registros vistos nas listagens do Tiny; pendente = falta ler o detalhe.
create table public.integracao_fila (
  integracao_id uuid not null references public.integracoes_plataforma(id) on delete cascade,
  tipo text not null check (tipo in ('receber', 'pagar', 'pedido', 'produto')),
  id_externo bigint not null,
  assinatura text,
  pendente boolean not null default true,
  tentativas integer not null default 0,
  erro text,
  visto_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (integracao_id, tipo, id_externo)
);
create index integracao_fila_pendente_idx on public.integracao_fila (integracao_id, pendente);
alter table public.integracao_fila enable row level security;
revoke all on public.integracao_fila from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Número do registro no Tiny em cada cadastro e título (não repete na leitura).
-- -----------------------------------------------------------------------------
alter table public.plano_contas add column tiny_id bigint unique;
alter table public.contas_bancarias add column tiny_id bigint unique;
alter table public.clientes add column tiny_id bigint unique;
alter table public.fornecedores add column tiny_id bigint unique;

-- Endereço e inscrição estadual (para emitir pedido e NF a partir daqui).
do $$
declare
  t text;
begin
  foreach t in array array['clientes', 'fornecedores'] loop
    execute format('alter table public.%I
      add column inscricao_estadual text,
      add column celular text,
      add column logradouro text,
      add column numero text,
      add column complemento text,
      add column bairro text,
      add column cep text check (cep ~ ''^\d{8}$'')', t);
  end loop;
end;
$$;
alter table public.itens add column tiny_id bigint unique;
alter table public.contas_receber add column tiny_id bigint unique;
alter table public.contas_pagar add column tiny_id bigint unique;
alter table public.pedidos_venda
  add column tiny_id bigint unique,
  -- Número da nota fiscal emitida para o pedido.
  add column nota_fiscal text,
  -- Vendedor como está no Tiny (enquanto não tem usuário aqui).
  add column vendedor_externo text,
  add column valor_frete numeric(14, 2) not null default 0 check (valor_frete >= 0),
  add column valor_desconto numeric(14, 2) not null default 0 check (valor_desconto >= 0),
  add column transportadora text,
  -- Cópia do pedido como veio do Tiny (parcelas, natureza de operação,
  -- lista de preço, endereço de entrega...), para a revisão da tela de pedidos.
  add column dados_tiny jsonb;

-- -----------------------------------------------------------------------------
-- Funções internas da leitura (ninguém chama direto).
-- -----------------------------------------------------------------------------

-- Cliente ou fornecedor do Tiny: pelo número no Tiny, depois pelo CPF/CNPJ,
-- senão cria. Só preenche o que estiver vazio (o que foi editado aqui vale).
create function public.tiny_pessoa(tabela text, c jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  achado uuid;
  doc text := nullif(regexp_replace(coalesce(c ->> 'documento', ''), '\D', '', 'g'), '');
  tipo public.tipo_pessoa;
  nome text := coalesce(nullif(trim(c ->> 'nome'), ''), 'Contato Tiny nº ' || (c ->> 'id'));
  uf text := upper(nullif(trim(c ->> 'uf'), ''));
  cep text := nullif(regexp_replace(coalesce(c ->> 'cep', ''), '\D', '', 'g'), '');
begin
  if c is null or jsonb_typeof(c) <> 'object' or c ->> 'id' is null then
    return null;
  end if;
  if tabela not in ('clientes', 'fornecedores') then
    raise exception 'Cadastro desconhecido: %', tabela;
  end if;
  if doc is not null and length(doc) not in (11, 14) then
    doc := null;
  end if;
  tipo := case when length(doc) = 11 then 'fisica' else 'juridica' end;
  if uf !~ '^[A-Z]{2}$' then
    uf := null;
  end if;
  if cep !~ '^\d{8}$' then
    cep := null;
  end if;

  execute format('select id from public.%I where tiny_id = $1', tabela) into achado using (c ->> 'id')::bigint;
  if achado is null and doc is not null then
    execute format('select id from public.%I where documento = $1', tabela) into achado using doc;
  end if;
  if achado is null then
    execute format(
      'insert into public.%I (tipo_pessoa, documento, nome, nome_fantasia, email, telefone, cidade, uf, tiny_id,
         inscricao_estadual, celular, logradouro, numero, complemento, bairro, cep)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id', tabela)
    into achado
    using tipo, doc, nome, nullif(trim(c ->> 'fantasia'), ''), nullif(trim(c ->> 'email'), ''),
      nullif(trim(c ->> 'telefone'), ''), nullif(trim(c ->> 'cidade'), ''), uf, (c ->> 'id')::bigint,
      nullif(trim(c ->> 'ie'), ''), nullif(trim(c ->> 'celular'), ''), nullif(trim(c ->> 'logradouro'), ''),
      nullif(trim(c ->> 'numero'), ''), nullif(trim(c ->> 'complemento'), ''), nullif(trim(c ->> 'bairro'), ''), cep;
  else
    execute format(
      'update public.%I set tiny_id = coalesce(tiny_id, $2), nome_fantasia = coalesce(nome_fantasia, $3),
         email = coalesce(email, $4), telefone = coalesce(telefone, $5), cidade = coalesce(cidade, $6), uf = coalesce(uf, $7),
         inscricao_estadual = coalesce(inscricao_estadual, $8), celular = coalesce(celular, $9),
         logradouro = coalesce(logradouro, $10), numero = coalesce(numero, $11), complemento = coalesce(complemento, $12),
         bairro = coalesce(bairro, $13), cep = coalesce(cep, $14)
       where id = $1', tabela)
    using achado, (c ->> 'id')::bigint, nullif(trim(c ->> 'fantasia'), ''), nullif(trim(c ->> 'email'), ''),
      nullif(trim(c ->> 'telefone'), ''), nullif(trim(c ->> 'cidade'), ''), uf,
      nullif(trim(c ->> 'ie'), ''), nullif(trim(c ->> 'celular'), ''), nullif(trim(c ->> 'logradouro'), ''),
      nullif(trim(c ->> 'numero'), ''), nullif(trim(c ->> 'complemento'), ''), nullif(trim(c ->> 'bairro'), ''), cep;
  end if;
  return achado;
end;
$$;

-- Categoria do título: pelo número no Tiny, depois pelo nome; só a mais
-- detalhada e do tipo certo (receita no receber, despesa no pagar).
create function public.tiny_categoria(tiny bigint, nome text, tipo_titulo public.tipo_plano_conta)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.plano_contas c
  where (c.tiny_id = tiny or (c.tiny_id is null and lower(trim(c.nome)) = lower(trim(tiny_categoria.nome))))
    and c.tipo = tipo_titulo
    and not exists (select 1 from public.plano_contas f where f.pai_id = c.id)
  order by (c.tiny_id = tiny) desc nulls last
  limit 1;
$$;

-- Conta bancária de um pagamento/recebimento do Tiny; sem a conta, usa
-- "Tiny · conta não informada" da empresa.
create function public.tiny_conta(empresa uuid, tiny bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  achada uuid;
begin
  if tiny is not null then
    select id into achada from public.contas_bancarias where tiny_id = tiny and empresa_id = empresa;
  end if;
  if achada is null then
    select id into achada from public.contas_bancarias where empresa_id = empresa and nome = 'Tiny · conta não informada';
  end if;
  if achada is null then
    insert into public.contas_bancarias (empresa_id, nome, tipo) values (empresa, 'Tiny · conta não informada', 'corrente')
    returning id into achada;
  end if;
  return achada;
end;
$$;

-- Produto do pedido: pelo número no Tiny, depois pelo código (SKU); senão cria
-- o cadastro (unidade UN, custo zero) para completar depois.
create function public.tiny_item(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  achado uuid;
  cod text := coalesce(nullif(trim(p ->> 'sku'), ''), 'TINY-' || (p ->> 'produto_id'));
  un text := upper(nullif(trim(p ->> 'unidade'), ''));
begin
  if p ->> 'produto_id' is not null then
    select id into achado from public.itens where tiny_id = (p ->> 'produto_id')::bigint;
  end if;
  if achado is null then
    select id into achado from public.itens i where i.codigo = cod;
    if achado is not null and p ->> 'produto_id' is not null then
      update public.itens set tiny_id = (p ->> 'produto_id')::bigint where id = achado and tiny_id is null;
    end if;
  end if;
  if achado is null then
    if un is not null then
      insert into public.unidades (sigla, descricao) values (un, un) on conflict do nothing;
    end if;
    insert into public.itens (codigo, descricao, tipo, unidade, tiny_id)
    values (cod, coalesce(nullif(trim(p ->> 'descricao'), ''), cod),
      coalesce(nullif(p ->> 'tipo_item', ''), case when (p ->> 'servico')::boolean then 'servico' else 'produto_acabado' end)::public.tipo_item,
      coalesce(un, 'UN'), (p ->> 'produto_id')::bigint)
    returning id into achado;
  end if;
  -- Dados do cadastro do produto no Tiny: só completa o que está vazio aqui.
  update public.itens set
    preco_venda = case when preco_venda = 0 then greatest(0, coalesce((p ->> 'preco')::numeric, 0)) else preco_venda end,
    ncm = coalesce(ncm, case when regexp_replace(coalesce(p ->> 'ncm', ''), '\D', '', 'g') ~ '^\d{8}$'
                             then regexp_replace(p ->> 'ncm', '\D', '', 'g') end),
    peso_kg = coalesce(peso_kg, nullif((p ->> 'peso')::numeric, 0))
  where id = achado;
  return achado;
end;
$$;

-- Etapa do pedido conforme a situação no Tiny (pelo nome da etapa cadastrada).
create function public.tiny_etapa(situacao integer)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select id from public.etapas_pedido where ativa and nome = case situacao
      when 0 then 'Emitido'
      when 8 then 'Emitido'
      when 3 then 'Confirmado pelo cliente'
      when 4 then 'Embalagem'
      when 7 then 'Aguardando coleta'
      when 1 then 'Aguardando coleta'
      when 5 then 'Em trânsito'
      when 9 then 'Em trânsito'
      when 10 then 'Em trânsito'
      when 6 then 'Entregue'
      when 2 then 'Cancelado'
    end),
    (select id from public.etapas_pedido where ativa order by ordem limit 1));
$$;

-- Os itens dos pedidos que vêm do Tiny seguem o Tiny em qualquer etapa (a
-- leitura liga o aviso venner.leitura_tiny só durante a gravação).
create or replace function public.bloquear_itens_pedido()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fase_atual public.fase_pedido;
begin
  if current_setting('venner.leitura_tiny', true) = 'sim' then
    return coalesce(new, old);
  end if;
  select e.fase into fase_atual
  from public.pedidos_venda p join public.etapas_pedido e on e.id = p.etapa_id
  where p.id = coalesce(new.pedido_id, old.pedido_id);
  if fase_atual is not null and fase_atual <> 'negociacao' then
    raise exception 'Os itens só podem mudar enquanto o pedido está em negociação. Volte a etapa para alterar.';
  end if;
  return coalesce(new, old);
end;
$$;

-- Aplica um lote lido do Tiny. Formato no código em src/lib/tiny/tipos.ts.
create function public.tiny_aplicar(integracao uuid, lote jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  empresa uuid := (select empresa_id from public.integracoes_plataforma where id = integracao);
  desde date := coalesce((lote ->> 'historico_desde')::date, date '2026-01-01');
  x jsonb;
  t jsonb;
  grupo uuid;
  atual record;
  pessoa uuid;
  categoria uuid;
  pedido uuid;
  etapa uuid;
  sit public.situacao_titulo;
  quando date;
  pago numeric;
  obs text;
  num text;
  canal_ped text;
  r jsonb := '{"receber": 0, "pagar": 0, "pedidos": 0, "pulados": 0}';
begin
  if empresa is null then
    raise exception 'Integração não encontrada';
  end if;
  perform set_config('venner.leitura_tiny', 'sim', true);

  -- Contas financeiras do Tiny viram contas bancárias da empresa (pelo nome).
  for x in select * from jsonb_array_elements(coalesce(lote -> 'contas', '[]')) loop
    if not exists (select 1 from public.contas_bancarias where tiny_id = (x ->> 'id')::bigint) then
      update public.contas_bancarias set tiny_id = (x ->> 'id')::bigint
      where id = (select id from public.contas_bancarias
                  where empresa_id = empresa and tiny_id is null and lower(trim(nome)) = lower(trim(x ->> 'descricao')) limit 1);
      if not found then
        insert into public.contas_bancarias (empresa_id, nome, tipo, ativa, tiny_id)
        values (empresa, left(trim(x ->> 'descricao'), 120),
          case when x ->> 'descricao' ilike '%caixa%' and x ->> 'descricao' not ilike '%econ%' then 'caixa' else 'corrente' end::public.tipo_conta_bancaria,
          coalesce((x ->> 'ativa')::boolean, true), (x ->> 'id')::bigint)
        on conflict (empresa_id, nome) do update set tiny_id = coalesce(public.contas_bancarias.tiny_id, excluded.tiny_id);
      end if;
    end if;
  end loop;

  -- Categorias: grupo do Tiny = categoria mãe; "NÃO USAR" entra inativa.
  for x in select * from jsonb_array_elements(coalesce(lote -> 'categorias', '[]')) loop
    if exists (select 1 from public.plano_contas where tiny_id = (x ->> 'id')::bigint) then
      continue;
    end if;
    update public.plano_contas c set tiny_id = (x ->> 'id')::bigint
    where c.id = (select c2.id from public.plano_contas c2
                  where c2.tiny_id is null and c2.tipo = (x ->> 'tipo')::public.tipo_plano_conta
                    and lower(trim(c2.nome)) = lower(trim(x ->> 'descricao'))
                    and not exists (select 1 from public.plano_contas f where f.pai_id = c2.id)
                  limit 1);
    if found then
      continue;
    end if;
    select id into grupo from public.plano_contas
    where pai_id is null and tipo = (x ->> 'tipo')::public.tipo_plano_conta and lower(trim(nome)) = lower(trim(x ->> 'grupo'));
    if grupo is null then
      insert into public.plano_contas (codigo, nome, tipo)
      values ((select (coalesce(max(codigo::integer), 0) + 1)::text from public.plano_contas where pai_id is null and codigo ~ '^\d+$'),
        trim(x ->> 'grupo'), (x ->> 'tipo')::public.tipo_plano_conta)
      returning id into grupo;
    end if;
    insert into public.plano_contas (codigo, nome, tipo, pai_id, ativa, tiny_id)
    select p.codigo || '.' || lpad((coalesce(max(split_part(f.codigo, '.', array_length(string_to_array(f.codigo, '.'), 1))::integer), 0) + 1)::text, 2, '0'),
      trim(x ->> 'descricao'), p.tipo, p.id, coalesce((x ->> 'ativa')::boolean, true), (x ->> 'id')::bigint
    from public.plano_contas p left join public.plano_contas f on f.pai_id = p.id
    where p.id = grupo
    group by p.id, p.codigo, p.tipo;
  end loop;

  -- Registros vistos nas listagens: pendente quando mudou desde a última leitura.
  insert into public.integracao_fila as f (integracao_id, tipo, id_externo, assinatura)
  select integracao, l ->> 'tipo', (l ->> 'id')::bigint, l ->> 'assinatura'
  from jsonb_array_elements(coalesce(lote -> 'listados', '[]')) l
  on conflict (integracao_id, tipo, id_externo) do update
    set visto_em = now(),
        pendente = f.pendente or excluded.assinatura is null or f.assinatura is distinct from excluded.assinatura,
        tentativas = case when f.assinatura is distinct from excluded.assinatura then 0 else f.tentativas end,
        erro = case when f.assinatura is distinct from excluded.assinatura then null else f.erro end,
        assinatura = excluded.assinatura,
        atualizado_em = case when f.assinatura is distinct from excluded.assinatura then now() else f.atualizado_em end;

  -- Fim de uma volta completa no contas a pagar: o que não apareceu é relido.
  if lote ? 'pagar_ciclo_inicio' then
    update public.integracao_fila set pendente = true, atualizado_em = now()
    where integracao_id = integracao and tipo = 'pagar' and erro is null
      and visto_em < (lote ->> 'pagar_ciclo_inicio')::timestamptz;
  end if;

  -- Pedidos de venda primeiro, para os títulos acharem o pedido (sem mexer no
  -- estoque: a saída é pela expedição).
  for t in select * from jsonb_array_elements(coalesce(lote -> 'pedidos', '[]')) loop
    pessoa := public.tiny_pessoa('clientes', t -> 'cliente');
    if pessoa is null then
      raise exception 'Pedido % do Tiny sem cliente', t ->> 'numero';
    end if;
    etapa := public.tiny_etapa((t ->> 'situacao')::integer);
    canal_ped := coalesce(nullif(t ->> 'canal', ''), 'venda_direta');
    num := coalesce(nullif(t ->> 'numero_loja', ''), t ->> 'numero');
    select p.id, e.ordem into atual from public.pedidos_venda p join public.etapas_pedido e on e.id = p.etapa_id
    where p.tiny_id = (t ->> 'id')::bigint;
    if atual.id is null then
      -- Venda da loja já importada pela ligação direta ou planilha: adota.
      select p.id, e.ordem into atual from public.pedidos_venda p join public.etapas_pedido e on e.id = p.etapa_id
      where p.tiny_id is null and p.canal = canal_ped and p.numero_externo = num;
    end if;
    if atual.id is null then
      insert into public.pedidos_venda (empresa_id, cliente_id, canal, numero_externo, data_pedido, prazo_entrega, condicao_pagamento,
        prazo_recebimento_dias, etapa_id, observacao, vendedor_id, vendedor_externo, nota_fiscal, tiny_id,
        valor_frete, valor_desconto, transportadora, dados_tiny)
      values (empresa, pessoa, canal_ped, num, (t ->> 'data')::date, (t ->> 'data_prevista')::date,
        nullif(t ->> 'condicao', ''), greatest(0, coalesce((t ->> 'prazo_dias')::integer, 0)), etapa, nullif(t ->> 'observacao', ''),
        null, nullif(t ->> 'vendedor', ''), nullif(ltrim(t ->> 'nota', '0'), ''), (t ->> 'id')::bigint,
        greatest(0, coalesce((t ->> 'frete')::numeric, 0)), greatest(0, coalesce((t ->> 'desconto')::numeric, 0)),
        nullif(t ->> 'transportadora', ''), t -> 'original')
      returning id into pedido;
    else
      pedido := atual.id;
      -- A etapa só avança pelo Tiny (o que a fábrica marcou aqui não volta), salvo cancelamento.
      update public.pedidos_venda p set
        tiny_id = (t ->> 'id')::bigint, cliente_id = pessoa, numero_externo = num, data_pedido = (t ->> 'data')::date,
        prazo_entrega = (t ->> 'data_prevista')::date, condicao_pagamento = nullif(t ->> 'condicao', ''),
        prazo_recebimento_dias = greatest(0, coalesce((t ->> 'prazo_dias')::integer, 0)),
        observacao = nullif(t ->> 'observacao', ''), vendedor_externo = nullif(t ->> 'vendedor', ''),
        nota_fiscal = nullif(ltrim(t ->> 'nota', '0'), ''),
        valor_frete = greatest(0, coalesce((t ->> 'frete')::numeric, 0)),
        valor_desconto = greatest(0, coalesce((t ->> 'desconto')::numeric, 0)),
        transportadora = nullif(t ->> 'transportadora', ''), dados_tiny = t -> 'original',
        etapa_id = case when (t ->> 'situacao')::integer = 2
                          or (select ordem from public.etapas_pedido where id = etapa) > atual.ordem
                        then etapa else p.etapa_id end
      where p.id = pedido;
    end if;
    -- Itens: refeitos a cada leitura, somando o mesmo produto em uma linha.
    delete from public.pedido_venda_itens where pedido_id = pedido;
    insert into public.pedido_venda_itens (pedido_id, item_id, quantidade, preco_unitario)
    select pedido, i.item, sum(i.quantidade), round(sum(i.quantidade * i.valor) / sum(i.quantidade), 4)
    from (
      select public.tiny_item(it) as item, (it ->> 'quantidade')::numeric as quantidade,
        greatest(0, coalesce((it ->> 'valor_unitario')::numeric, 0)) as valor
      from jsonb_array_elements(coalesce(t -> 'itens', '[]')) it
      where (it ->> 'quantidade')::numeric > 0
    ) i
    group by i.item;
    update public.integracao_fila set pendente = false, tentativas = 0, erro = null
    where integracao_id = integracao and tipo = 'pedido' and id_externo = (t ->> 'id')::bigint;
    r := jsonb_set(r, '{pedidos}', to_jsonb((r ->> 'pedidos')::integer + 1));
  end loop;

  -- Cadastro dos produtos.
  for t in select * from jsonb_array_elements(coalesce(lote -> 'produtos', '[]')) loop
    perform public.tiny_item(t);
    update public.integracao_fila set pendente = false, tentativas = 0, erro = null
    where integracao_id = integracao and tipo = 'produto' and id_externo = (t ->> 'produto_id')::bigint;
    r := jsonb_set(r, '{produtos}', to_jsonb(coalesce((r ->> 'produtos')::integer, 0) + 1));
  end loop;

  -- Contas a receber.
  for t in select * from jsonb_array_elements(coalesce(lote -> 'receber', '[]')) loop
    select id, situacao into atual from public.contas_receber where tiny_id = (t ->> 'id')::bigint;
    if (atual.id is null and ((t ->> 'situacao') = 'cancelado'
          or ((t ->> 'situacao') = 'pago' and (t ->> 'vencimento')::date < desde and (t ->> 'emissao')::date < desde)))
       or coalesce((t ->> 'valor')::numeric, 0) <= 0
       or (atual.situacao = 'pago' and (t ->> 'situacao') not in ('pago', 'cancelado')) then
      r := jsonb_set(r, '{pulados}', to_jsonb((r ->> 'pulados')::integer + 1));
      update public.integracao_fila set pendente = false, tentativas = 0, erro = null
      where integracao_id = integracao and tipo = 'receber' and id_externo = (t ->> 'id')::bigint;
      continue;
    end if;
    pessoa := public.tiny_pessoa('clientes', t -> 'contato');
    categoria := public.tiny_categoria((t ->> 'categoria_id')::bigint, t ->> 'categoria_nome', 'receita');
    sit := case t ->> 'situacao' when 'pago' then 'pago' when 'cancelado' then 'cancelado' else 'aberto' end;
    pago := nullif(coalesce((t ->> 'valor_pago')::numeric, 0), 0);
    quando := coalesce((t ->> 'liquidacao')::date, (t ->> 'vencimento')::date);
    obs := case when (t ->> 'situacao') = 'parcial'
      then 'Recebido em parte no Tiny: R$ ' || coalesce(pago, 0) || ' · saldo R$ ' || coalesce((t ->> 'saldo')::numeric, 0) end;
    if atual.id is null then
      -- Título igual já lançado aqui (mesmo cliente, valor e vencimento) é adotado.
      select id into atual from public.contas_receber
      where tiny_id is null and empresa_id = empresa and cliente_id is not distinct from pessoa
        and valor = (t ->> 'valor')::numeric and vencimento = (t ->> 'vencimento')::date and situacao <> 'cancelado'
      limit 1;
    end if;
    if atual.id is null then
      insert into public.contas_receber (empresa_id, cliente_id, canal, descricao, categoria_id, valor, vencimento, situacao,
        data_recebimento, valor_recebido, conta_bancaria_id, observacao, usuario_id, tiny_id)
      values (empresa, pessoa, 'venda_direta', t ->> 'descricao', categoria, (t ->> 'valor')::numeric, (t ->> 'vencimento')::date,
        sit,
        case when sit = 'pago' then quando end,
        case when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        case when sit = 'pago' then public.tiny_conta(empresa, (t ->> 'conta_id')::bigint) end,
        obs, null, (t ->> 'id')::bigint)
      returning id into atual;
    else
      update public.contas_receber set
        tiny_id = (t ->> 'id')::bigint, cliente_id = coalesce(pessoa, cliente_id), descricao = t ->> 'descricao',
        categoria_id = coalesce(categoria, categoria_id), valor = (t ->> 'valor')::numeric, vencimento = (t ->> 'vencimento')::date,
        situacao = sit,
        data_recebimento = case when sit = 'pago' then quando end,
        valor_recebido = case when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        conta_bancaria_id = case when sit = 'pago' then public.tiny_conta(empresa, (t ->> 'conta_id')::bigint) end,
        observacao = coalesce(obs, observacao)
      where id = atual.id;
    end if;
    -- Pedido do título: pela nota fiscal ou pelo número citado no histórico.
    num := substring(t ->> 'descricao' from '(?i)pedido\D{0,6}(\d+)');
    update public.contas_receber cr set pedido_id = p.id
    from public.pedidos_venda p
    where cr.id = atual.id and cr.pedido_id is null and p.empresa_id = empresa and p.tiny_id is not null
      and ((nullif(ltrim(t ->> 'documento', '0'), '') is not null and p.nota_fiscal = ltrim(t ->> 'documento', '0'))
           or (num is not null and p.numero_externo = num));
    update public.integracao_fila set pendente = false, tentativas = 0, erro = null
    where integracao_id = integracao and tipo = 'receber' and id_externo = (t ->> 'id')::bigint;
    r := jsonb_set(r, '{receber}', to_jsonb((r ->> 'receber')::integer + 1));
  end loop;

  -- Contas a pagar.
  for t in select * from jsonb_array_elements(coalesce(lote -> 'pagar', '[]')) loop
    select id, situacao into atual from public.contas_pagar where tiny_id = (t ->> 'id')::bigint;
    if (atual.id is null and ((t ->> 'situacao') = 'cancelado'
          or ((t ->> 'situacao') = 'pago' and (t ->> 'vencimento')::date < desde and (t ->> 'emissao')::date < desde)))
       or coalesce((t ->> 'valor')::numeric, 0) <= 0
       or (atual.situacao = 'pago' and (t ->> 'situacao') not in ('pago', 'cancelado')) then
      r := jsonb_set(r, '{pulados}', to_jsonb((r ->> 'pulados')::integer + 1));
      update public.integracao_fila set pendente = false, tentativas = 0, erro = null
      where integracao_id = integracao and tipo = 'pagar' and id_externo = (t ->> 'id')::bigint;
      continue;
    end if;
    pessoa := public.tiny_pessoa('fornecedores', t -> 'contato');
    categoria := public.tiny_categoria((t ->> 'categoria_id')::bigint, t ->> 'categoria_nome', 'despesa');
    sit := case t ->> 'situacao' when 'pago' then 'pago' when 'cancelado' then 'cancelado' else 'aberto' end;
    pago := nullif(coalesce((t ->> 'valor_pago')::numeric, 0), 0);
    quando := coalesce((t ->> 'liquidacao')::date, (t ->> 'vencimento')::date);
    obs := case when (t ->> 'situacao') = 'parcial'
      then 'Pago em parte no Tiny: R$ ' || coalesce(pago, 0) || ' · saldo R$ ' || coalesce((t ->> 'saldo')::numeric, 0) end;
    if atual.id is null then
      -- Título da nota já lançado aqui (mesmo fornecedor, valor e vencimento) é adotado.
      select id into atual from public.contas_pagar
      where tiny_id is null and empresa_id = empresa and fornecedor_id is not distinct from pessoa
        and valor = (t ->> 'valor')::numeric and vencimento = (t ->> 'vencimento')::date and situacao <> 'cancelado'
      limit 1;
    end if;
    if atual.id is null then
      insert into public.contas_pagar (empresa_id, fornecedor_id, descricao, categoria_id, valor, vencimento, situacao,
        data_pagamento, valor_pago, conta_bancaria_id, observacao, usuario_id, tiny_id)
      values (empresa, pessoa, t ->> 'descricao', categoria, (t ->> 'valor')::numeric, (t ->> 'vencimento')::date, sit,
        case when sit = 'pago' then quando end,
        case when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        case when sit = 'pago' then public.tiny_conta(empresa, (t ->> 'conta_id')::bigint) end,
        obs, null, (t ->> 'id')::bigint);
    else
      update public.contas_pagar set
        tiny_id = (t ->> 'id')::bigint, fornecedor_id = coalesce(pessoa, fornecedor_id), descricao = t ->> 'descricao',
        categoria_id = coalesce(categoria, categoria_id), valor = (t ->> 'valor')::numeric, vencimento = (t ->> 'vencimento')::date,
        situacao = sit,
        data_pagamento = case when sit = 'pago' then quando end,
        valor_pago = case when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        conta_bancaria_id = case when sit = 'pago' then public.tiny_conta(empresa, (t ->> 'conta_id')::bigint) end,
        observacao = coalesce(obs, observacao)
      where id = atual.id;
    end if;
    update public.integracao_fila set pendente = false, tentativas = 0, erro = null
    where integracao_id = integracao and tipo = 'pagar' and id_externo = (t ->> 'id')::bigint;
    r := jsonb_set(r, '{pagar}', to_jsonb((r ->> 'pagar')::integer + 1));
  end loop;

  -- Leituras que falharam: tenta de novo até 5 vezes.
  update public.integracao_fila f set tentativas = f.tentativas + 1, erro = x2 ->> 'erro', pendente = f.tentativas + 1 < 5
  from jsonb_array_elements(coalesce(lote -> 'falhas', '[]')) x2
  where f.integracao_id = integracao and f.tipo = x2 ->> 'tipo' and f.id_externo = (x2 ->> 'id')::bigint;

  -- Apagados no Tiny: o título em aberto é cancelado aqui.
  for x in select * from jsonb_array_elements(coalesce(lote -> 'removidos', '[]')) loop
    update public.integracao_fila set pendente = false, erro = 'Não existe mais no Tiny'
    where integracao_id = integracao and tipo = x ->> 'tipo' and id_externo = (x ->> 'id')::bigint;
    if x ->> 'tipo' = 'receber' then
      update public.contas_receber set situacao = 'cancelado', observacao = 'Apagado no Tiny'
      where tiny_id = (x ->> 'id')::bigint and situacao = 'aberto';
    elsif x ->> 'tipo' = 'pagar' then
      update public.contas_pagar set situacao = 'cancelado', observacao = 'Apagado no Tiny'
      where tiny_id = (x ->> 'id')::bigint and situacao = 'aberto';
    end if;
  end loop;

  perform set_config('venner.leitura_tiny', '', true);
  return r;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'tiny_pessoa(text, jsonb)', 'tiny_categoria(bigint, text, public.tipo_plano_conta)', 'tiny_conta(uuid, bigint)',
    'tiny_item(jsonb)', 'tiny_etapa(integer)', 'tiny_aplicar(uuid, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Robô: chamadas do endereço /integracoes/robo, que apresenta a chave gerada
-- pelo banco. Sem a chave certa nada é lido nem gravado.
-- -----------------------------------------------------------------------------
create function public.robo_tiny_conferir(integracao uuid, chave_robo text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if chave_robo is null or length(chave_robo) < 32 or not exists (
    select 1 from public.integracao_robo r join public.integracoes_plataforma i on i.id = r.integracao_id
    where r.integracao_id = integracao and r.chave = chave_robo and i.canal = 'tiny') then
    raise exception 'Chave do robô não confere';
  end if;
end;
$$;

-- Começo de uma leitura: reserva a conta por 3 minutos (uma leitura por vez)
-- e devolve o acesso, as chaves do aplicativo, o estado e os pendentes.
create function public.robo_tiny_inicio(integracao uuid, chave_robo text, limite integer default 40)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resposta jsonb;
begin
  perform public.robo_tiny_conferir(integracao, chave_robo);
  update public.integracao_robo set executando_ate = now() + interval '3 minutes', executado_em = now()
  where integracao_id = integracao and (executando_ate is null or executando_ate < now());
  if not found then
    raise exception 'Uma leitura do Tiny já está em andamento';
  end if;
  select jsonb_build_object(
    'empresa_id', i.empresa_id,
    'access_token', i.access_token,
    'refresh_token', i.refresh_token,
    'expira_em', i.expira_em,
    'client_id', a.client_id,
    'client_secret', a.client_secret,
    'ler_pagar', coalesce(current_date <= r.ler_pagar_ate, false),
    'estado', r.estado,
    'pendentes', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', f.tipo, 'id', f.id_externo))
      from (select f2.tipo, f2.id_externo from public.integracao_fila f2
            where f2.integracao_id = integracao and f2.pendente and (coalesce(current_date <= r.ler_pagar_ate, false) or f2.tipo <> 'pagar')
            order by case f2.tipo when 'receber' then 1 when 'pedido' then 2 when 'produto' then 3 else 4 end, f2.atualizado_em
            limit greatest(1, least(limite, 200))) f), '[]'))
  into resposta
  from public.integracoes_plataforma i
  join public.integracao_robo r on r.integracao_id = i.id
  left join public.integracoes_aplicativos a on a.canal = 'tiny' and a.empresa_id = i.empresa_id
  where i.id = integracao;
  return resposta;
end;
$$;

-- Acesso renovado no meio da leitura (o Tiny troca a chave de renovação).
create function public.robo_tiny_tokens(integracao uuid, chave_robo text, acesso text, renovacao text, expira timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.robo_tiny_conferir(integracao, chave_robo);
  update public.integracoes_plataforma
  set access_token = acesso, refresh_token = coalesce(renovacao, refresh_token), expira_em = expira
  where id = integracao;
end;
$$;

-- Fim da leitura: grava o lote, o novo estado e o erro (se houve).
create function public.robo_tiny_aplicar(integracao uuid, chave_robo text, lote jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saida jsonb;
  erro text := nullif(lote ->> 'erro', '');
begin
  perform public.robo_tiny_conferir(integracao, chave_robo);
  begin
    saida := public.tiny_aplicar(integracao, lote);
  exception when others then
    erro := 'Erro ao gravar a leitura: ' || sqlerrm;
    saida := null;
  end;
  update public.integracao_robo set
    estado = case when saida is not null then coalesce(lote -> 'estado', estado) else estado end,
    executando_ate = null,
    ok_em = case when erro is null then now() else ok_em end,
    ultimo_erro = erro,
    resumo = coalesce(saida, public.integracao_robo.resumo)
  where integracao_id = integracao;
  update public.integracoes_plataforma set ultima_sincronizacao = now()
  where id = integracao and saida is not null and ultima_sincronizacao is distinct from now();
  return coalesce(saida, jsonb_build_object('erro', erro));
end;
$$;

do $$
declare
  f text;
begin
  revoke execute on function public.robo_tiny_conferir(uuid, text) from public, anon, authenticated;
  foreach f in array array[
    'robo_tiny_inicio(uuid, text, integer)', 'robo_tiny_tokens(uuid, text, text, text, timestamptz)',
    'robo_tiny_aplicar(uuid, text, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções das telas (conferem o perfil).
-- -----------------------------------------------------------------------------
create function public.pode_ligar_integracao()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.tem_permissao('config.integracoes', 'editar') or public.tem_permissao('financeiro.receber', 'criar');
$$;

-- Guarda as chaves do aplicativo do Tiny (coladas na tela de integrações).
create function public.salvar_aplicativo_tiny(empresa uuid, cliente text, segredo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.tem_permissao('config.integracoes', 'editar') and public.pode_ver_empresa(empresa)) then
    raise exception 'Seu perfil não pode alterar as chaves das integrações desta empresa';
  end if;
  if length(trim(coalesce(cliente, ''))) < 8 or length(trim(coalesce(segredo, ''))) < 8 then
    raise exception 'Cole o Client ID e o Client Secret completos';
  end if;
  insert into public.integracoes_aplicativos (empresa_id, canal, client_id, client_secret)
  values (empresa, 'tiny', trim(cliente), trim(segredo))
  on conflict (empresa_id, canal) do update set client_id = excluded.client_id, client_secret = excluded.client_secret, atualizado_em = now();
end;
$$;

-- Client ID (público na autorização) e se o segredo já foi guardado.
create function public.aplicativo_tiny()
returns table (empresa_id uuid, client_id text, atualizado_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.empresa_id, a.client_id, a.atualizado_em
  from public.integracoes_aplicativos a
  where a.canal = 'tiny' and (public.tem_permissao('config.integracoes', 'ver') or public.pode_ligar_integracao())
    and public.pode_ver_empresa(a.empresa_id);
$$;

-- Chaves para trocar o código da autorização pelo acesso (só no servidor).
create function public.credenciais_tiny(empresa uuid)
returns table (client_id text, client_secret text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.pode_ligar_integracao() and public.pode_ver_empresa(empresa)) then
    raise exception 'Seu perfil não pode ligar contas desta empresa';
  end if;
  return query select a.client_id, a.client_secret from public.integracoes_aplicativos a
    where a.canal = 'tiny' and a.empresa_id = empresa;
end;
$$;

-- Depois de ligar a conta: prepara a leitura automática e devolve a chave do robô.
create function public.preparar_robo_tiny(integracao uuid, endereco_publico text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  chave_robo text;
begin
  if not (public.pode_ligar_integracao() and exists (
    select 1 from public.integracoes_plataforma i where i.id = integracao and i.canal = 'tiny' and public.pode_ver_empresa(i.empresa_id))) then
    raise exception 'Conta do Tiny não encontrada ou sem permissão';
  end if;
  if endereco_publico !~ '^https?://[^/]+$' then
    raise exception 'Endereço do sistema inválido';
  end if;
  insert into public.integracao_robo (integracao_id, endereco) values (integracao, endereco_publico)
  on conflict (integracao_id) do update set endereco = excluded.endereco, executando_ate = null
  returning chave into chave_robo;
  return chave_robo;
end;
$$;

-- Situação da leitura para a tela de integrações.
create function public.situacao_tiny()
returns table (id uuid, empresa_id uuid, apelido text, ligada_em timestamptz, expira_em timestamptz, executado_em timestamptz,
  ok_em timestamptz, ultimo_erro text, ler_pagar_ate date, resumo jsonb, pendentes jsonb, falhas integer, importados jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.empresa_id, i.apelido, i.criado_em, i.expira_em, r.executado_em, r.ok_em, r.ultimo_erro, r.ler_pagar_ate,
    r.resumo,
    coalesce((select jsonb_object_agg(f.tipo, f.n) from (
      select tipo, count(*) as n from public.integracao_fila where integracao_id = i.id and pendente group by tipo) f), '{}'),
    (select count(*)::integer from public.integracao_fila where integracao_id = i.id and not pendente and erro is not null
       and erro <> 'Não existe mais no Tiny'),
    jsonb_build_object(
      'receber', (select count(*) from public.contas_receber where empresa_id = i.empresa_id and tiny_id is not null),
      'pagar', (select count(*) from public.contas_pagar where empresa_id = i.empresa_id and tiny_id is not null),
      'pedidos', (select count(*) from public.pedidos_venda where empresa_id = i.empresa_id and tiny_id is not null),
      'produtos', (select count(*) from public.itens where tiny_id is not null))
  from public.integracoes_plataforma i
  left join public.integracao_robo r on r.integracao_id = i.id
  where i.canal = 'tiny'
    and (public.tem_permissao('config.integracoes', 'ver') or public.pode_ligar_integracao())
    and public.pode_ver_empresa(i.empresa_id);
$$;

create function public.ajustar_robo_tiny(integracao uuid, ler_contas_pagar_ate date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.integracao_robo r set ler_pagar_ate = ler_contas_pagar_ate
  from public.integracoes_plataforma i
  where r.integracao_id = integracao and i.id = r.integracao_id and public.pode_ver_empresa(i.empresa_id)
    and public.tem_permissao('config.integracoes', 'editar');
  if not found then
    raise exception 'Conta do Tiny não encontrada ou sem permissão';
  end if;
end;
$$;

-- Chave do robô para o botão "Ler agora" (roda a mesma leitura no servidor).
create function public.chave_robo_tiny(integracao uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  chave_robo text;
begin
  select r.chave into chave_robo
  from public.integracao_robo r join public.integracoes_plataforma i on i.id = r.integracao_id
  where r.integracao_id = integracao and public.pode_ver_empresa(i.empresa_id) and public.pode_ligar_integracao();
  if chave_robo is null then
    raise exception 'Conta do Tiny não encontrada ou sem permissão';
  end if;
  return chave_robo;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'pode_ligar_integracao()', 'salvar_aplicativo_tiny(uuid, text, text)', 'aplicativo_tiny()', 'credenciais_tiny(uuid)',
    'preparar_robo_tiny(uuid, text)', 'situacao_tiny()', 'ajustar_robo_tiny(uuid, date)', 'chave_robo_tiny(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Disparo a cada 5 minutos pelo próprio Supabase (pg_cron chama o endereço do
-- robô com pg_net). Fora do Supabase (testes) as extensões não existem e o
-- agendamento é pulado.
-- -----------------------------------------------------------------------------
create function public.disparar_robo_tiny()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select rb.integracao_id, rb.chave, rb.endereco
    from public.integracao_robo rb join public.integracoes_plataforma i on i.id = rb.integracao_id
    where i.canal = 'tiny' and rb.endereco is not null and (rb.executando_ate is null or rb.executando_ate < now())
  loop
    perform net.http_post(
      url := r.endereco || '/integracoes/robo',
      body := jsonb_build_object('integracao', r.integracao_id),
      headers := jsonb_build_object('content-type', 'application/json', 'x-chave-robo', r.chave),
      timeout_milliseconds := 120000);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.disparar_robo_tiny() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.schedule('robo-tiny', '*/5 * * * *', 'select public.disparar_robo_tiny()');
  else
    raise notice 'pg_cron/pg_net indisponíveis: leitura automática do Tiny não agendada';
  end if;
end;
$$;
