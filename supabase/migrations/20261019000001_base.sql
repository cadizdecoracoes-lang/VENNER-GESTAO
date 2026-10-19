-- =============================================================================
-- Venner Gestão · Estrutura base
-- Empresas do grupo (CNPJs), perfis de acesso por tela, usuários, auditoria,
-- estoque unificado e ficha técnica (estrutura de montagem e roteiro).
--
-- Regras de acesso ficam no próprio banco (Row Level Security): mesmo chamando
-- a API diretamente, cada usuário só lê e altera o que o perfil dele permite.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.regime_tributario as enum ('simples_nacional', 'lucro_presumido', 'lucro_real');
create type public.tipo_item as enum ('produto_acabado', 'subconjunto', 'materia_prima', 'embalagem', 'servico');
create type public.tipo_movimento as enum ('entrada', 'saida', 'ajuste');
create type public.status_ficha as enum ('rascunho', 'ativa', 'substituida');
create type public.acao_permissao as enum ('ver', 'criar', 'editar', 'aprovar', 'excluir');

-- -----------------------------------------------------------------------------
-- Empresas do grupo
-- -----------------------------------------------------------------------------
create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null,
  nome_fantasia text,
  cnpj text not null unique check (cnpj ~ '^\d{14}$'),
  regime_tributario public.regime_tributario not null,
  -- prestação de serviço, venda direta, marketplace...
  atividades text[] not null default '{}',
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);
comment on table public.empresas is 'CNPJs do grupo. Compras, faturamento e financeiro são separados por empresa; o estoque é único.';
comment on column public.empresas.cnpj is 'Somente os 14 dígitos, sem pontuação.';

-- Histórico de regime, para a visão tributária e o planejamento tributário.
create table public.empresas_regime_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  regime_tributario public.regime_tributario not null,
  vigencia_inicio date not null,
  unique (empresa_id, vigencia_inicio)
);

-- -----------------------------------------------------------------------------
-- Telas, perfis e usuários
-- -----------------------------------------------------------------------------
create table public.telas (
  codigo text primary key,
  titulo text not null,
  grupo text not null
);
comment on table public.telas is 'Mesmos códigos do menu em src/lib/menu.ts.';

create table public.perfis (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text,
  -- Diretoria vê todos os CNPJs; os demais perfis veem os atribuídos ao usuário.
  todas_empresas boolean not null default false,
  criado_em timestamptz not null default now()
);

create table public.perfil_permissoes (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  tela_codigo text not null references public.telas(codigo) on delete cascade,
  acao public.acao_permissao not null,
  primary key (perfil_id, tela_codigo, acao)
);

create table public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  perfil_id uuid references public.perfis(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.usuario_empresas (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  primary key (usuario_id, empresa_id)
);

-- Todo login novo ganha um registro em usuarios, inativo e sem perfil, até a
-- diretoria liberar.
create function public.criar_usuario_do_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usuarios (id, nome, email, ativo)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)), new.email, false);
  return new;
end;
$$;

create trigger ao_criar_login
  after insert on auth.users
  for each row execute function public.criar_usuario_do_login();

-- -----------------------------------------------------------------------------
-- Funções de permissão (usadas pelas políticas de RLS)
-- -----------------------------------------------------------------------------
create function public.tem_permissao(tela text, acao public.acao_permissao)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.perfil_permissoes p on p.perfil_id = u.perfil_id
    where u.id = (select auth.uid())
      and u.ativo
      and p.tela_codigo = tem_permissao.tela
      and p.acao = tem_permissao.acao
  );
$$;

create function public.pode_ver_empresa(empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.perfis pf on pf.id = u.perfil_id
    where u.id = (select auth.uid())
      and u.ativo
      and (
        pf.todas_empresas
        or exists (
          select 1 from public.usuario_empresas ue
          where ue.usuario_id = u.id and ue.empresa_id = pode_ver_empresa.empresa
        )
      )
  );
$$;

revoke execute on function public.tem_permissao(text, public.acao_permissao) from public, anon;
revoke execute on function public.pode_ver_empresa(uuid) from public, anon;
grant execute on function public.tem_permissao(text, public.acao_permissao) to authenticated;
grant execute on function public.pode_ver_empresa(uuid) to authenticated;
revoke execute on function public.criar_usuario_do_login() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Auditoria: quem mudou o quê e quando, em todas as tabelas de negócio
-- -----------------------------------------------------------------------------
create table public.auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id text,
  acao text not null,
  dados_antes jsonb,
  dados_depois jsonb,
  usuario_id uuid,
  criado_em timestamptz not null default now()
);
create index auditoria_registro_idx on public.auditoria (tabela, registro_id);

create function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into public.auditoria (tabela, registro_id, acao, dados_antes, dados_depois, usuario_id)
  values (
    tg_table_name,
    coalesce(depois ->> 'id', antes ->> 'id'),
    tg_op,
    antes,
    depois,
    (select auth.uid())
  );
  return coalesce(new, old);
end;
$$;
revoke execute on function public.registrar_auditoria() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Estoque unificado
-- -----------------------------------------------------------------------------
create table public.unidades (
  sigla text primary key,
  descricao text not null
);

create table public.itens (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  descricao text not null,
  tipo public.tipo_item not null,
  unidade text not null references public.unidades(sigla),
  estoque_minimo numeric(14, 4) not null default 0 check (estoque_minimo >= 0),
  prazo_reposicao_dias integer not null default 0 check (prazo_reposicao_dias >= 0),
  custo_medio numeric(14, 4) not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.locais_estoque (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true
);

create table public.movimentos_estoque (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.itens(id),
  local_id uuid not null references public.locais_estoque(id),
  data timestamptz not null default now(),
  tipo public.tipo_movimento not null,
  -- Positivo entra, negativo sai. Ajuste pode ter qualquer sinal.
  quantidade numeric(14, 4) not null check (quantidade <> 0),
  custo_unitario numeric(14, 4),
  -- CNPJ responsável pela compra ou venda que gerou o movimento (o estoque é do grupo).
  empresa_id uuid references public.empresas(id),
  -- Rastreabilidade: o documento que gerou o movimento (pedido, nota, ordem...).
  origem_tipo text not null,
  origem_id uuid,
  observacao text,
  usuario_id uuid default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now(),
  check (
    (tipo = 'entrada' and quantidade > 0)
    or (tipo = 'saida' and quantidade < 0)
    or tipo = 'ajuste'
  )
);
create index movimentos_item_idx on public.movimentos_estoque (item_id, local_id);
create index movimentos_origem_idx on public.movimentos_estoque (origem_tipo, origem_id);

create view public.saldos_estoque
with (security_invoker = true) as
select m.item_id, m.local_id, sum(m.quantidade) as saldo
from public.movimentos_estoque m
group by m.item_id, m.local_id;

-- -----------------------------------------------------------------------------
-- Ficha técnica: estrutura de montagem (BOM) multinível e roteiro de operações
-- -----------------------------------------------------------------------------
create table public.postos_trabalho (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  custo_hora numeric(14, 4) not null default 0 check (custo_hora >= 0),
  capacidade_horas_dia numeric(6, 2) not null default 8 check (capacidade_horas_dia > 0),
  ativo boolean not null default true
);

create table public.fichas_tecnicas (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.itens(id),
  versao integer not null check (versao > 0),
  status public.status_ficha not null default 'rascunho',
  vigencia_inicio date,
  -- Quantas unidades do item uma execução da ficha produz.
  quantidade_base numeric(14, 4) not null default 1 check (quantidade_base > 0),
  observacao text,
  criado_em timestamptz not null default now(),
  unique (item_id, versao)
);
-- Só uma versão ativa por produto.
create unique index fichas_uma_ativa_idx on public.fichas_tecnicas (item_id) where status = 'ativa';

create table public.ficha_componentes (
  id uuid primary key default gen_random_uuid(),
  ficha_id uuid not null references public.fichas_tecnicas(id) on delete cascade,
  componente_id uuid not null references public.itens(id),
  quantidade numeric(14, 6) not null check (quantidade > 0),
  perda_percentual numeric(5, 2) not null default 0 check (perda_percentual >= 0 and perda_percentual < 100),
  unique (ficha_id, componente_id)
);

create table public.ficha_operacoes (
  id uuid primary key default gen_random_uuid(),
  ficha_id uuid not null references public.fichas_tecnicas(id) on delete cascade,
  sequencia integer not null check (sequencia > 0),
  descricao text not null,
  posto_id uuid references public.postos_trabalho(id),
  tempo_setup_min numeric(10, 2) not null default 0 check (tempo_setup_min >= 0),
  tempo_execucao_min numeric(10, 2) not null default 0 check (tempo_execucao_min >= 0),
  instrucoes text,
  unique (ficha_id, sequencia)
);

-- Uma ficha não pode usar o próprio produto como componente.
create function public.validar_componente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.fichas_tecnicas f where f.id = new.ficha_id and f.item_id = new.componente_id) then
    raise exception 'O produto não pode ser componente da própria ficha técnica';
  end if;
  return new;
end;
$$;

create trigger validar_componente
  before insert or update on public.ficha_componentes
  for each row execute function public.validar_componente();

-- -----------------------------------------------------------------------------
-- Gatilhos de auditoria
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'empresas', 'empresas_regime_historico', 'perfis', 'perfil_permissoes', 'usuarios', 'usuario_empresas',
    'itens', 'locais_estoque', 'movimentos_estoque',
    'postos_trabalho', 'fichas_tecnicas', 'ficha_componentes', 'ficha_operacoes'
  ] loop
    execute format(
      'create trigger auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()',
      t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.empresas enable row level security;
alter table public.empresas_regime_historico enable row level security;
alter table public.telas enable row level security;
alter table public.perfis enable row level security;
alter table public.perfil_permissoes enable row level security;
alter table public.usuarios enable row level security;
alter table public.usuario_empresas enable row level security;
alter table public.auditoria enable row level security;
alter table public.unidades enable row level security;
alter table public.itens enable row level security;
alter table public.locais_estoque enable row level security;
alter table public.movimentos_estoque enable row level security;
alter table public.postos_trabalho enable row level security;
alter table public.fichas_tecnicas enable row level security;
alter table public.ficha_componentes enable row level security;
alter table public.ficha_operacoes enable row level security;

-- Cria as quatro políticas padrão (ver/criar/editar/excluir) de uma tabela
-- ligada a uma tela. Usada só durante as migrações.
create function public.politicas_por_tela(tabela text, tela text, tela_leitura_extra text default null)
returns void
language plpgsql
as $$
declare
  ver text := format('public.tem_permissao(%L, ''ver'')', tela);
begin
  if tela_leitura_extra is not null then
    ver := ver || format(' or public.tem_permissao(%L, ''ver'')', tela_leitura_extra);
  end if;
  execute format('create policy ver on public.%I for select to authenticated using (%s)', tabela, ver);
  execute format('create policy criar on public.%I for insert to authenticated with check (public.tem_permissao(%L, ''criar''))', tabela, tela);
  execute format('create policy editar on public.%I for update to authenticated using (public.tem_permissao(%L, ''editar'')) with check (public.tem_permissao(%L, ''editar''))', tabela, tela, tela);
  execute format('create policy excluir on public.%I for delete to authenticated using (public.tem_permissao(%L, ''excluir''))', tabela, tela);
end;
$$;
revoke execute on function public.politicas_por_tela(text, text, text) from public, anon, authenticated;

-- Empresas: cada um vê os CNPJs liberados; cadastro só com permissão.
create policy ver on public.empresas for select to authenticated
  using (public.pode_ver_empresa(id) or public.tem_permissao('config.empresas', 'ver'));
create policy criar on public.empresas for insert to authenticated
  with check (public.tem_permissao('config.empresas', 'criar'));
create policy editar on public.empresas for update to authenticated
  using (public.tem_permissao('config.empresas', 'editar'))
  with check (public.tem_permissao('config.empresas', 'editar'));
create policy excluir on public.empresas for delete to authenticated
  using (public.tem_permissao('config.empresas', 'excluir'));

select public.politicas_por_tela('empresas_regime_historico', 'config.empresas', 'estrategico.tributario');

-- Telas: todo usuário logado lê a lista (monta o menu).
create policy ver on public.telas for select to authenticated using (true);

select public.politicas_por_tela('perfis', 'config.perfis', 'config.usuarios');
select public.politicas_por_tela('perfil_permissoes', 'config.perfis');

-- Usuários: cada um vê o próprio cadastro; gestão só com permissão.
create policy ver on public.usuarios for select to authenticated
  using (id = (select auth.uid()) or public.tem_permissao('config.usuarios', 'ver'));
create policy editar on public.usuarios for update to authenticated
  using (public.tem_permissao('config.usuarios', 'editar'))
  with check (public.tem_permissao('config.usuarios', 'editar'));
create policy excluir on public.usuarios for delete to authenticated
  using (public.tem_permissao('config.usuarios', 'excluir'));

create policy ver on public.usuario_empresas for select to authenticated
  using (usuario_id = (select auth.uid()) or public.tem_permissao('config.usuarios', 'ver'));
create policy criar on public.usuario_empresas for insert to authenticated
  with check (public.tem_permissao('config.usuarios', 'editar'));
create policy excluir on public.usuario_empresas for delete to authenticated
  using (public.tem_permissao('config.usuarios', 'editar'));

-- Auditoria: só leitura, para quem gerencia usuários (a escrita é pelo gatilho).
create policy ver on public.auditoria for select to authenticated
  using (public.tem_permissao('config.atualizacoes', 'ver') or public.tem_permissao('config.usuarios', 'ver'));

-- Estoque e produção
create policy ver on public.unidades for select to authenticated using (true);
select public.politicas_por_tela('itens', 'estoque.itens', 'producao.ficha_tecnica');
select public.politicas_por_tela('locais_estoque', 'estoque.itens', 'estoque.saldos');
select public.politicas_por_tela('movimentos_estoque', 'estoque.movimentos', 'estoque.saldos');
select public.politicas_por_tela('postos_trabalho', 'producao.postos', 'producao.ficha_tecnica');
select public.politicas_por_tela('fichas_tecnicas', 'producao.ficha_tecnica');
select public.politicas_por_tela('ficha_componentes', 'producao.ficha_tecnica');
select public.politicas_por_tela('ficha_operacoes', 'producao.ficha_tecnica');

-- Movimento de estoque é registro de origem: não se edita nem se apaga, corrige-se com ajuste.
drop policy editar on public.movimentos_estoque;
drop policy excluir on public.movimentos_estoque;

-- -----------------------------------------------------------------------------
-- Dados iniciais
-- -----------------------------------------------------------------------------
insert into public.telas (codigo, titulo, grupo) values
  ('painel', 'Painel', 'Painel'),
  ('producao.ordens', 'Ordens de produção', 'Produção'),
  ('producao.ficha_tecnica', 'Ficha técnica', 'Produção'),
  ('producao.sequenciamento', 'Sequenciamento', 'Produção'),
  ('producao.apontamentos', 'Apontamentos', 'Produção'),
  ('producao.postos', 'Postos de trabalho', 'Produção'),
  ('estoque.saldos', 'Saldos', 'Estoque'),
  ('estoque.movimentos', 'Movimentações', 'Estoque'),
  ('estoque.itens', 'Itens', 'Estoque'),
  ('compras.sugestoes', 'Sugestões de compra', 'Compras'),
  ('compras.pedidos', 'Pedidos de compra', 'Compras'),
  ('compras.fornecedores', 'Fornecedores', 'Compras'),
  ('vendas.pedidos', 'Pedidos de venda', 'Vendas e E-commerce'),
  ('vendas.clientes', 'Clientes', 'Vendas e E-commerce'),
  ('financeiro.pagar', 'Contas a pagar', 'Financeiro'),
  ('financeiro.receber', 'Contas a receber', 'Financeiro'),
  ('financeiro.conciliacao', 'Conciliação bancária', 'Financeiro'),
  ('financeiro.fluxo_caixa', 'Fluxo de caixa', 'Financeiro'),
  ('rh.funcionarios', 'Funcionários', 'RH'),
  ('rh.ponto', 'Ponto e escalas', 'RH'),
  ('rh.ferias', 'Férias e 13º', 'RH'),
  ('rh.folha', 'Conferência da folha', 'RH'),
  ('estrategico.indicadores', 'Indicadores', 'Estratégico'),
  ('estrategico.tributario', 'Visão tributária', 'Estratégico'),
  ('config.empresas', 'Empresas do grupo', 'Configurações'),
  ('config.usuarios', 'Usuários', 'Configurações'),
  ('config.perfis', 'Perfis de acesso', 'Configurações'),
  ('config.atualizacoes', 'Atualizações', 'Configurações');

insert into public.unidades (sigla, descricao) values
  ('UN', 'Unidade'), ('PC', 'Peça'), ('CJ', 'Conjunto'), ('KG', 'Quilograma'),
  ('G', 'Grama'), ('M', 'Metro'), ('M2', 'Metro quadrado'), ('L', 'Litro'), ('CX', 'Caixa');

insert into public.locais_estoque (nome) values ('Principal');

insert into public.perfis (nome, descricao, todas_empresas) values
  ('Diretoria', 'Acesso total, inclusive ao consolidado do grupo', true),
  ('Financeiro', 'Financeiro e conciliação; compras para consulta', false),
  ('PCP / Produção', 'Ficha técnica, ordens, sequenciamento e estoque', false),
  ('Operador de linha', 'Apontamentos da produção', false),
  ('Compras', 'Compras, fornecedores e sugestões do MRP', false),
  ('E-commerce', 'Pedidos dos marketplaces e consulta de estoque', false),
  ('RH', 'Módulo de RH', false),
  ('Contabilidade', 'Consulta de RH e financeiro para conferência', false);

-- Diretoria: todas as ações em todas as telas.
insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, t.codigo, a.acao
from public.perfis p
cross join public.telas t
cross join unnest(enum_range(null::public.acao_permissao)) as a(acao)
where p.nome = 'Diretoria';

-- Demais perfis: telas liberadas (ver + criar + editar; aprovar e excluir ficam com a diretoria).
insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, x.tela, a.acao
from (values
  ('Financeiro', 'painel'), ('Financeiro', 'financeiro.pagar'), ('Financeiro', 'financeiro.receber'),
  ('Financeiro', 'financeiro.conciliacao'), ('Financeiro', 'financeiro.fluxo_caixa'),
  ('PCP / Produção', 'painel'), ('PCP / Produção', 'producao.ordens'), ('PCP / Produção', 'producao.ficha_tecnica'),
  ('PCP / Produção', 'producao.sequenciamento'), ('PCP / Produção', 'producao.apontamentos'),
  ('PCP / Produção', 'producao.postos'), ('PCP / Produção', 'estoque.saldos'),
  ('PCP / Produção', 'estoque.movimentos'), ('PCP / Produção', 'estoque.itens'),
  ('Operador de linha', 'producao.apontamentos'),
  ('Compras', 'painel'), ('Compras', 'compras.sugestoes'), ('Compras', 'compras.pedidos'),
  ('Compras', 'compras.fornecedores'),
  ('E-commerce', 'painel'), ('E-commerce', 'vendas.pedidos'), ('E-commerce', 'vendas.clientes'),
  ('RH', 'rh.funcionarios'), ('RH', 'rh.ponto'), ('RH', 'rh.ferias'), ('RH', 'rh.folha')
) as x(perfil, tela)
join public.perfis p on p.nome = x.perfil
cross join (values ('ver'::public.acao_permissao), ('criar'), ('editar')) as a(acao);

-- Telas só de consulta.
insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, x.tela, 'ver'
from (values
  ('Financeiro', 'compras.pedidos'),
  ('Operador de linha', 'producao.ordens'), ('Operador de linha', 'producao.ficha_tecnica'),
  ('Compras', 'estoque.saldos'), ('Compras', 'estoque.itens'),
  ('E-commerce', 'estoque.saldos'),
  ('Contabilidade', 'rh.funcionarios'), ('Contabilidade', 'rh.folha'), ('Contabilidade', 'rh.ferias'),
  ('Contabilidade', 'financeiro.pagar'), ('Contabilidade', 'financeiro.receber'),
  ('Contabilidade', 'financeiro.conciliacao'), ('Contabilidade', 'estrategico.tributario')
) as x(perfil, tela)
join public.perfis p on p.nome = x.perfil;
