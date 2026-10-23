-- =============================================================================
-- Venner Gestão · Pedido de venda com os campos do Tiny
-- O comercial passa a lançar aqui o pedido completo, como no Tiny: vendedor,
-- lista de preço, natureza de operação, forma de recebimento, parcelas,
-- transportadora, forma de envio, frete, endereço de entrega e observações
-- internas. Os cadastros de apoio vêm do Tiny e podem ser mantidos aqui.
-- As etapas do pedido passam a ser as situações do Tiny.
-- =============================================================================

insert into public.telas (codigo, titulo, grupo) values ('vendas.cadastros', 'Cadastros do comercial', 'Vendas e E-commerce');

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'vendas.cadastros', a.acao
from public.perfis p
cross join (values ('ver'::public.acao_permissao), ('criar'), ('editar')) as a(acao)
where p.nome = 'Comercial';
insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'vendas.cadastros', 'ver' from public.perfis p where p.nome in ('Financeiro', 'E-commerce');

-- -----------------------------------------------------------------------------
-- Cadastros do comercial. tiny_id liga cada um ao mesmo cadastro no Tiny.
-- -----------------------------------------------------------------------------
create table public.vendedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  email text,
  telefone text,
  comissao_percentual numeric(5, 2) not null default 0 check (comissao_percentual between 0 and 100),
  -- Login do vendedor no sistema, quando tiver.
  usuario_id uuid references public.usuarios(id),
  tiny_id bigint unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.condicoes_pagamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (length(trim(nome)) > 0),
  -- Dias de cada parcela contados da data base (ex.: {28,56}); vazio = à vista.
  dias integer[] not null default '{}' check (0 <= all (dias)),
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Condição nova sem dias informados: os números do nome viram os dias ("28/56" → {28,56}).
create function public.dias_da_condicao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.dias = '{}' then
    new.dias := coalesce((select array_agg(m[1]::integer order by o)
                          from regexp_matches(new.nome, '(\d+)', 'g') with ordinality as r(m, o)), '{}');
  end if;
  return new;
end;
$$;
create trigger dias_da_condicao before insert on public.condicoes_pagamento
  for each row execute function public.dias_da_condicao();

create table public.formas_pagamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  tiny_id bigint unique,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.listas_preco (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  -- Acréscimo (+) ou desconto (−) em % sobre o preço de venda do produto.
  acrescimo_desconto numeric(7, 2) not null default 0 check (acrescimo_desconto > -100),
  tiny_id bigint unique,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Preço próprio de um produto na lista (exceção ao percentual).
create table public.lista_preco_itens (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references public.listas_preco(id) on delete cascade,
  item_id uuid not null references public.itens(id) on delete cascade,
  preco numeric(14, 4) not null check (preco >= 0),
  preco_promocional numeric(14, 4) check (preco_promocional >= 0),
  unique (lista_id, item_id)
);

create table public.transportadoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  documento text check (documento ~ '^(\d{11}|\d{14})$'),
  telefone text,
  -- Contato do Tiny que é o transportador.
  tiny_id bigint unique,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.formas_envio (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  tiny_id bigint unique,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.naturezas_operacao (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  tiny_id bigint unique,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['vendedores', 'condicoes_pagamento', 'formas_pagamento', 'listas_preco', 'lista_preco_itens',
                           'transportadoras', 'formas_envio', 'naturezas_operacao'] loop
    execute format('alter table public.%I enable row level security', t);
    perform public.politicas_por_tela(t, 'vendas.cadastros', 'vendas.pedidos');
    execute format('create trigger auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Pedido: os campos do Tiny.
-- -----------------------------------------------------------------------------
alter table public.pedidos_venda
  add column numero_ordem_compra text,
  add column vendedor_cadastro_id uuid references public.vendedores(id),
  add column lista_preco_id uuid references public.listas_preco(id),
  add column natureza_operacao_id uuid references public.naturezas_operacao(id),
  add column forma_pagamento_id uuid references public.formas_pagamento(id),
  add column categoria_id uuid references public.plano_contas(id),
  add column transportadora_id uuid references public.transportadoras(id),
  add column forma_envio_id uuid references public.formas_envio(id),
  -- R remetente (CIF), D destinatário (FOB), T terceiros, 3 próprio remetente, 4 próprio destinatário, S sem frete.
  add column frete_por_conta text check (frete_por_conta in ('R', 'D', 'T', '3', '4', 'S')),
  add column valor_outras_despesas numeric(14, 2) not null default 0 check (valor_outras_despesas >= 0),
  add column data_envio date,
  add column data_entregue date,
  add column codigo_rastreamento text,
  add column url_rastreamento text,
  -- Endereço de entrega quando é diferente do cadastro do cliente.
  add column endereco_entrega jsonb check (endereco_entrega is null or jsonb_typeof(endereco_entrega) = 'object'),
  add column observacao_interna text,
  -- Nota fiscal emitida pelo Tiny.
  add column nota_fiscal_tiny_id bigint,
  add column nota_fiscal_serie text,
  add column nota_fiscal_chave text,
  add column nota_fiscal_situacao text,
  add column data_faturamento date;

alter table public.pedido_venda_itens add column info_adicional text;

-- Parcelas combinadas no pedido (viram o contas a receber no faturamento).
create table public.pedido_parcelas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_venda(id) on delete cascade,
  numero integer not null check (numero > 0),
  dias integer check (dias >= 0),
  vencimento date,
  valor numeric(14, 2) not null check (valor >= 0),
  forma_pagamento_id uuid references public.formas_pagamento(id),
  observacao text,
  unique (pedido_id, numero)
);
alter table public.pedido_parcelas enable row level security;
create policy ver on public.pedido_parcelas for select to authenticated
  using (exists (select 1 from public.pedidos_venda p where p.id = pedido_id));
create policy criar on public.pedido_parcelas for insert to authenticated
  with check (exists (select 1 from public.pedidos_venda p
    where p.id = pedido_id and public.tem_permissao('vendas.pedidos', 'criar') and public.pode_ver_empresa(p.empresa_id)));
create policy editar on public.pedido_parcelas for update to authenticated
  using (exists (select 1 from public.pedidos_venda p
    where p.id = pedido_id and public.tem_permissao('vendas.pedidos', 'editar') and public.pode_ver_empresa(p.empresa_id)));
create policy excluir on public.pedido_parcelas for delete to authenticated
  using (exists (select 1 from public.pedidos_venda p
    where p.id = pedido_id and public.tem_permissao('vendas.pedidos', 'editar') and public.pode_ver_empresa(p.empresa_id)));

-- A visão dos pedidos passa a ter as colunas novas (p.* é fixado na criação).
drop view public.pedidos_venda_resumo;
create view public.pedidos_venda_resumo
with (security_invoker = true)
as
select
  p.*,
  e.nome as etapa_nome,
  e.ordem as etapa_ordem,
  e.fase,
  coalesce(t.valor_total, 0) as valor_total,
  coalesce(t.itens, 0) as quantidade_itens,
  greatest(0, current_date - p.prazo_entrega) as dias_atraso
from public.pedidos_venda p
join public.etapas_pedido e on e.id = p.etapa_id
left join lateral (
  select sum(i.valor_total) as valor_total, count(*) as itens
  from public.pedido_venda_itens i
  where i.pedido_id = p.id
) t on true;

-- -----------------------------------------------------------------------------
-- Etapas = situações do Tiny. As etapas provisórias saem de uso e os pedidos
-- vão para a etapa equivalente.
-- -----------------------------------------------------------------------------
alter table public.etapas_pedido add column situacao_tiny smallint unique check (situacao_tiny between 0 and 10);

insert into public.etapas_pedido (nome, ordem, fase, situacao_tiny) values
  ('Em aberto', 10, 'negociacao', 0),
  ('Dados incompletos', 15, 'negociacao', 8),
  ('Aprovado', 20, 'producao', 3),
  ('Preparando envio', 30, 'producao', 4),
  ('Faturado', 40, 'expedicao', 1),
  ('Pronto para envio', 50, 'expedicao', 7),
  ('Enviado', 60, 'expedicao', 5),
  ('Não entregue', 70, 'expedicao', 9),
  ('Entregue', 80, 'encerrado', 6),
  ('Em devolução', 90, 'expedicao', 10),
  ('Cancelado', 100, 'encerrado', 2)
on conflict (nome) do update set ordem = excluded.ordem, fase = excluded.fase, situacao_tiny = excluded.situacao_tiny, ativa = true;

-- Etapa de uma situação do Tiny (a primeira ativa, se faltar).
create or replace function public.tiny_etapa(situacao integer)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select id from public.etapas_pedido where situacao_tiny = situacao),
    (select id from public.etapas_pedido where ativa order by ordem limit 1));
$$;

update public.pedidos_venda p
set etapa_id = case
  when p.dados_tiny ? 'situacao' then public.tiny_etapa((p.dados_tiny ->> 'situacao')::integer)
  else (select n.id from public.etapas_pedido n where n.nome = case e.nome
          when 'Emitido' then 'Em aberto'
          when 'Aguardando retorno do cliente' then 'Em aberto'
          when 'Confirmado pelo cliente' then 'Aprovado'
          when 'Em produção' then 'Aprovado'
          when 'Montagem' then 'Aprovado'
          when 'Embalagem' then 'Preparando envio'
          when 'Aguardando coleta' then 'Pronto para envio'
          when 'Em trânsito' then 'Enviado'
          else e.nome end)
  end
from public.etapas_pedido e
where e.id = p.etapa_id and e.situacao_tiny is null
  and e.nome in ('Emitido', 'Aguardando retorno do cliente', 'Confirmado pelo cliente', 'Em produção', 'Montagem',
                 'Embalagem', 'Aguardando coleta', 'Em trânsito');

update public.etapas_pedido set ativa = false
where situacao_tiny is null
  and nome in ('Emitido', 'Aguardando retorno do cliente', 'Confirmado pelo cliente', 'Em produção', 'Montagem',
               'Embalagem', 'Aguardando coleta', 'Em trânsito');

-- -----------------------------------------------------------------------------
-- Leitura do Tiny: a cópia do pedido (dados_tiny) preenche os campos novos,
-- os cadastros de apoio e as parcelas. Assim a gravação do robô não muda.
-- -----------------------------------------------------------------------------
create function public.tiny_cadastro(tabela text, tiny bigint, nome text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  achado uuid;
begin
  if tiny is null or tiny <= 0 then
    return null;
  end if;
  execute format('select id from public.%I where tiny_id = $1', tabela) into achado using tiny;
  if achado is null and nullif(trim(nome), '') is not null then
    execute format('insert into public.%I (nome, tiny_id) values ($1, $2) returning id', tabela)
      into achado using trim(nome), tiny;
  end if;
  return achado;
end;
$$;
revoke execute on function public.tiny_cadastro(text, bigint, text) from public, anon, authenticated;

-- Data do Tiny ("2026-10-05" ou "2026-10-05 10:00:00"); vazia ou zerada = null.
create function public.tiny_data(v text)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when v ~ '^\d{4}-\d{2}-\d{2}' and left(v, 4) <> '0000' then left(v, 10)::date end;
$$;

create function public.aplicar_dados_tiny()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d jsonb := new.dados_tiny;
  pg jsonb := coalesce(d -> 'pagamento', '{}');
  tr jsonb := coalesce(d -> 'transportador', '{}');
  en jsonb := d -> 'enderecoEntrega';
  nf jsonb := d -> 'notaFiscal';
  txt text;
begin
  if d is null or (tg_op = 'UPDATE' and d is not distinct from old.dados_tiny) then
    return new;
  end if;
  new.numero_ordem_compra := nullif(trim(d ->> 'numeroOrdemCompra'), '');
  new.observacao_interna := nullif(trim(d ->> 'observacoesInternas'), '');
  new.valor_outras_despesas := greatest(0, coalesce((d ->> 'valorOutrasDespesas')::numeric, 0));
  new.data_envio := public.tiny_data(d ->> 'dataEnvio');
  new.data_entregue := public.tiny_data(d ->> 'dataEntrega');
  new.data_faturamento := public.tiny_data(d ->> 'dataFaturamento');
  new.vendedor_cadastro_id := coalesce(public.tiny_cadastro('vendedores', (d #>> '{vendedor,id}')::bigint, d #>> '{vendedor,nome}'), new.vendedor_cadastro_id);
  new.lista_preco_id := coalesce(public.tiny_cadastro('listas_preco', (d #>> '{listaPreco,id}')::bigint, d #>> '{listaPreco,nome}'), new.lista_preco_id);
  new.natureza_operacao_id := coalesce(public.tiny_cadastro('naturezas_operacao', (d #>> '{naturezaOperacao,id}')::bigint, d #>> '{naturezaOperacao,nome}'), new.natureza_operacao_id);
  new.forma_pagamento_id := coalesce(public.tiny_cadastro('formas_pagamento', (pg #>> '{formaRecebimento,id}')::bigint, pg #>> '{formaRecebimento,nome}'), new.forma_pagamento_id);
  new.transportadora_id := coalesce(public.tiny_cadastro('transportadoras', (tr ->> 'id')::bigint, tr ->> 'nome'), new.transportadora_id);
  new.forma_envio_id := coalesce(public.tiny_cadastro('formas_envio', (tr #>> '{formaEnvio,id}')::bigint, tr #>> '{formaEnvio,nome}'), new.forma_envio_id);
  new.categoria_id := coalesce((select c.id from public.plano_contas c where c.tiny_id = (pg #>> '{categoria,id}')::bigint), new.categoria_id);
  txt := tr ->> 'fretePorConta';
  new.frete_por_conta := case when txt in ('R', 'D', 'T', '3', '4', 'S') then txt end;
  new.codigo_rastreamento := nullif(trim(tr ->> 'codigoRastreamento'), '');
  new.url_rastreamento := nullif(trim(tr ->> 'urlRastreamento'), '');
  if nullif(trim(coalesce(en ->> 'endereco', '')), '') is not null then
    new.endereco_entrega := jsonb_strip_nulls(jsonb_build_object(
      'nome', nullif(trim(en ->> 'nomeDestinatario'), ''), 'documento', nullif(regexp_replace(coalesce(en ->> 'cpfCnpj', ''), '\D', '', 'g'), ''),
      'ie', nullif(trim(en ->> 'inscricaoEstadual'), ''), 'telefone', nullif(trim(en ->> 'telefone'), ''),
      'logradouro', nullif(trim(en ->> 'endereco'), ''), 'numero', nullif(trim(en ->> 'numero'), ''),
      'complemento', nullif(trim(en ->> 'complemento'), ''), 'bairro', nullif(trim(en ->> 'bairro'), ''),
      'cidade', nullif(trim(en ->> 'municipio'), ''), 'uf', nullif(upper(trim(en ->> 'uf')), ''),
      'cep', nullif(regexp_replace(coalesce(en ->> 'cep', ''), '\D', '', 'g'), '')));
  else
    new.endereco_entrega := null;
  end if;
  new.nota_fiscal_tiny_id := coalesce(nullif((d ->> 'idNotaFiscal')::bigint, 0), nullif((nf ->> 'id')::bigint, 0));
  new.nota_fiscal_serie := nullif(trim(nf ->> 'serie'), '');
  new.nota_fiscal_chave := nullif(trim(nf ->> 'chaveAcesso'), '');
  new.nota_fiscal_situacao := nullif(trim(nf ->> 'situacao'), '');
  if nullif(trim(pg ->> 'condicaoPagamento'), '') is not null then
    insert into public.condicoes_pagamento (nome) values (trim(pg ->> 'condicaoPagamento')) on conflict (nome) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.aplicar_dados_tiny() from public, anon, authenticated;

create trigger aplicar_dados_tiny
  before insert or update of dados_tiny on public.pedidos_venda
  for each row execute function public.aplicar_dados_tiny();

create function public.aplicar_parcelas_tiny()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.dados_tiny is null or (tg_op = 'UPDATE' and new.dados_tiny is not distinct from old.dados_tiny) then
    return null;
  end if;
  delete from public.pedido_parcelas where pedido_id = new.id;
  insert into public.pedido_parcelas (pedido_id, numero, dias, vencimento, valor, forma_pagamento_id, observacao)
  select new.id, x.n, (x.p ->> 'dias')::integer, public.tiny_data(x.p ->> 'data'),
         greatest(0, coalesce((x.p ->> 'valor')::numeric, 0)),
         public.tiny_cadastro('formas_pagamento', (x.p #>> '{formaRecebimento,id}')::bigint, x.p #>> '{formaRecebimento,nome}'),
         nullif(trim(x.p ->> 'observacoes'), '')
  from jsonb_array_elements(coalesce(new.dados_tiny #> '{pagamento,parcelas}', '[]')) with ordinality as x(p, n);
  return null;
end;
$$;
revoke execute on function public.aplicar_parcelas_tiny() from public, anon, authenticated;

create trigger aplicar_parcelas_tiny
  after insert or update of dados_tiny on public.pedidos_venda
  for each row execute function public.aplicar_parcelas_tiny();

-- Informação adicional do item, como veio do Tiny (o mesmo produto em duas linhas junta os textos).
create function public.info_item_tiny()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.info_adicional is null then
    select string_agg(distinct nullif(trim(it ->> 'infoAdicional'), ''), ' · ') into new.info_adicional
    from public.pedidos_venda p
    join public.itens i on i.id = new.item_id
    cross join jsonb_array_elements(coalesce(p.dados_tiny -> 'itens', '[]')) it
    where p.id = new.pedido_id and i.tiny_id is not null and (it #>> '{produto,id}')::bigint = i.tiny_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.info_item_tiny() from public, anon, authenticated;

create trigger info_item_tiny
  before insert on public.pedido_venda_itens
  for each row execute function public.info_item_tiny();

-- Pedidos já lidos do Tiny ganham os campos novos agora.
-- (os gatilhos só agem quando a cópia muda: tira e devolve)
create temp table copia_tiny as select id, dados_tiny from public.pedidos_venda where dados_tiny is not null;
update public.pedidos_venda p set dados_tiny = null from copia_tiny c where c.id = p.id;
update public.pedidos_venda p set dados_tiny = c.dados_tiny from copia_tiny c where c.id = p.id;
drop table copia_tiny;
update public.pedido_venda_itens pi set info_adicional = (
  select string_agg(distinct nullif(trim(it ->> 'infoAdicional'), ''), ' · ')
  from public.pedidos_venda p
  join public.itens i on i.id = pi.item_id
  cross join jsonb_array_elements(coalesce(p.dados_tiny -> 'itens', '[]')) it
  where p.id = pi.pedido_id and i.tiny_id is not null and (it #>> '{produto,id}')::bigint = i.tiny_id)
where exists (select 1 from public.pedidos_venda p where p.id = pi.pedido_id and p.dados_tiny is not null);
insert into public.condicoes_pagamento (nome)
select distinct trim(condicao_pagamento) from public.pedidos_venda where nullif(trim(condicao_pagamento), '') is not null
on conflict (nome) do nothing;

-- -----------------------------------------------------------------------------
-- Cadastros lidos do Tiny uma vez por dia: vendedores, formas de recebimento,
-- formas de envio e listas de preço (com os preços próprios de cada produto).
-- -----------------------------------------------------------------------------
create function public.robo_tiny_cadastros(integracao uuid, chave_robo text, dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  lista uuid;
  n_vend integer := 0;
  n_formas integer := 0;
  n_envio integer := 0;
  n_listas integer := 0;
begin
  perform public.robo_tiny_conferir(integracao, chave_robo);

  for c in select * from jsonb_array_elements(coalesce(dados -> 'vendedores', '[]')) loop
    insert into public.vendedores (nome, email, telefone, tiny_id, ativo)
    values (c ->> 'nome', nullif(c ->> 'email', ''), nullif(c ->> 'telefone', ''), (c ->> 'id')::bigint, coalesce((c ->> 'ativo')::boolean, true))
    on conflict (tiny_id) do update set nome = excluded.nome, ativo = excluded.ativo,
      email = coalesce(public.vendedores.email, excluded.email), telefone = coalesce(public.vendedores.telefone, excluded.telefone);
    n_vend := n_vend + 1;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(dados -> 'formas_pagamento', '[]')) loop
    insert into public.formas_pagamento (nome, tiny_id, ativa) values (c ->> 'nome', (c ->> 'id')::bigint, coalesce((c ->> 'ativo')::boolean, true))
    on conflict (tiny_id) do update set nome = excluded.nome, ativa = excluded.ativa;
    n_formas := n_formas + 1;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(dados -> 'formas_envio', '[]')) loop
    insert into public.formas_envio (nome, tiny_id, ativa) values (c ->> 'nome', (c ->> 'id')::bigint, coalesce((c ->> 'ativo')::boolean, true))
    on conflict (tiny_id) do update set nome = excluded.nome, ativa = excluded.ativa;
    n_envio := n_envio + 1;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(dados -> 'listas_preco', '[]')) loop
    insert into public.listas_preco (nome, acrescimo_desconto, tiny_id)
    values (c ->> 'nome', greatest(-99, coalesce((c ->> 'acrescimo_desconto')::numeric, 0)), (c ->> 'id')::bigint)
    on conflict (tiny_id) do update set nome = excluded.nome, acrescimo_desconto = excluded.acrescimo_desconto
    returning id into lista;
    if c ? 'precos' then
      delete from public.lista_preco_itens where lista_id = lista;
      insert into public.lista_preco_itens (lista_id, item_id, preco, preco_promocional)
      select distinct on (i.id) lista, i.id, greatest(0, (p ->> 'preco')::numeric), nullif(greatest(0, coalesce((p ->> 'preco_promocional')::numeric, 0)), 0)
      from jsonb_array_elements(c -> 'precos') p
      join public.itens i on i.tiny_id = (p ->> 'produto_id')::bigint
      where (p ->> 'preco') is not null;
    end if;
    n_listas := n_listas + 1;
  end loop;

  return jsonb_build_object('vendedores', n_vend, 'formas_pagamento', n_formas, 'formas_envio', n_envio, 'listas_preco', n_listas);
end;
$$;
revoke execute on function public.robo_tiny_cadastros(uuid, text, jsonb) from public;
grant execute on function public.robo_tiny_cadastros(uuid, text, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Gravação do pedido pela tela, com os campos novos e as parcelas.
-- -----------------------------------------------------------------------------
create or replace function public.salvar_pedido_venda(dados jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  pedido uuid := nullif(dados ->> 'id', '')::uuid;
  item jsonb;
  primeira uuid;
  parcela jsonb;
  n integer := 0;
begin
  if jsonb_array_length(coalesce(dados -> 'itens', '[]')) = 0 then
    raise exception 'O pedido precisa de pelo menos um item';
  end if;
  if pedido is null then
    select id into primeira from public.etapas_pedido where ativa order by ordem limit 1;
    insert into public.pedidos_venda (
      empresa_id, cliente_id, canal, data_pedido, prazo_entrega, condicao_pagamento,
      prazo_recebimento_dias, prioridade, etapa_id, observacao
    ) values (
      (dados ->> 'empresa_id')::uuid, (dados ->> 'cliente_id')::uuid, coalesce(dados ->> 'canal', 'venda_direta'),
      coalesce((dados ->> 'data_pedido')::date, current_date), (dados ->> 'prazo_entrega')::date,
      nullif(trim(dados ->> 'condicao_pagamento'), ''), coalesce((dados ->> 'prazo_recebimento_dias')::integer, 0),
      coalesce((dados ->> 'prioridade')::smallint, 0), coalesce(nullif(dados ->> 'etapa_id', '')::uuid, primeira),
      nullif(trim(dados ->> 'observacao'), '')
    ) returning id into pedido;
  else
    update public.pedidos_venda set
      cliente_id = (dados ->> 'cliente_id')::uuid,
      prazo_entrega = (dados ->> 'prazo_entrega')::date,
      condicao_pagamento = nullif(trim(dados ->> 'condicao_pagamento'), ''),
      prazo_recebimento_dias = coalesce((dados ->> 'prazo_recebimento_dias')::integer, 0),
      prioridade = coalesce((dados ->> 'prioridade')::smallint, 0),
      observacao = nullif(trim(dados ->> 'observacao'), '')
    where id = pedido;
    if not found then
      raise exception 'Pedido não encontrado ou sem permissão para alterar';
    end if;
    delete from public.pedido_venda_itens where pedido_id = pedido;
  end if;

  -- Campos do Tiny (só os que vieram no formulário).
  if dados ? 'vendedor_cadastro_id' then
    update public.pedidos_venda set
      numero_ordem_compra = nullif(trim(dados ->> 'numero_ordem_compra'), ''),
      vendedor_cadastro_id = nullif(dados ->> 'vendedor_cadastro_id', '')::uuid,
      lista_preco_id = nullif(dados ->> 'lista_preco_id', '')::uuid,
      natureza_operacao_id = nullif(dados ->> 'natureza_operacao_id', '')::uuid,
      forma_pagamento_id = nullif(dados ->> 'forma_pagamento_id', '')::uuid,
      categoria_id = nullif(dados ->> 'categoria_id', '')::uuid,
      transportadora_id = nullif(dados ->> 'transportadora_id', '')::uuid,
      forma_envio_id = nullif(dados ->> 'forma_envio_id', '')::uuid,
      frete_por_conta = nullif(dados ->> 'frete_por_conta', ''),
      valor_frete = greatest(0, coalesce((dados ->> 'valor_frete')::numeric, 0)),
      valor_desconto = greatest(0, coalesce((dados ->> 'valor_desconto')::numeric, 0)),
      valor_outras_despesas = greatest(0, coalesce((dados ->> 'valor_outras_despesas')::numeric, 0)),
      endereco_entrega = case when jsonb_typeof(dados -> 'endereco_entrega') = 'object' and (dados -> 'endereco_entrega') <> '{}'
                              then dados -> 'endereco_entrega' end,
      observacao_interna = nullif(trim(dados ->> 'observacao_interna'), '')
    where id = pedido;
    delete from public.pedido_parcelas where pedido_id = pedido;
    for parcela in select * from jsonb_array_elements(coalesce(dados -> 'parcelas', '[]')) loop
      n := n + 1;
      insert into public.pedido_parcelas (pedido_id, numero, dias, vencimento, valor, forma_pagamento_id, observacao)
      values (pedido, n, (parcela ->> 'dias')::integer, nullif(parcela ->> 'vencimento', '')::date,
              coalesce((parcela ->> 'valor')::numeric, 0), nullif(parcela ->> 'forma_pagamento_id', '')::uuid,
              nullif(trim(parcela ->> 'observacao'), ''));
    end loop;
  end if;

  for item in select * from jsonb_array_elements(dados -> 'itens') loop
    insert into public.pedido_venda_itens (pedido_id, item_id, quantidade, preco_unitario, info_adicional)
    values (pedido, (item ->> 'item_id')::uuid, (item ->> 'quantidade')::numeric, coalesce((item ->> 'preco_unitario')::numeric, 0),
            nullif(trim(item ->> 'info_adicional'), ''));
  end loop;
  return pedido;
end;
$$;
