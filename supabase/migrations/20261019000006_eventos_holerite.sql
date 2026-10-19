-- =============================================================================
-- Venner Gestão · Eventos do holerite (RH)
-- Rubricas usadas na conferência da folha: proventos, descontos e informativos,
-- com as incidências de INSS, FGTS e IRRF.
-- =============================================================================

insert into public.telas (codigo, titulo, grupo) values ('rh.eventos', 'Eventos do holerite', 'RH');

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'rh.eventos', a.acao
from public.perfis p
cross join (values ('ver'::public.acao_permissao), ('criar'), ('editar')) as a(acao)
where p.nome = 'RH';
insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'rh.eventos', 'ver' from public.perfis p where p.nome = 'Contabilidade';

create type public.tipo_evento_folha as enum ('provento', 'desconto', 'informativo');

create table public.eventos_folha (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  descricao text not null,
  tipo public.tipo_evento_folha not null,
  -- Como a quantidade do evento é informada no holerite.
  forma_calculo text not null default 'valor' check (forma_calculo in ('valor', 'percentual', 'horas', 'dias')),
  incide_inss boolean not null default false,
  incide_fgts boolean not null default false,
  incide_irrf boolean not null default false,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  -- Informativo não soma nem desconta, então não tem incidência.
  check (tipo <> 'informativo' or not (incide_inss or incide_fgts or incide_irrf))
);

alter table public.eventos_folha enable row level security;
select public.politicas_por_tela('eventos_folha', 'rh.eventos', 'rh.folha');

create trigger auditoria after insert or update or delete on public.eventos_folha
  for each row execute function public.registrar_auditoria();

-- Eventos mais comuns; a contabilidade da Venner confere e ajusta códigos e incidências.
insert into public.eventos_folha (codigo, descricao, tipo, forma_calculo, incide_inss, incide_fgts, incide_irrf) values
  ('001', 'Salário', 'provento', 'dias', true, true, true),
  ('002', 'Horas extras 50%', 'provento', 'horas', true, true, true),
  ('003', 'Horas extras 100%', 'provento', 'horas', true, true, true),
  ('004', 'DSR sobre horas extras', 'provento', 'valor', true, true, true),
  ('005', 'Adicional noturno', 'provento', 'horas', true, true, true),
  ('006', 'Comissões', 'provento', 'valor', true, true, true),
  ('007', 'Férias', 'provento', 'dias', true, true, true),
  ('008', '1/3 de férias', 'provento', 'valor', true, true, true),
  ('009', '13º salário', 'provento', 'valor', true, true, true),
  ('010', 'Salário-família', 'provento', 'valor', false, false, false),
  ('101', 'INSS', 'desconto', 'percentual', false, false, false),
  ('102', 'IRRF', 'desconto', 'percentual', false, false, false),
  ('103', 'Vale-transporte', 'desconto', 'percentual', false, false, false),
  ('104', 'Faltas', 'desconto', 'dias', true, true, true),
  ('105', 'Adiantamento salarial', 'desconto', 'valor', false, false, false),
  ('106', 'Vale-refeição / alimentação', 'desconto', 'valor', false, false, false),
  ('201', 'FGTS do mês', 'informativo', 'percentual', false, false, false);
