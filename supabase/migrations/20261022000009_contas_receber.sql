-- =============================================================================
-- Venner Gestão · Contas a receber, preço dos produtos e anúncios das plataformas
-- Os títulos a receber nascem dos pedidos das distribuidoras (parcelas pela
-- condição de pagamento) e das vendas do Mercado Livre e da Shopee (valor que
-- cai na conta, já sem comissão e frete). O custo padrão da ficha técnica dá a
-- margem de cada venda.
-- =============================================================================

insert into public.telas (codigo, titulo, grupo) values
  ('vendas.anuncios', 'Anúncios das plataformas', 'Vendas e E-commerce');

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, x.tela, a.acao
from (values
  ('E-commerce', 'vendas.anuncios'), ('E-commerce', 'financeiro.receber')
) as x(perfil, tela)
join public.perfis p on p.nome = x.perfil
cross join (values ('ver'::public.acao_permissao), ('criar'), ('editar')) as a(acao)
on conflict do nothing;

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, x.tela, 'ver'
from (values ('Financeiro', 'vendas.pedidos'), ('Comercial', 'financeiro.receber'), ('Financeiro', 'vendas.anuncios')) as x(perfil, tela)
join public.perfis p on p.nome = x.perfil
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Cadastro do produto: preço de venda (sugerido no pedido), NCM e peso.
-- -----------------------------------------------------------------------------
alter table public.itens
  add column preco_venda numeric(14, 2) not null default 0 check (preco_venda >= 0),
  add column ncm text check (ncm ~ '^\d{8}$'),
  add column peso_kg numeric(10, 3) check (peso_kg >= 0);

-- -----------------------------------------------------------------------------
-- Anúncios das plataformas: código do anúncio (ou SKU) de cada conta ligado ao
-- produto. Kit = mais de uma unidade (ou mais de um produto) por venda.
-- -----------------------------------------------------------------------------
create table public.anuncios_plataforma (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  canal text not null check (canal in ('mercado_livre', 'shopee', 'outro')),
  codigo text not null,
  titulo text,
  item_id uuid not null references public.itens(id),
  -- Unidades do produto em cada unidade vendida do anúncio.
  quantidade numeric(14, 4) not null default 1 check (quantidade > 0),
  criado_em timestamptz not null default now(),
  unique (empresa_id, canal, codigo, item_id)
);

-- -----------------------------------------------------------------------------
-- Contas a receber
-- -----------------------------------------------------------------------------
create table public.contas_receber (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  cliente_id uuid references public.clientes(id),
  pedido_id uuid references public.pedidos_venda(id),
  canal text not null default 'venda_direta' check (canal in ('venda_direta', 'mercado_livre', 'shopee', 'outro')),
  descricao text not null,
  parcela text,
  categoria_id uuid references public.plano_contas(id),
  -- Valor da venda; tarifas = comissão e frete que a plataforma desconta.
  valor numeric(14, 2) not null check (valor > 0),
  tarifas numeric(14, 2) not null default 0 check (tarifas >= 0),
  valor_liquido numeric(14, 2) generated always as (valor - tarifas) stored,
  -- Data prevista para o dinheiro cair (na plataforma, a liberação).
  vencimento date not null,
  situacao public.situacao_titulo not null default 'aberto',
  data_recebimento date,
  valor_recebido numeric(14, 2) check (valor_recebido > 0),
  conta_bancaria_id uuid references public.contas_bancarias(id),
  observacao text,
  usuario_id uuid default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now(),
  check (tarifas < valor),
  check (
    (situacao = 'pago') = (data_recebimento is not null and valor_recebido is not null and conta_bancaria_id is not null)
  )
);
create index contas_receber_vencimento_idx on public.contas_receber (empresa_id, situacao, vencimento);
create index contas_receber_pedido_idx on public.contas_receber (pedido_id);

-- Categoria de receita sem subcategorias; conta, cliente e pedido coerentes.
create function public.validar_conta_receber()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.categoria_id is not null then
    if exists (select 1 from public.plano_contas c where c.id = new.categoria_id and c.tipo <> 'receita') then
      raise exception 'Contas a receber usam categorias de receita';
    end if;
    if exists (select 1 from public.plano_contas c where c.pai_id = new.categoria_id) then
      raise exception 'Escolha a categoria mais detalhada (sem subcategorias abaixo dela)';
    end if;
  end if;
  if new.conta_bancaria_id is not null
     and not exists (select 1 from public.contas_bancarias b where b.id = new.conta_bancaria_id and b.empresa_id = new.empresa_id) then
    raise exception 'A conta bancária do recebimento precisa ser da mesma empresa do título';
  end if;
  if new.pedido_id is not null
     and not exists (select 1 from public.pedidos_venda p where p.id = new.pedido_id and p.empresa_id = new.empresa_id) then
    raise exception 'O título precisa ser da mesma empresa do pedido';
  end if;
  return new;
end;
$$;

create trigger validar_conta_receber
  before insert or update on public.contas_receber
  for each row execute function public.validar_conta_receber();

-- -----------------------------------------------------------------------------
-- Regras de acesso
-- -----------------------------------------------------------------------------
alter table public.anuncios_plataforma enable row level security;
alter table public.contas_receber enable row level security;

create policy ver on public.anuncios_plataforma for select to authenticated
  using ((public.tem_permissao('vendas.anuncios', 'ver') or public.tem_permissao('financeiro.receber', 'criar'))
    and public.pode_ver_empresa(empresa_id));
create policy criar on public.anuncios_plataforma for insert to authenticated
  with check ((public.tem_permissao('vendas.anuncios', 'criar') or public.tem_permissao('financeiro.receber', 'criar'))
    and public.pode_ver_empresa(empresa_id));
create policy editar on public.anuncios_plataforma for update to authenticated
  using (public.tem_permissao('vendas.anuncios', 'editar') and public.pode_ver_empresa(empresa_id))
  with check (public.tem_permissao('vendas.anuncios', 'editar') and public.pode_ver_empresa(empresa_id));
create policy excluir on public.anuncios_plataforma for delete to authenticated
  using (public.tem_permissao('vendas.anuncios', 'editar') and public.pode_ver_empresa(empresa_id));

create policy ver on public.contas_receber for select to authenticated
  using (public.tem_permissao('financeiro.receber', 'ver') and public.pode_ver_empresa(empresa_id));
create policy criar on public.contas_receber for insert to authenticated
  with check (public.tem_permissao('financeiro.receber', 'criar') and public.pode_ver_empresa(empresa_id));
create policy editar on public.contas_receber for update to authenticated
  using (public.tem_permissao('financeiro.receber', 'editar') and public.pode_ver_empresa(empresa_id))
  with check (public.tem_permissao('financeiro.receber', 'editar') and public.pode_ver_empresa(empresa_id));
create policy excluir on public.contas_receber for delete to authenticated
  using (public.tem_permissao('financeiro.receber', 'excluir') and public.pode_ver_empresa(empresa_id));

-- Quem cuida dos anúncios ou do receber escolhe os produtos.
drop policy ver on public.itens;
create policy ver on public.itens for select to authenticated
  using (public.tem_permissao('estoque.itens', 'ver') or public.tem_permissao('producao.ficha_tecnica', 'ver')
    or public.tem_permissao('financeiro.notas_fornecedor', 'ver') or public.tem_permissao('vendas.pedidos', 'ver')
    or public.tem_permissao('estoque.saldos', 'ver') or public.tem_permissao('vendas.anuncios', 'ver'));

do $$
declare
  t text;
begin
  foreach t in array array['anuncios_plataforma', 'contas_receber'] loop
    execute format(
      'create trigger auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()',
      t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Parcelas de um pedido das distribuidoras. Um pedido só tem um conjunto de
-- parcelas ativas: para refazer, cancele as que estão em aberto.
-- -----------------------------------------------------------------------------
create function public.gerar_receber_pedido(pedido uuid, parcelas jsonb, categoria uuid default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  p record;
  parc jsonb;
  total integer := jsonb_array_length(coalesce(parcelas, '[]'));
  n integer := 0;
begin
  if total = 0 then
    raise exception 'Informe pelo menos uma parcela';
  end if;
  select pv.id, pv.empresa_id, pv.cliente_id, pv.canal, pv.numero into p from public.pedidos_venda pv where pv.id = pedido;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  if exists (select 1 from public.contas_receber r where r.pedido_id = pedido and r.situacao <> 'cancelado') then
    raise exception 'Este pedido já tem contas a receber. Para refazer, cancele as parcelas em aberto';
  end if;
  for parc in select * from jsonb_array_elements(parcelas) loop
    n := n + 1;
    insert into public.contas_receber (empresa_id, cliente_id, pedido_id, canal, descricao, parcela, categoria_id, valor, vencimento)
    values (p.empresa_id, p.cliente_id, p.id, p.canal, 'Pedido nº ' || p.numero, n || '/' || total,
      coalesce(categoria, (select id from public.plano_contas where codigo = '1.01')),
      (parc ->> 'valor')::numeric, (parc ->> 'vencimento')::date);
  end loop;
  return n;
end;
$$;
revoke execute on function public.gerar_receber_pedido(uuid, jsonb, uuid) from public, anon;
grant execute on function public.gerar_receber_pedido(uuid, jsonb, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Vendas das plataformas (planilha exportada ou, depois, a API): cada venda
-- vira um pedido encerrado (canal + número da venda, sem repetir), a baixa do
-- estoque dos produtos e o título a receber pelo valor líquido.
-- vendas: [{numero, data, liberacao, comprador, valor, tarifas, itens: [{codigo, titulo, quantidade, valor}]}]
-- Todo código de anúncio precisa estar ligado a um produto antes.
-- -----------------------------------------------------------------------------
create function public.importar_vendas_plataforma(empresa uuid, canal_venda text, vendas jsonb, local_baixa uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  it jsonb;
  pedido uuid;
  cliente uuid;
  emitido uuid := (select id from public.etapas_pedido where ativa order by ordem limit 1);
  entregue uuid := (select id from public.etapas_pedido where fase = 'encerrado' and ativa order by ordem limit 1);
  importadas integer := 0;
  repetidas integer := 0;
  nome_canal text := case canal_venda when 'mercado_livre' then 'Mercado Livre' when 'shopee' then 'Shopee' else 'Outra plataforma' end;
  faltando text;
begin
  if not (public.tem_permissao('financeiro.receber', 'criar') or public.tem_permissao('vendas.pedidos', 'criar')) then
    raise exception 'Seu perfil não pode importar vendas';
  end if;
  if not public.pode_ver_empresa(empresa) then
    raise exception 'Você não tem acesso a esta empresa';
  end if;
  if canal_venda not in ('mercado_livre', 'shopee', 'outro') then
    raise exception 'Plataforma desconhecida';
  end if;
  if not exists (select 1 from public.locais_estoque l where l.id = local_baixa) then
    raise exception 'Escolha o local de onde sai o estoque';
  end if;

  select string_agg(distinct x.codigo, ', ') into faltando
  from jsonb_array_elements(vendas) vv, jsonb_to_recordset(vv -> 'itens') as x(codigo text)
  where not exists (select 1 from public.anuncios_plataforma a
                    where a.empresa_id = empresa and a.canal = canal_venda and a.codigo = x.codigo);
  if faltando is not null then
    raise exception 'Ligue estes anúncios a um produto antes de importar: %', faltando;
  end if;

  -- Cliente genérico por plataforma (o comprador fica na observação).
  select id into cliente from public.clientes where nome = 'Consumidor final · ' || nome_canal and canal = canal_venda;
  if cliente is null then
    insert into public.clientes (tipo_pessoa, nome, canal) values ('fisica', 'Consumidor final · ' || nome_canal, canal_venda)
    returning id into cliente;
  end if;

  for v in select * from jsonb_array_elements(vendas) loop
    if exists (select 1 from public.pedidos_venda p where p.canal = canal_venda and p.numero_externo = v ->> 'numero') then
      repetidas := repetidas + 1;
      continue;
    end if;
    insert into public.pedidos_venda (empresa_id, cliente_id, canal, numero_externo, data_pedido, prazo_entrega,
      prazo_recebimento_dias, etapa_id, observacao, condicao_pagamento)
    values (empresa, cliente, canal_venda, v ->> 'numero', (v ->> 'data')::date, (v ->> 'data')::date,
      greatest(0, (v ->> 'liberacao')::date - (v ->> 'data')::date), emitido,
      nullif(trim(coalesce(v ->> 'comprador', '')), ''), nome_canal)
    returning id into pedido;

    -- Itens do pedido e baixa do estoque, abrindo os kits pelo cadastro do anúncio.
    for it in select * from jsonb_array_elements(v -> 'itens') loop
      insert into public.pedido_venda_itens (pedido_id, item_id, quantidade, preco_unitario)
      select pedido, a.item_id, (it ->> 'quantidade')::numeric * a.quantidade,
        round((it ->> 'valor')::numeric / ((it ->> 'quantidade')::numeric * a.quantidade)
          / (select count(*) from public.anuncios_plataforma a2 where a2.empresa_id = empresa and a2.canal = canal_venda and a2.codigo = it ->> 'codigo'), 4)
      from public.anuncios_plataforma a
      where a.empresa_id = empresa and a.canal = canal_venda and a.codigo = it ->> 'codigo'
      on conflict do nothing;
    end loop;
    insert into public.movimentos_estoque (item_id, local_id, tipo, quantidade, custo_unitario, empresa_id, origem_tipo, origem_id, observacao)
    select i.item_id, local_baixa, 'saida', -sum(i.quantidade), max(it2.custo_medio), empresa, 'pedido_venda', pedido,
      nome_canal || ' venda ' || (v ->> 'numero')
    from public.pedido_venda_itens i join public.itens it2 on it2.id = i.item_id
    where i.pedido_id = pedido and it2.tipo <> 'servico'
    group by i.item_id;

    update public.pedidos_venda set etapa_id = coalesce(entregue, emitido) where id = pedido;

    insert into public.contas_receber (empresa_id, cliente_id, pedido_id, canal, descricao, categoria_id, valor, tarifas, vencimento, observacao)
    values (empresa, cliente, pedido, canal_venda, nome_canal || ' venda ' || (v ->> 'numero'),
      (select id from public.plano_contas where codigo = '1.02'),
      (v ->> 'valor')::numeric, least(coalesce((v ->> 'tarifas')::numeric, 0), (v ->> 'valor')::numeric - 0.01),
      (v ->> 'liberacao')::date, nullif(trim(coalesce(v ->> 'comprador', '')), ''));
    importadas := importadas + 1;
  end loop;
  return jsonb_build_object('importadas', importadas, 'repetidas', repetidas);
end;
$$;
revoke execute on function public.importar_vendas_plataforma(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.importar_vendas_plataforma(uuid, text, jsonb, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Custo padrão pela ficha técnica ativa (materiais com perda, nível por nível,
-- e operações pelo custo hora do posto). Item sem ficha usa o custo médio.
-- Aberto a quem vê pedidos, para mostrar a margem sem abrir a ficha.
-- -----------------------------------------------------------------------------
create function public.custo_padrao_item(item uuid, profundidade integer default 0)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f record;
  total numeric := 0;
  c record;
begin
  select ft.id, ft.quantidade_base into f from public.fichas_tecnicas ft where ft.item_id = item and ft.status = 'ativa';
  if f.id is null or profundidade > 10 then
    return coalesce((select custo_medio from public.itens where id = item), 0);
  end if;
  for c in select fc.componente_id, fc.quantidade, fc.perda_percentual from public.ficha_componentes fc where fc.ficha_id = f.id loop
    total := total + c.quantidade * (1 + c.perda_percentual / 100) * public.custo_padrao_item(c.componente_id, profundidade + 1);
  end loop;
  total := total + coalesce((
    select sum((o.tempo_setup_min + o.tempo_execucao_min) / 60 * coalesce(p.custo_hora, 0))
    from public.ficha_operacoes o left join public.postos_trabalho p on p.id = o.posto_id
    where o.ficha_id = f.id), 0);
  return round(total / f.quantidade_base, 4);
end;
$$;

create function public.custos_padrao(itens uuid[])
returns table (item_id uuid, custo numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.tem_permissao('vendas.pedidos', 'ver') or public.tem_permissao('financeiro.receber', 'ver')
          or public.tem_permissao('producao.ficha_tecnica', 'ver')) then
    raise exception 'Seu perfil não tem acesso ao custo dos produtos';
  end if;
  return query select i, public.custo_padrao_item(i) from unnest(itens) as i;
end;
$$;
revoke execute on function public.custo_padrao_item(uuid, integer) from public, anon, authenticated;
revoke execute on function public.custos_padrao(uuid[]) from public, anon;
grant execute on function public.custos_padrao(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Ligação direta com as plataformas (API). Cada conta do Mercado Livre ou loja
-- da Shopee fica ligada a um CNPJ. As chaves de acesso não são lidas pelas
-- telas: só as funções abaixo as tocam, conferindo o perfil.
-- -----------------------------------------------------------------------------
insert into public.telas (codigo, titulo, grupo) values
  ('config.integracoes', 'Integrações', 'Configurações');

create table public.integracoes_plataforma (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  canal text not null check (canal in ('mercado_livre', 'shopee')),
  -- Vendedor no Mercado Livre ou loja na Shopee.
  conta_externa text not null,
  apelido text,
  access_token text not null,
  refresh_token text,
  expira_em timestamptz,
  ultima_sincronizacao timestamptz,
  -- Local de onde sai o estoque das vendas sincronizadas.
  local_baixa_id uuid references public.locais_estoque(id),
  criado_em timestamptz not null default now(),
  unique (empresa_id, canal, conta_externa)
);
alter table public.integracoes_plataforma enable row level security;
-- Sem regra de leitura e sem acesso direto: a tabela só é lida pelas funções abaixo.
revoke all on public.integracoes_plataforma from anon, authenticated;

-- Auditoria sem as chaves: o histórico é lido por quem tem acesso à auditoria.
create function public.auditar_integracao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.auditoria (tabela, registro_id, acao, dados_antes, dados_depois, usuario_id)
  values (tg_table_name, coalesce(new.id, old.id)::text, tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'access_token' - 'refresh_token' end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'access_token' - 'refresh_token' end,
    (select auth.uid()));
  return coalesce(new, old);
end;
$$;
revoke execute on function public.auditar_integracao() from public, anon, authenticated;

create trigger auditoria after insert or update or delete on public.integracoes_plataforma
  for each row execute function public.auditar_integracao();

create function public.listar_integracoes()
returns table (id uuid, empresa_id uuid, canal text, conta_externa text, apelido text, expira_em timestamptz,
  ultima_sincronizacao timestamptz, local_baixa_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.empresa_id, i.canal, i.conta_externa, i.apelido, i.expira_em, i.ultima_sincronizacao, i.local_baixa_id
  from public.integracoes_plataforma i
  where (public.tem_permissao('config.integracoes', 'ver') or public.tem_permissao('financeiro.receber', 'criar'))
    and public.pode_ver_empresa(i.empresa_id)
  order by i.canal, i.apelido;
$$;

-- Grava a conta depois da autorização (ou a renovação do acesso).
create function public.salvar_integracao(empresa uuid, canal_conta text, conta text, nome text,
  acesso text, renovacao text, expira timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  novo uuid;
begin
  if not ((public.tem_permissao('config.integracoes', 'editar') or public.tem_permissao('financeiro.receber', 'criar'))
          and public.pode_ver_empresa(empresa)) then
    raise exception 'Seu perfil não pode ligar contas das plataformas nesta empresa';
  end if;
  insert into public.integracoes_plataforma (empresa_id, canal, conta_externa, apelido, access_token, refresh_token, expira_em)
  values (empresa, canal_conta, conta, nome, acesso, renovacao, expira)
  on conflict (empresa_id, canal, conta_externa) do update
    set access_token = excluded.access_token, refresh_token = coalesce(excluded.refresh_token, public.integracoes_plataforma.refresh_token),
        expira_em = excluded.expira_em, apelido = coalesce(excluded.apelido, public.integracoes_plataforma.apelido)
  returning id into novo;
  return novo;
end;
$$;

-- Chaves para o servidor sincronizar as vendas.
create function public.acesso_integracao(integracao uuid)
returns table (empresa_id uuid, canal text, conta_externa text, access_token text, refresh_token text, expira_em timestamptz,
  ultima_sincronizacao timestamptz, local_baixa_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.tem_permissao('financeiro.receber', 'criar') or public.tem_permissao('config.integracoes', 'editar')) then
    raise exception 'Seu perfil não pode sincronizar vendas';
  end if;
  return query
    select i.empresa_id, i.canal, i.conta_externa, i.access_token, i.refresh_token, i.expira_em, i.ultima_sincronizacao, i.local_baixa_id
    from public.integracoes_plataforma i
    where i.id = integracao and public.pode_ver_empresa(i.empresa_id);
end;
$$;

create function public.ajustar_integracao(integracao uuid, sincronizado_em timestamptz default null, local uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.integracoes_plataforma i
  set ultima_sincronizacao = coalesce(sincronizado_em, i.ultima_sincronizacao), local_baixa_id = coalesce(local, i.local_baixa_id)
  where i.id = integracao and public.pode_ver_empresa(i.empresa_id)
    and (public.tem_permissao('financeiro.receber', 'criar') or public.tem_permissao('config.integracoes', 'editar'));
  if not found then
    raise exception 'Integração não encontrada ou sem permissão';
  end if;
end;
$$;

create function public.remover_integracao(integracao uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.integracoes_plataforma i
  where i.id = integracao and public.pode_ver_empresa(i.empresa_id) and public.tem_permissao('config.integracoes', 'editar');
  if not found then
    raise exception 'Integração não encontrada ou sem permissão';
  end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'listar_integracoes()', 'salvar_integracao(uuid, text, text, text, text, text, timestamptz)', 'acesso_integracao(uuid)',
    'ajustar_integracao(uuid, timestamptz, uuid)', 'remover_integracao(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
