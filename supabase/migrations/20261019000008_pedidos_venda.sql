-- =============================================================================
-- Venner Gestão · Pedidos de venda, etapas do pedido e inventário
-- Pedidos lançados pelo comercial (Venner) passam por etapas cadastráveis. Os
-- pedidos em fase de produção alimentam a necessidade de materiais e a fila
-- de produção. O inventário acerta o estoque com a contagem física.
-- =============================================================================

insert into public.telas (codigo, titulo, grupo) values
  ('vendas.etapas', 'Etapas do pedido', 'Vendas e E-commerce');

insert into public.perfis (nome, descricao, todas_empresas) values
  ('Comercial', 'Pedidos de venda, clientes e consulta de estoque e produção', false);

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, x.tela, a.acao
from (values
  ('Comercial', 'painel'), ('Comercial', 'vendas.pedidos'), ('Comercial', 'vendas.clientes')
) as x(perfil, tela)
join public.perfis p on p.nome = x.perfil
cross join (values ('ver'::public.acao_permissao), ('criar'), ('editar')) as a(acao);

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, x.tela, 'ver'
from (values
  ('Comercial', 'estoque.saldos'), ('Comercial', 'producao.sequenciamento'), ('Comercial', 'vendas.etapas'),
  ('PCP / Produção', 'vendas.pedidos'), ('PCP / Produção', 'vendas.etapas'), ('PCP / Produção', 'compras.sugestoes'),
  ('Compras', 'producao.sequenciamento')
) as x(perfil, tela)
join public.perfis p on p.nome = x.perfil
on conflict do nothing;

-- PCP muda a etapa dos pedidos em produção.
insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'vendas.pedidos', 'editar' from public.perfis p where p.nome = 'PCP / Produção'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Etapas do pedido (cadastráveis). A fase diz o que a etapa significa para o
-- sistema: negociação (ainda não confirmado), produção (confirmado, precisa
-- ser produzido), expedição (pronto) ou encerrado (entregue ou cancelado).
-- -----------------------------------------------------------------------------
create type public.fase_pedido as enum ('negociacao', 'producao', 'expedicao', 'encerrado');

create table public.etapas_pedido (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ordem integer not null,
  fase public.fase_pedido not null,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

insert into public.etapas_pedido (nome, ordem, fase) values
  ('Emitido', 10, 'negociacao'),
  ('Aguardando retorno do cliente', 20, 'negociacao'),
  ('Confirmado pelo cliente', 30, 'producao'),
  ('Em produção', 40, 'producao'),
  ('Montagem', 50, 'producao'),
  ('Embalagem', 60, 'producao'),
  ('Aguardando coleta', 70, 'expedicao'),
  ('Em trânsito', 80, 'expedicao'),
  ('Entregue', 90, 'encerrado'),
  ('Cancelado', 100, 'encerrado');

-- -----------------------------------------------------------------------------
-- Pedidos de venda
-- -----------------------------------------------------------------------------
create table public.pedidos_venda (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  empresa_id uuid not null references public.empresas(id),
  cliente_id uuid not null references public.clientes(id),
  canal text not null default 'venda_direta' check (canal in ('venda_direta', 'mercado_livre', 'shopee', 'outro')),
  -- Pedido no marketplace, quando importado.
  numero_externo text,
  data_pedido date not null default current_date,
  -- Data prometida ao cliente.
  prazo_entrega date,
  condicao_pagamento text,
  -- Em quantos dias, em média, o dinheiro entra depois da entrega.
  prazo_recebimento_dias integer not null default 0 check (prazo_recebimento_dias >= 0),
  -- 0 normal, 1 alta, 2 urgente: definida pela diretoria para furar a fila.
  prioridade smallint not null default 0 check (prioridade between 0 and 2),
  etapa_id uuid not null references public.etapas_pedido(id),
  etapa_desde timestamptz not null default now(),
  observacao text,
  vendedor_id uuid default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now(),
  unique (canal, numero_externo)
);
create index pedidos_venda_etapa_idx on public.pedidos_venda (etapa_id);

create table public.pedido_venda_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_venda(id) on delete cascade,
  item_id uuid not null references public.itens(id),
  quantidade numeric(14, 4) not null check (quantidade > 0),
  preco_unitario numeric(14, 4) not null default 0 check (preco_unitario >= 0),
  valor_total numeric(14, 2) generated always as (round(quantidade * preco_unitario, 2)) stored,
  unique (pedido_id, item_id)
);

-- Cada troca de etapa fica no histórico, com quem trocou e quando.
create table public.pedido_etapas_historico (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos_venda(id) on delete cascade,
  etapa_id uuid not null references public.etapas_pedido(id),
  usuario_id uuid default auth.uid() references public.usuarios(id),
  em timestamptz not null default now()
);
create index pedido_etapas_historico_idx on public.pedido_etapas_historico (pedido_id, em);

create function public.registrar_etapa_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.etapa_id is distinct from old.etapa_id then
    insert into public.pedido_etapas_historico (pedido_id, etapa_id) values (new.id, new.etapa_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.registrar_etapa_pedido() from public, anon, authenticated;

create function public.marcar_etapa_desde()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.etapa_id is distinct from old.etapa_id then
    new.etapa_desde := now();
  end if;
  return new;
end;
$$;

create trigger marcar_etapa_desde
  before update on public.pedidos_venda
  for each row execute function public.marcar_etapa_desde();
create trigger registrar_etapa_pedido
  after insert or update of etapa_id on public.pedidos_venda
  for each row execute function public.registrar_etapa_pedido();

-- Total do pedido e fase atual, para listas, funil e painel.
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
-- Regras de acesso. Quem planeja produção e compras enxerga os pedidos de
-- todos os CNPJs (o estoque e a fábrica são do grupo).
-- -----------------------------------------------------------------------------
alter table public.etapas_pedido enable row level security;
alter table public.pedidos_venda enable row level security;
alter table public.pedido_venda_itens enable row level security;
alter table public.pedido_etapas_historico enable row level security;

create policy ver on public.etapas_pedido for select to authenticated using (true);
create policy criar on public.etapas_pedido for insert to authenticated with check (public.tem_permissao('vendas.etapas', 'criar'));
create policy editar on public.etapas_pedido for update to authenticated
  using (public.tem_permissao('vendas.etapas', 'editar')) with check (public.tem_permissao('vendas.etapas', 'editar'));
create policy excluir on public.etapas_pedido for delete to authenticated using (public.tem_permissao('vendas.etapas', 'excluir'));

create function public.pode_ver_pedido(empresa uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (public.tem_permissao('vendas.pedidos', 'ver') and public.pode_ver_empresa(empresa))
    or public.tem_permissao('producao.sequenciamento', 'ver')
    or public.tem_permissao('compras.sugestoes', 'ver');
$$;

create policy ver on public.pedidos_venda for select to authenticated using (public.pode_ver_pedido(empresa_id));
create policy criar on public.pedidos_venda for insert to authenticated
  with check (public.tem_permissao('vendas.pedidos', 'criar') and public.pode_ver_empresa(empresa_id));
-- PCP troca a etapa dos pedidos de qualquer CNPJ; o comercial só dos seus.
create policy editar on public.pedidos_venda for update to authenticated
  using (public.tem_permissao('vendas.pedidos', 'editar') and public.pode_ver_pedido(empresa_id))
  with check (public.tem_permissao('vendas.pedidos', 'editar') and public.pode_ver_pedido(empresa_id));
create policy excluir on public.pedidos_venda for delete to authenticated
  using (public.tem_permissao('vendas.pedidos', 'excluir') and public.pode_ver_empresa(empresa_id));

create policy ver on public.pedido_venda_itens for select to authenticated
  using (exists (select 1 from public.pedidos_venda p where p.id = pedido_id));
create policy criar on public.pedido_venda_itens for insert to authenticated
  with check (exists (select 1 from public.pedidos_venda p
    where p.id = pedido_id and public.tem_permissao('vendas.pedidos', 'criar') and public.pode_ver_empresa(p.empresa_id)));
create policy editar on public.pedido_venda_itens for update to authenticated
  using (exists (select 1 from public.pedidos_venda p
    where p.id = pedido_id and public.tem_permissao('vendas.pedidos', 'editar') and public.pode_ver_empresa(p.empresa_id)));
create policy excluir on public.pedido_venda_itens for delete to authenticated
  using (exists (select 1 from public.pedidos_venda p
    where p.id = pedido_id and public.tem_permissao('vendas.pedidos', 'editar') and public.pode_ver_empresa(p.empresa_id)));

create policy ver on public.pedido_etapas_historico for select to authenticated
  using (exists (select 1 from public.pedidos_venda p where p.id = pedido_id));

-- Os itens do pedido mudam só enquanto ele está em negociação.
create function public.bloquear_itens_pedido()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fase_atual public.fase_pedido;
begin
  select e.fase into fase_atual
  from public.pedidos_venda p join public.etapas_pedido e on e.id = p.etapa_id
  where p.id = coalesce(new.pedido_id, old.pedido_id);
  if fase_atual is not null and fase_atual <> 'negociacao' then
    raise exception 'Os itens só podem mudar enquanto o pedido está em negociação. Volte a etapa para alterar.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger bloquear_itens_pedido
  before insert or update or delete on public.pedido_venda_itens
  for each row execute function public.bloquear_itens_pedido();

-- Lança cabeçalho e itens de uma vez.
create function public.salvar_pedido_venda(dados jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  pedido uuid := nullif(dados ->> 'id', '')::uuid;
  item jsonb;
  primeira uuid;
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

  for item in select * from jsonb_array_elements(dados -> 'itens') loop
    insert into public.pedido_venda_itens (pedido_id, item_id, quantidade, preco_unitario)
    values (pedido, (item ->> 'item_id')::uuid, (item ->> 'quantidade')::numeric, coalesce((item ->> 'preco_unitario')::numeric, 0));
  end loop;
  return pedido;
end;
$$;
revoke execute on function public.salvar_pedido_venda(jsonb) from public, anon;
grant execute on function public.salvar_pedido_venda(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Inventário: a contagem física vira um ajuste da diferença, com origem
-- "inventario". O saldo passa a ser exatamente o contado.
-- -----------------------------------------------------------------------------
create function public.registrar_inventario(local uuid, contagens jsonb, observacao text default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  c jsonb;
  item uuid;
  contado numeric;
  atual numeric;
  ajustes integer := 0;
begin
  if not public.tem_permissao('estoque.movimentos', 'criar') then
    raise exception 'Seu perfil não pode lançar inventário';
  end if;
  for c in select * from jsonb_array_elements(contagens) loop
    item := (c ->> 'item_id')::uuid;
    contado := (c ->> 'quantidade')::numeric;
    if contado < 0 then
      raise exception 'A quantidade contada não pode ser negativa';
    end if;
    select coalesce(sum(m.quantidade), 0) into atual
    from public.movimentos_estoque m where m.item_id = item and m.local_id = local;
    if contado <> atual then
      insert into public.movimentos_estoque (item_id, local_id, tipo, quantidade, custo_unitario, origem_tipo, observacao)
      select item, local, 'ajuste', contado - atual, i.custo_medio, 'inventario',
             coalesce(nullif(trim(observacao), ''), 'Inventário') || ' (contado ' || contado || ', sistema ' || atual || ')'
      from public.itens i where i.id = item;
      ajustes := ajustes + 1;
    end if;
  end loop;
  return ajustes;
end;
$$;
revoke execute on function public.registrar_inventario(uuid, jsonb, text) from public, anon;
grant execute on function public.registrar_inventario(uuid, jsonb, text) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['etapas_pedido', 'pedidos_venda', 'pedido_venda_itens'] loop
    execute format(
      'create trigger auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()',
      t
    );
  end loop;
end;
$$;

-- O comercial escolhe os produtos do pedido; quem consulta saldos vê o nome dos itens.
drop policy ver on public.itens;
create policy ver on public.itens for select to authenticated
  using (public.tem_permissao('estoque.itens', 'ver') or public.tem_permissao('producao.ficha_tecnica', 'ver')
    or public.tem_permissao('financeiro.notas_fornecedor', 'ver') or public.tem_permissao('vendas.pedidos', 'ver')
    or public.tem_permissao('estoque.saldos', 'ver'));

-- -----------------------------------------------------------------------------
-- Dados do planejamento (necessidade de materiais e fila de produção) numa
-- consulta só: pedidos em fase de produção, estrutura ativa, saldos e postos.
-- O cálculo é feito pela tela; aqui só se garante quem pode ver o quadro todo.
-- -----------------------------------------------------------------------------
create function public.dados_planejamento()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.tem_permissao('producao.sequenciamento', 'ver') or public.tem_permissao('compras.sugestoes', 'ver')) then
    raise exception 'Seu perfil não tem acesso ao planejamento da produção';
  end if;
  return jsonb_build_object(
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'numero', p.numero, 'empresa_id', p.empresa_id, 'cliente', coalesce(c.nome_fantasia, c.nome),
        'data_pedido', p.data_pedido, 'prazo_entrega', p.prazo_entrega, 'prazo_recebimento_dias', p.prazo_recebimento_dias,
        'prioridade', p.prioridade, 'etapa', e.nome, 'etapa_ordem', e.ordem,
        'itens', (select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'quantidade', i.quantidade, 'valor_total', i.valor_total))
                  from public.pedido_venda_itens i where i.pedido_id = p.id)
      ) order by p.numero)
      from public.pedidos_venda p
      join public.etapas_pedido e on e.id = p.etapa_id
      join public.clientes c on c.id = p.cliente_id
      where e.fase = 'producao'
    ), '[]'),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'codigo', i.codigo, 'descricao', i.descricao, 'tipo', i.tipo, 'unidade', i.unidade,
        'prazo_reposicao_dias', i.prazo_reposicao_dias, 'estoque_minimo', i.estoque_minimo, 'custo_medio', i.custo_medio,
        'saldo', coalesce((select sum(m.quantidade) from public.movimentos_estoque m where m.item_id = i.id), 0)
      ) order by i.codigo)
      from public.itens i
    ), '[]'),
    'fichas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', f.item_id, 'quantidade_base', f.quantidade_base,
        'componentes', coalesce((select jsonb_agg(jsonb_build_object(
            'componente_id', fc.componente_id, 'quantidade', fc.quantidade, 'perda_percentual', fc.perda_percentual))
          from public.ficha_componentes fc where fc.ficha_id = f.id), '[]'),
        'operacoes', coalesce((select jsonb_agg(jsonb_build_object(
            'posto_id', o.posto_id, 'tempo_setup_min', o.tempo_setup_min, 'tempo_execucao_min', o.tempo_execucao_min) order by o.sequencia)
          from public.ficha_operacoes o where o.ficha_id = f.id), '[]')
      ))
      from public.fichas_tecnicas f
      where f.status = 'ativa'
    ), '[]'),
    'postos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'capacidade_horas_dia', p.capacidade_horas_dia))
      from public.postos_trabalho p where p.ativo
    ), '[]')
  );
end;
$$;
revoke execute on function public.dados_planejamento() from public, anon;
grant execute on function public.dados_planejamento() to authenticated;

-- Histórico de etapas com o nome de quem mudou (o cadastro de usuários é
-- restrito; aqui só sai o nome, e só para quem enxerga o pedido).
create function public.historico_pedido(pedido uuid)
returns table (etapa text, fase public.fase_pedido, em timestamptz, usuario text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.nome, e.fase, h.em, u.nome
  from public.pedido_etapas_historico h
  join public.pedidos_venda p on p.id = h.pedido_id
  join public.etapas_pedido e on e.id = h.etapa_id
  left join public.usuarios u on u.id = h.usuario_id
  where h.pedido_id = pedido and public.pode_ver_pedido(p.empresa_id)
  order by h.em, h.id;
$$;
revoke execute on function public.historico_pedido(uuid) from public, anon;
grant execute on function public.historico_pedido(uuid) to authenticated;
