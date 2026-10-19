-- =============================================================================
-- Venner Gestão · Cadastros do financeiro
-- Contas bancárias (de cada CNPJ), plano de contas e centros de custo (do grupo).
-- =============================================================================

insert into public.telas (codigo, titulo, grupo) values
  ('financeiro.contas_bancarias', 'Contas bancárias', 'Financeiro'),
  ('financeiro.categorias', 'Categorias financeiras', 'Financeiro'),
  ('financeiro.centros_custo', 'Centros de custo', 'Financeiro');

-- Financeiro mantém os três cadastros; Contabilidade consulta o plano de contas.
-- (A Diretoria recebe as telas novas automaticamente.)
insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, x.tela, a.acao
from (values
  ('Financeiro', 'financeiro.contas_bancarias'),
  ('Financeiro', 'financeiro.categorias'),
  ('Financeiro', 'financeiro.centros_custo')
) as x(perfil, tela)
join public.perfis p on p.nome = x.perfil
cross join (values ('ver'::public.acao_permissao), ('criar'), ('editar')) as a(acao);

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'financeiro.categorias', 'ver' from public.perfis p where p.nome = 'Contabilidade';

-- -----------------------------------------------------------------------------
-- Contas bancárias: cada conta pertence a um CNPJ, e só quem enxerga o CNPJ
-- enxerga a conta.
-- -----------------------------------------------------------------------------
create type public.tipo_conta_bancaria as enum ('corrente', 'poupanca', 'aplicacao', 'caixa');

create table public.contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  -- Apelido mostrado nas telas, ex.: "Itaú movimento".
  nome text not null,
  tipo public.tipo_conta_bancaria not null default 'corrente',
  banco_codigo text check (banco_codigo ~ '^\d{3}$'),
  banco_nome text,
  agencia text,
  conta text,
  saldo_inicial numeric(14, 2) not null default 0,
  data_saldo_inicial date not null default current_date,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, nome)
);
create unique index contas_bancarias_numero_idx on public.contas_bancarias (banco_codigo, agencia, conta)
  where banco_codigo is not null and agencia is not null and conta is not null;

alter table public.contas_bancarias enable row level security;
create policy ver on public.contas_bancarias for select to authenticated
  using (public.tem_permissao('financeiro.contas_bancarias', 'ver') and public.pode_ver_empresa(empresa_id));
create policy criar on public.contas_bancarias for insert to authenticated
  with check (public.tem_permissao('financeiro.contas_bancarias', 'criar') and public.pode_ver_empresa(empresa_id));
create policy editar on public.contas_bancarias for update to authenticated
  using (public.tem_permissao('financeiro.contas_bancarias', 'editar') and public.pode_ver_empresa(empresa_id))
  with check (public.tem_permissao('financeiro.contas_bancarias', 'editar') and public.pode_ver_empresa(empresa_id));
create policy excluir on public.contas_bancarias for delete to authenticated
  using (public.tem_permissao('financeiro.contas_bancarias', 'excluir') and public.pode_ver_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- Plano de contas: árvore de receitas e despesas, única para o grupo (o CNPJ
-- fica em cada lançamento). Lançamentos usarão só as contas sem filhas.
-- -----------------------------------------------------------------------------
create type public.tipo_plano_conta as enum ('receita', 'despesa');

create table public.plano_contas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^\d+(\.\d+)*$'),
  nome text not null,
  tipo public.tipo_plano_conta not null,
  pai_id uuid references public.plano_contas(id),
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

-- A conta filha tem o mesmo tipo da mãe e a árvore não pode ter ciclos.
create function public.validar_plano_conta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pai_id is null then
    return new;
  end if;
  if exists (select 1 from public.plano_contas p where p.id = new.pai_id and p.tipo <> new.tipo) then
    raise exception 'A categoria precisa ser do mesmo tipo (receita ou despesa) da categoria acima dela';
  end if;
  if exists (
    with recursive acima(id) as (
      select new.pai_id
      union
      select p.pai_id from public.plano_contas p join acima a on a.id = p.id where p.pai_id is not null
    )
    select 1 from acima where id = new.id
  ) then
    raise exception 'Uma categoria não pode ficar abaixo dela mesma';
  end if;
  return new;
end;
$$;

create trigger validar_plano_conta
  before insert or update on public.plano_contas
  for each row execute function public.validar_plano_conta();

alter table public.plano_contas enable row level security;
select public.politicas_por_tela('plano_contas', 'financeiro.categorias');

-- Ponto de partida comum; cada empresa ajusta à sua realidade.
insert into public.plano_contas (codigo, nome, tipo) values
  ('1', 'Receitas', 'receita'),
  ('2', 'Deduções e impostos sobre vendas', 'despesa'),
  ('3', 'Custos de produção', 'despesa'),
  ('4', 'Despesas operacionais', 'despesa'),
  ('5', 'Resultado financeiro', 'despesa');

insert into public.plano_contas (codigo, nome, tipo, pai_id)
select x.codigo, x.nome, p.tipo, p.id
from (values
  ('1.01', 'Venda de produtos', '1'),
  ('1.02', 'Venda em marketplaces', '1'),
  ('1.03', 'Prestação de serviços', '1'),
  ('1.04', 'Outras receitas', '1'),
  ('2.01', 'Impostos sobre vendas', '2'),
  ('2.02', 'Devoluções e cancelamentos', '2'),
  ('2.03', 'Tarifas de marketplace', '2'),
  ('3.01', 'Matéria-prima e embalagens', '3'),
  ('3.02', 'Mão de obra da produção', '3'),
  ('3.03', 'Manutenção e energia da fábrica', '3'),
  ('4.01', 'Salários e encargos', '4'),
  ('4.02', 'Aluguel e condomínio', '4'),
  ('4.03', 'Fretes e logística', '4'),
  ('4.04', 'Marketing', '4'),
  ('4.05', 'Serviços de terceiros', '4'),
  ('4.06', 'Despesas administrativas', '4'),
  ('5.01', 'Tarifas bancárias', '5'),
  ('5.02', 'Juros pagos', '5')
) as x(codigo, nome, pai)
join public.plano_contas p on p.codigo = x.pai;

-- -----------------------------------------------------------------------------
-- Centros de custo: áreas do grupo para separar despesas (fábrica, comercial...).
-- -----------------------------------------------------------------------------
create table public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table public.centros_custo enable row level security;
select public.politicas_por_tela('centros_custo', 'financeiro.centros_custo');

do $$
declare
  t text;
begin
  foreach t in array array['contas_bancarias', 'plano_contas', 'centros_custo'] loop
    execute format(
      'create trigger auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()',
      t
    );
  end loop;
end;
$$;
