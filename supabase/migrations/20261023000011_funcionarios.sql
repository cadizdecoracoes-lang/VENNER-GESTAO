-- =============================================================================
-- Venner Gestão · Funcionários e holerites (RH)
-- Cadastro dos funcionários por empresa empregadora e o histórico dos recibos
-- de pagamento importados dos PDFs da folha (mensal e adiantamento).
-- =============================================================================

create table public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  -- Código do funcionário no sistema da folha (aparece no holerite).
  matricula text not null check (matricula ~ '^\S+$'),
  nome text not null check (length(trim(nome)) > 1),
  cpf text check (cpf ~ '^\d{11}$'),
  cargo text,
  cbo text check (cbo ~ '^\d{6}$'),
  salario_base numeric(12, 2) check (salario_base >= 0),
  admissao date,
  desligamento date,
  telefone text,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, matricula),
  check (desligamento is null or admissao is null or desligamento >= admissao)
);
comment on table public.funcionarios is 'Funcionários por empresa empregadora (CNPJ do holerite).';

create table public.holerites (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  -- Primeiro dia do mês de referência.
  competencia date not null check (extract(day from competencia) = 1),
  -- mensal, adiantamento, ferias, decimo_terceiro, rescisao...
  tipo text not null check (tipo ~ '^[a-z0-9_]+$'),
  cargo text,
  cbo text,
  salario_base numeric(12, 2) not null default 0,
  total_proventos numeric(12, 2) not null default 0,
  total_descontos numeric(12, 2) not null default 0,
  liquido numeric(12, 2) not null default 0,
  base_inss numeric(12, 2) not null default 0,
  base_fgts numeric(12, 2) not null default 0,
  fgts numeric(12, 2) not null default 0,
  base_irrf numeric(12, 2) not null default 0,
  arquivo text,
  importado_em timestamptz not null default now(),
  unique (funcionario_id, competencia, tipo)
);
comment on table public.holerites is 'Recibos de pagamento como vieram da folha da contabilidade, para conferência e custo de pessoal.';

create table public.holerite_eventos (
  id uuid primary key default gen_random_uuid(),
  holerite_id uuid not null references public.holerites(id) on delete cascade,
  evento_id uuid not null references public.eventos_folha(id),
  ordem integer not null default 0,
  referencia numeric(12, 2),
  valor numeric(12, 2) not null
);
create index on public.holerite_eventos (holerite_id);
create index on public.holerite_eventos (evento_id);

-- Os eventos genéricos do pacote dos eventos eram provisórios; os do holerite
-- real chegam com os códigos da folha (o 103, por exemplo, é outro evento).
-- Só sai o que ninguém alterou.
delete from public.eventos_folha e
using (values
  ('001', 'Salário'), ('002', 'Horas extras 50%'), ('003', 'Horas extras 100%'), ('004', 'DSR sobre horas extras'),
  ('005', 'Adicional noturno'), ('006', 'Comissões'), ('007', 'Férias'), ('008', '1/3 de férias'), ('009', '13º salário'),
  ('010', 'Salário-família'), ('101', 'INSS'), ('102', 'IRRF'), ('103', 'Vale-transporte'), ('104', 'Faltas'),
  ('105', 'Adiantamento salarial'), ('106', 'Vale-refeição / alimentação'), ('201', 'FGTS do mês')
) as s(codigo, descricao)
where e.codigo = s.codigo and e.descricao = s.descricao and e.observacao is null;

-- -----------------------------------------------------------------------------
-- Acesso: funcionários pela tela de funcionários; holerites (salário e
-- descontos de cada um) só pela conferência da folha. Sempre por empresa.
-- -----------------------------------------------------------------------------
alter table public.funcionarios enable row level security;
alter table public.holerites enable row level security;
alter table public.holerite_eventos enable row level security;

create policy ver on public.funcionarios for select to authenticated
  using ((public.tem_permissao('rh.funcionarios', 'ver') or public.tem_permissao('rh.folha', 'ver')) and public.pode_ver_empresa(empresa_id));
create policy criar on public.funcionarios for insert to authenticated
  with check (public.tem_permissao('rh.funcionarios', 'criar') and public.pode_ver_empresa(empresa_id));
create policy editar on public.funcionarios for update to authenticated
  using (public.tem_permissao('rh.funcionarios', 'editar') and public.pode_ver_empresa(empresa_id))
  with check (public.tem_permissao('rh.funcionarios', 'editar') and public.pode_ver_empresa(empresa_id));
create policy excluir on public.funcionarios for delete to authenticated
  using (public.tem_permissao('rh.funcionarios', 'excluir') and public.pode_ver_empresa(empresa_id));

create policy ver on public.holerites for select to authenticated
  using (public.tem_permissao('rh.folha', 'ver') and exists (select 1 from public.funcionarios f where f.id = funcionario_id));
create policy excluir on public.holerites for delete to authenticated
  using (public.tem_permissao('rh.folha', 'excluir') and exists (select 1 from public.funcionarios f where f.id = funcionario_id));

create policy ver on public.holerite_eventos for select to authenticated
  using (exists (select 1 from public.holerites h where h.id = holerite_id));

create trigger auditoria after insert or update or delete on public.funcionarios
  for each row execute function public.registrar_auditoria();

-- Resumos para as telas (sem esbarrar no limite de linhas da API): os meses já
-- importados de cada empresa e o último holerite de cada funcionário.
create view public.holerites_por_mes with (security_invoker = true) as
select f.empresa_id, h.competencia, h.tipo, array_agg(f.matricula order by f.matricula) as matriculas,
       count(*) as recibos, sum(h.liquido) as liquido
from public.holerites h
join public.funcionarios f on f.id = h.funcionario_id
group by f.empresa_id, h.competencia, h.tipo;

create view public.funcionarios_ultimo_holerite with (security_invoker = true) as
select h.funcionario_id, max(h.competencia) as competencia
from public.holerites h
group by h.funcionario_id;

-- -----------------------------------------------------------------------------
-- Importação dos holerites lidos dos PDFs (a tela lê o arquivo e manda os
-- recibos já conferidos). Cria o funcionário que ainda não existe, troca o
-- recibo do mesmo mês e tipo, cria os eventos novos da folha e atualiza cargo
-- e salário pelo holerite mensal mais recente.
-- -----------------------------------------------------------------------------
create function public.importar_holerites(empresa uuid, recibos jsonb, desligar text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  e jsonb;
  func uuid;
  hol uuid;
  ev uuid;
  comp date;
  ordem integer;
  novos_func integer := 0;
  novos_hol integer := 0;
  trocados integer := 0;
  novos_ev integer := 0;
  tocados uuid[] := '{}';
  desligados integer := 0;
begin
  if not (public.tem_permissao('rh.folha', 'criar') and public.tem_permissao('rh.funcionarios', 'criar')
          and public.pode_ver_empresa(empresa)) then
    raise exception 'Seu perfil não pode importar holerites desta empresa';
  end if;
  if jsonb_typeof(recibos) <> 'array' or jsonb_array_length(recibos) = 0 then
    raise exception 'Nenhum recibo para importar';
  end if;

  for r in select * from jsonb_array_elements(recibos) loop
    if coalesce(r->>'matricula', '') !~ '^\S+$' or length(trim(coalesce(r->>'nome', ''))) < 2
       or coalesce(r->>'competencia', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' or coalesce(r->>'tipo', '') !~ '^[a-z0-9_]+$' then
      raise exception 'Recibo incompleto (matrícula, nome, mês ou tipo): %', left(r::text, 200);
    end if;
    comp := (r->>'competencia' || '-01')::date;

    select f.id into func from public.funcionarios f where f.empresa_id = empresa and f.matricula = r->>'matricula';
    if func is null then
      insert into public.funcionarios (empresa_id, matricula, nome, cargo, cbo, salario_base)
      values (empresa, r->>'matricula', trim(r->>'nome'), nullif(trim(r->>'cargo'), ''),
              case when r->>'cbo' ~ '^\d{6}$' then r->>'cbo' end, nullif((r->>'salario_base')::numeric, 0))
      returning id into func;
      novos_func := novos_func + 1;
    end if;
    tocados := tocados || func;

    delete from public.holerites h where h.funcionario_id = func and h.competencia = comp and h.tipo = r->>'tipo';
    if found then trocados := trocados + 1; else novos_hol := novos_hol + 1; end if;
    insert into public.holerites (funcionario_id, competencia, tipo, cargo, cbo, salario_base, total_proventos, total_descontos,
                                  liquido, base_inss, base_fgts, fgts, base_irrf, arquivo)
    values (func, comp, r->>'tipo', nullif(trim(r->>'cargo'), ''), case when r->>'cbo' ~ '^\d{6}$' then r->>'cbo' end, coalesce((r->>'salario_base')::numeric, 0),
            coalesce((r->>'total_proventos')::numeric, 0), coalesce((r->>'total_descontos')::numeric, 0),
            coalesce((r->>'liquido')::numeric, 0), coalesce((r->>'base_inss')::numeric, 0),
            coalesce((r->>'base_fgts')::numeric, 0), coalesce((r->>'fgts')::numeric, 0),
            coalesce((r->>'base_irrf')::numeric, 0), left(r->>'arquivo', 200))
    returning id into hol;

    ordem := 0;
    for e in select * from jsonb_array_elements(coalesce(r->'eventos', '[]')) loop
      ordem := ordem + 1;
      select x.id into ev from public.eventos_folha x where x.codigo = e->>'codigo';
      if ev is null then
        insert into public.eventos_folha (codigo, descricao, tipo, observacao)
        values (e->>'codigo', coalesce(nullif(trim(e->>'descricao'), ''), 'Evento ' || (e->>'codigo')),
                case when e->>'natureza' = 'desconto' then 'desconto' else 'provento' end::public.tipo_evento_folha,
                'Criado pela importação do holerite. Confira as incidências.')
        returning id into ev;
        novos_ev := novos_ev + 1;
      end if;
      insert into public.holerite_eventos (holerite_id, evento_id, ordem, referencia, valor)
      values (hol, ev, ordem, (e->>'referencia')::numeric, coalesce((e->>'valor')::numeric, 0));
    end loop;
  end loop;

  -- Cargo, CBO e salário seguem o holerite mensal mais recente de cada um.
  update public.funcionarios f
  set cargo = coalesce(u.cargo, f.cargo),
      cbo = coalesce(u.cbo, f.cbo),
      salario_base = coalesce(nullif(u.salario_base, 0), f.salario_base)
  from (
    select distinct on (h.funcionario_id) h.funcionario_id, h.cargo, h.cbo, h.salario_base
    from public.holerites h
    where h.funcionario_id = any (tocados) and h.tipo = 'mensal'
    order by h.funcionario_id, h.competencia desc
  ) u
  where f.id = u.funcionario_id
    and (f.cargo, f.cbo, f.salario_base) is distinct from
        (coalesce(u.cargo, f.cargo), coalesce(u.cbo, f.cbo), coalesce(nullif(u.salario_base, 0), f.salario_base));

  -- Matrículas que a tela marcou como desligadas (sem holerite no mês mais recente).
  update public.funcionarios f set ativo = false
  where f.matricula = any (desligar) and f.empresa_id = empresa and f.ativo;
  get diagnostics desligados = row_count;

  return jsonb_build_object('funcionarios_novos', novos_func, 'holerites_novos', novos_hol, 'holerites_trocados', trocados,
                            'eventos_novos', novos_ev, 'desligados', desligados);
end;
$$;
revoke execute on function public.importar_holerites(uuid, jsonb, text[]) from public, anon;
grant execute on function public.importar_holerites(uuid, jsonb, text[]) to authenticated;
