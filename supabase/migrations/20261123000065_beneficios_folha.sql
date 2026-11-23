-- =============================================================================
-- Benefícios fora do holerite como custo e controle da folha (pedido do
-- Alexandre em 16/11/2026): vale-transporte pago à parte (planilha do VT da
-- fábrica, por PIX) e auxílio-alimentação (pedido do cartão Caixa).
--
-- O que muda:
-- - Tabela beneficios_folha: um valor por pessoa, mês (competência) e tipo,
--   com o período e a observação (férias, atestado, ausências). Não guarda
--   conta nem chave PIX.
-- - importar_beneficios(empresa, tipo, competencia, linhas): troca o mês
--   inteiro daquele tipo (reimportar não duplica). Liga ao funcionário pelo
--   CPF ou, como o holerite não traz CPF, pelo nome; ligado pelo nome, o CPF
--   da planilha completa o cadastro.
-- - View folha_beneficios_mensal: valor por empresa, mês, tipo e setor, para
--   a tela de funcionários e os indicadores (custo total da folha).
-- - Mesmo acesso dos holerites: ver com rh.folha ver; importar com rh.folha
--   criar. No Realtime: as telas abertas se atualizam sozinhas.
-- =============================================================================

create table public.beneficios_folha (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  funcionario_id uuid references public.funcionarios(id) on delete set null,
  competencia date not null check (extract(day from competencia) = 1),
  tipo text not null check (tipo in ('vt', 'va', 'outro')),
  nome text not null check (length(trim(nome)) > 1),
  cpf text check (cpf ~ '^\d{11}$'),
  valor numeric(12, 2) not null check (valor >= 0),
  dias integer check (dias >= 0),
  periodo_de date,
  periodo_ate date,
  observacao text,
  arquivo text,
  importado_em timestamptz not null default now()
);
create index beneficios_folha_mes_idx on public.beneficios_folha (empresa_id, competencia, tipo);
create index beneficios_folha_func_idx on public.beneficios_folha (funcionario_id);

alter table public.beneficios_folha enable row level security;
create policy ver on public.beneficios_folha for select to authenticated
  using (public.tem_permissao('rh.folha', 'ver') and public.pode_ver_empresa(empresa_id));
revoke all on public.beneficios_folha from public, anon, authenticated;
grant select on public.beneficios_folha to authenticated;
alter publication supabase_realtime add table public.beneficios_folha;

create trigger auditoria after insert or update or delete on public.beneficios_folha
  for each row execute function public.registrar_auditoria();

create view public.folha_beneficios_mensal with (security_invoker = true) as
select b.empresa_id, b.competencia, b.tipo, coalesce(f.setor, 'sem_setor') as setor,
       count(*) as pessoas, sum(b.valor) as valor
from public.beneficios_folha b
left join public.funcionarios f on f.id = b.funcionario_id
group by b.empresa_id, b.competencia, b.tipo, coalesce(f.setor, 'sem_setor');
grant select on public.folha_beneficios_mensal to authenticated;

-- Nome sem acento, em maiúsculas e com um espaço só, para ligar a planilha
-- ao cadastro quando o funcionário não tem CPF (o holerite não traz CPF).
create function public.nome_comparavel(nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(upper(translate(coalesce(nome, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g'));
$$;

-- Funcionário de uma linha de benefício: pelo CPF; sem CPF igual, pelo nome
-- completo; sem nome igual, pelo primeiro e último nome (se só houver um).
create function public.funcionario_do_beneficio(empresa uuid, cpf text, nome text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select f.id, f.empresa_id, f.ativo, f.cpf, public.nome_comparavel(f.nome) as n
    from public.funcionarios f
    where public.pode_ver_empresa(f.empresa_id)
  ), alvo as (
    select nullif(regexp_replace(coalesce(cpf, ''), '\D', '', 'g'), '') as cpf, public.nome_comparavel(nome) as n
  )
  select coalesce(
    (select c.id from c, alvo where alvo.cpf is not null and c.cpf = alvo.cpf
     order by (c.empresa_id = empresa) desc, c.ativo desc limit 1),
    (select c.id from c, alvo where c.n = alvo.n order by (c.empresa_id = empresa) desc, c.ativo desc limit 1),
    (select min(c.id::text)::uuid from c, alvo
     where split_part(c.n, ' ', 1) = split_part(alvo.n, ' ', 1)
       and regexp_replace(c.n, '^.* ', '') = regexp_replace(alvo.n, '^.* ', '')
       and alvo.n like '% %'
     having count(*) = 1));
$$;
revoke execute on function public.funcionario_do_beneficio(uuid, text, text) from public, anon, authenticated;

-- Grava as linhas lidas (já conferidas na tela) de um tipo e mês, trocando o
-- que havia (o funcionário vem de funcionario_do_beneficio).
create function public.importar_beneficios(empresa uuid, tipo_beneficio text, competencia_mes date, linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  trocados integer;
  gravados integer;
  ligados integer;
begin
  if not (public.tem_permissao('rh.folha', 'criar') and public.pode_ver_empresa(empresa)) then
    raise exception 'Seu perfil não pode importar benefícios desta empresa.';
  end if;
  if tipo_beneficio not in ('vt', 'va', 'outro') then
    raise exception 'Tipo de benefício inválido.';
  end if;
  if competencia_mes is null or extract(day from competencia_mes) <> 1 then
    raise exception 'Mês inválido.';
  end if;
  if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) = 0 then
    raise exception 'Nenhuma linha para gravar.';
  end if;

  delete from public.beneficios_folha b
  where b.empresa_id = empresa and b.competencia = competencia_mes and b.tipo = tipo_beneficio;
  get diagnostics trocados = row_count;

  insert into public.beneficios_folha (empresa_id, funcionario_id, competencia, tipo, nome, cpf, valor, dias, periodo_de,
                                       periodo_ate, observacao, arquivo)
  select empresa, public.funcionario_do_beneficio(empresa, l ->> 'cpf', l ->> 'nome'),
         competencia_mes, tipo_beneficio, trim(l ->> 'nome'),
         case when regexp_replace(coalesce(l ->> 'cpf', ''), '\D', '', 'g') ~ '^\d{11}$'
              then regexp_replace(l ->> 'cpf', '\D', '', 'g') end,
         coalesce((l ->> 'valor')::numeric, 0),
         case when (l ->> 'dias') ~ '^\d+$' then (l ->> 'dias')::integer end,
         case when (l ->> 'periodo_de') ~ '^\d{4}-\d{2}-\d{2}$' then (l ->> 'periodo_de')::date end,
         case when (l ->> 'periodo_ate') ~ '^\d{4}-\d{2}-\d{2}$' then (l ->> 'periodo_ate')::date end,
         nullif(trim(l ->> 'observacao'), ''), nullif(trim(l ->> 'arquivo'), '')
  from jsonb_array_elements(linhas) l
  where length(trim(coalesce(l ->> 'nome', ''))) > 1;
  get diagnostics gravados = row_count;

  -- Ligou pelo nome e o cadastro não tem CPF: completa com o da planilha.
  update public.funcionarios f set cpf = b.cpf
  from public.beneficios_folha b
  where b.funcionario_id = f.id and b.empresa_id = empresa and b.competencia = competencia_mes and b.tipo = tipo_beneficio
    and f.cpf is null and b.cpf is not null
    and not exists (select 1 from public.funcionarios o where o.cpf = b.cpf and o.empresa_id = f.empresa_id);

  select count(*) into ligados from public.beneficios_folha b
  where b.empresa_id = empresa and b.competencia = competencia_mes and b.tipo = tipo_beneficio and b.funcionario_id is not null;

  return jsonb_build_object('gravados', gravados, 'trocados', trocados, 'ligados', ligados);
end;
$$;
revoke execute on function public.importar_beneficios(uuid, text, date, jsonb) from public, anon;
grant execute on function public.importar_beneficios(uuid, text, date, jsonb) to authenticated;

-- Exclui um mês importado por engano.
create function public.excluir_beneficios(empresa uuid, tipo_beneficio text, competencia_mes date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not (public.tem_permissao('rh.folha', 'excluir') and public.pode_ver_empresa(empresa)) then
    raise exception 'Seu perfil não pode excluir benefícios desta empresa.';
  end if;
  delete from public.beneficios_folha b
  where b.empresa_id = empresa and b.competencia = competencia_mes and b.tipo = tipo_beneficio;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.excluir_beneficios(uuid, text, date) from public, anon;
grant execute on function public.excluir_beneficios(uuid, text, date) to authenticated;

-- Ajuda de custo paga pelo contas a pagar (Tiny) entra no custo da folha dos
-- indicadores: a função dos indicadores passa a marcar esses títulos pela
-- descrição ou pelo nome da categoria e a listar por pessoa e mês.
create function public.indicadores_ajuda_custo(de date, ate date, empresa uuid default null)
returns table (mes text, pessoa text, categoria_id uuid, categoria text, valor numeric, qtd integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select to_char(p.vencimento, 'YYYY-MM'), coalesce(f.nome_fantasia, f.nome, p.descricao), p.categoria_id, c.nome, sum(p.valor), count(*)::integer
  from public.contas_pagar p
  left join public.fornecedores f on f.id = p.fornecedor_id
  left join public.plano_contas c on c.id = p.categoria_id
  where p.situacao <> 'cancelado' and p.vencimento between de and ate and (empresa is null or p.empresa_id = empresa)
    and public.tem_permissao('estrategico.indicadores', 'ver')
    and (p.descricao ilike '%ajuda%custo%' or c.nome ilike '%ajuda%custo%')
  group by 1, 2, 3, 4;
$$;
revoke execute on function public.indicadores_ajuda_custo(date, date, uuid) from public, anon;
grant execute on function public.indicadores_ajuda_custo(date, date, uuid) to authenticated;
