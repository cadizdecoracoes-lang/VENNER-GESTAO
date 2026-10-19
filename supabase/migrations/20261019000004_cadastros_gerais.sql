-- =============================================================================
-- Venner Gestão · Cadastros gerais
-- Fornecedores, clientes, locais de estoque e edição dos perfis de acesso.
-- Fornecedores e clientes são cadastro único do grupo; o CNPJ que compra ou
-- vende fica no pedido.
-- =============================================================================

create type public.tipo_pessoa as enum ('juridica', 'fisica');

-- -----------------------------------------------------------------------------
-- Fornecedores e clientes
-- -----------------------------------------------------------------------------
create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  tipo_pessoa public.tipo_pessoa not null default 'juridica',
  -- CNPJ (14 dígitos) ou CPF (11), sem pontuação.
  documento text unique,
  nome text not null,
  nome_fantasia text,
  email text,
  telefone text,
  cidade text,
  uf text check (uf ~ '^[A-Z]{2}$'),
  -- Usado pelo MRP para saber com quanta antecedência comprar.
  prazo_entrega_dias integer not null default 0 check (prazo_entrega_dias >= 0),
  condicao_pagamento text,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  check (
    documento is null
    or (tipo_pessoa = 'juridica' and documento ~ '^\d{14}$')
    or (tipo_pessoa = 'fisica' and documento ~ '^\d{11}$')
  )
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  tipo_pessoa public.tipo_pessoa not null default 'juridica',
  documento text unique,
  nome text not null,
  nome_fantasia text,
  email text,
  telefone text,
  cidade text,
  uf text check (uf ~ '^[A-Z]{2}$'),
  -- Por onde o cliente chega: venda direta ou marketplace.
  canal text not null default 'venda_direta' check (canal in ('venda_direta', 'mercado_livre', 'shopee', 'outro')),
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  check (
    documento is null
    or (tipo_pessoa = 'juridica' and documento ~ '^\d{14}$')
    or (tipo_pessoa = 'fisica' and documento ~ '^\d{11}$')
  )
);

alter table public.fornecedores enable row level security;
alter table public.clientes enable row level security;
select public.politicas_por_tela('fornecedores', 'compras.fornecedores', 'compras.pedidos');
select public.politicas_por_tela('clientes', 'vendas.clientes', 'vendas.pedidos');

create trigger auditoria after insert or update or delete on public.fornecedores
  for each row execute function public.registrar_auditoria();
create trigger auditoria after insert or update or delete on public.clientes
  for each row execute function public.registrar_auditoria();

-- -----------------------------------------------------------------------------
-- Perfil com acesso a todas as empresas (Diretoria) sempre tem todas as
-- permissões: assim ninguém tranca o sistema tirando o próprio acesso.
-- -----------------------------------------------------------------------------
create function public.permissoes_completas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'perfis' then
    if tg_op = 'UPDATE' and new.todas_empresas is distinct from old.todas_empresas then
      raise exception 'O acesso a todas as empresas é definido na criação do perfil e não muda depois';
    end if;
    if tg_op = 'INSERT' and new.todas_empresas then
      insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
      select new.id, t.codigo, a.acao
      from public.telas t cross join unnest(enum_range(null::public.acao_permissao)) as a(acao);
    end if;
  else
    -- Tela nova: entra liberada para os perfis de acesso total.
    insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
    select p.id, new.codigo, a.acao
    from public.perfis p cross join unnest(enum_range(null::public.acao_permissao)) as a(acao)
    where p.todas_empresas
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.permissoes_completas() from public, anon, authenticated;

create trigger permissoes_completas after insert or update of todas_empresas on public.perfis
  for each row execute function public.permissoes_completas();
create trigger permissoes_completas after insert on public.telas
  for each row execute function public.permissoes_completas();

create function public.proteger_permissoes_diretoria()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Vale também para a exclusão em cascata: o perfil da diretoria não é apagado.
  if exists (select 1 from public.perfis p where p.id = old.perfil_id and p.todas_empresas) then
    raise exception 'O perfil com acesso a todas as empresas sempre tem todas as permissões';
  end if;
  return old;
end;
$$;

create trigger proteger_permissoes_diretoria before delete or update on public.perfil_permissoes
  for each row execute function public.proteger_permissoes_diretoria();

-- Troca as permissões de um perfil pela lista recebida ("tela:acao").
-- Roda com as permissões de quem chama (a RLS de perfil_permissoes vale).
create function public.definir_permissoes_perfil(perfil uuid, permissoes text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  pares text[] := coalesce(definir_permissoes_perfil.permissoes, '{}');
begin
  if not public.tem_permissao('config.perfis', 'editar') then
    raise exception 'Seu perfil não pode alterar perfis de acesso';
  end if;
  if exists (select 1 from public.perfis p where p.id = definir_permissoes_perfil.perfil and p.todas_empresas) then
    raise exception 'O perfil com acesso a todas as empresas sempre tem todas as permissões';
  end if;

  delete from public.perfil_permissoes pp
  where pp.perfil_id = definir_permissoes_perfil.perfil
    and pp.tela_codigo || ':' || pp.acao::text <> all (pares);

  insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
  select definir_permissoes_perfil.perfil, split_part(x, ':', 1), split_part(x, ':', 2)::public.acao_permissao
  from unnest(pares) as x
  on conflict do nothing;
end;
$$;
revoke execute on function public.definir_permissoes_perfil(uuid, text[]) from public, anon;
grant execute on function public.definir_permissoes_perfil(uuid, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Locais de estoque ganham tela própria
-- -----------------------------------------------------------------------------
insert into public.telas (codigo, titulo, grupo) values ('estoque.locais', 'Locais de estoque', 'Estoque');

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'estoque.locais', a.acao
from public.perfis p
cross join (values ('ver'::public.acao_permissao), ('criar'), ('editar')) as a(acao)
where p.nome = 'PCP / Produção';

drop policy ver on public.locais_estoque;
drop policy criar on public.locais_estoque;
drop policy editar on public.locais_estoque;
drop policy excluir on public.locais_estoque;
-- Quem lida com estoque precisa ver o nome dos locais.
create policy ver on public.locais_estoque for select to authenticated
  using (
    public.tem_permissao('estoque.locais', 'ver')
    or public.tem_permissao('estoque.saldos', 'ver')
    or public.tem_permissao('estoque.movimentos', 'ver')
  );
create policy criar on public.locais_estoque for insert to authenticated
  with check (public.tem_permissao('estoque.locais', 'criar'));
create policy editar on public.locais_estoque for update to authenticated
  using (public.tem_permissao('estoque.locais', 'editar'))
  with check (public.tem_permissao('estoque.locais', 'editar'));
create policy excluir on public.locais_estoque for delete to authenticated
  using (public.tem_permissao('estoque.locais', 'excluir'));
