-- =============================================================================
-- Venner Gestão · Rastreabilidade das contas a pagar
--
-- Pedido do Alexandre: em cada conta a pagar, saber de onde veio (lançada à
-- mão, nota do fornecedor ou Tiny), quando foi criada, quando veio do Tiny e
-- o que mudou depois, com o antes e o depois.
--
-- - contas_pagar.integrado_em: quando a conta ganhou o número do Tiny (criada
--   pela leitura ou, se já existia aqui, adotada por ela).
-- - contas_pagar_historico: uma linha quando a conta nasce e uma a cada
--   alteração, com quem fez (nome do usuário ou "Tiny") e os campos mudados
--   em texto legível: {"Valor": ["100,00", "120,00"], ...}.
-- - Quem grava é o gatilho; as telas só leem. A leitura do Tiny é reconhecida
--   pela pilha de chamadas (tiny_aplicar), sem mexer na função dela.
-- - Contas que já existiam ganham a linha "Criada" com a data e o usuário de
--   origem, e as do Tiny ficam com integrado_em = criado_em.
-- =============================================================================

alter table public.contas_pagar add column integrado_em timestamptz;
update public.contas_pagar set integrado_em = criado_em where tiny_id is not null;

create table public.contas_pagar_historico (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas_pagar(id) on delete cascade,
  quando timestamptz not null default now(),
  -- criada · alterada
  evento text not null check (evento in ('criada', 'alterada')),
  -- manual · nota · tiny · sistema (gravado por outra rotina do banco)
  origem text not null check (origem in ('manual', 'nota', 'tiny', 'sistema')),
  usuario_id uuid references public.usuarios(id) on delete set null,
  -- Nome guardado na hora: nem todo perfil enxerga o cadastro de usuários.
  usuario_nome text,
  mudancas jsonb not null default '{}'
);
create index contas_pagar_historico_conta_idx on public.contas_pagar_historico (conta_id, quando);

-- Texto legível de cada campo, para o "de → para".
create function public.rastreio_pagar_texto(campo text, valor text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when valor is null then null
    when campo = 'fornecedor_id' then (select coalesce(nullif(f.nome_fantasia, ''), f.nome) from public.fornecedores f where f.id = valor::uuid)
    when campo = 'categoria_id' then (select c.codigo || ' · ' || c.nome from public.plano_contas c where c.id = valor::uuid)
    when campo = 'centro_custo_id' then (select c.codigo || ' · ' || c.nome from public.centros_custo c where c.id = valor::uuid)
    when campo = 'conta_bancaria_id' then (select b.nome from public.contas_bancarias b where b.id = valor::uuid)
    when campo = 'empresa_id' then (select coalesce(nullif(e.nome_fantasia, ''), e.razao_social) from public.empresas e where e.id = valor::uuid)
    when campo in ('valor', 'valor_pago') then replace(valor::numeric(14, 2)::text, '.', ',')
    when campo in ('vencimento', 'data_pagamento') then to_char(valor::date, 'DD/MM/YYYY')
    when campo = 'situacao' then case valor when 'aberto' then 'Em aberto' when 'pago' then 'Pago' when 'cancelado' then 'Cancelado' else valor end
    else valor
  end;
$$;

create function public.rastrear_conta_pagar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pilha text;
  origem text;
  quem uuid := auth.uid();
  mudou jsonb := '{}';
  campo text;
  rotulo text;
  antes text;
  depois text;
begin
  get diagnostics pilha = pg_context;
  origem := case
    when pilha like '%tiny_aplicar%' then 'tiny'
    when tg_op = 'INSERT' and new.nota_id is not null then 'nota'
    when quem is not null then 'manual'
    else 'sistema'
  end;
  if origem = 'tiny' then quem := null; end if;

  if tg_op = 'UPDATE' then
    for campo, rotulo in
      select * from (values
        ('empresa_id', 'Empresa'), ('fornecedor_id', 'Fornecedor'), ('descricao', 'Descrição'), ('parcela', 'Parcela'),
        ('categoria_id', 'Categoria'), ('centro_custo_id', 'Centro de custo'), ('valor', 'Valor'), ('vencimento', 'Vencimento'),
        ('situacao', 'Situação'), ('data_pagamento', 'Data do pagamento'), ('valor_pago', 'Valor pago'),
        ('conta_bancaria_id', 'Conta bancária'), ('observacao', 'Observação'), ('tiny_id', 'Número no Tiny')
      ) c(campo, rotulo)
    loop
      antes := to_jsonb(old) ->> campo;
      depois := to_jsonb(new) ->> campo;
      if antes is distinct from depois then
        mudou := mudou || jsonb_build_object(rotulo,
          jsonb_build_array(public.rastreio_pagar_texto(campo, antes), public.rastreio_pagar_texto(campo, depois)));
      end if;
    end loop;
    if mudou = '{}' then return null; end if;
  end if;

  insert into public.contas_pagar_historico (conta_id, evento, origem, usuario_id, usuario_nome, mudancas)
  values (new.id, case tg_op when 'INSERT' then 'criada' else 'alterada' end, origem, quem,
    case when origem = 'tiny' then 'Tiny' else (select u.nome from public.usuarios u where u.id = quem) end, mudou);
  return null;
end;
$$;
revoke execute on function public.rastrear_conta_pagar() from public, anon, authenticated;
revoke execute on function public.rastreio_pagar_texto(text, text) from public, anon, authenticated;

create trigger rastrear after insert or update on public.contas_pagar
  for each row execute function public.rastrear_conta_pagar();

-- Data em que a conta ganhou o número do Tiny.
create function public.marcar_integracao_pagar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tiny_id is not null and (tg_op = 'INSERT' or old.tiny_id is null) then
    new.integrado_em := now();
  end if;
  return new;
end;
$$;
create trigger marcar_integracao before insert or update of tiny_id on public.contas_pagar
  for each row execute function public.marcar_integracao_pagar();

-- Contas que já existiam: a linha "Criada" com a origem e quem lançou.
insert into public.contas_pagar_historico (conta_id, quando, evento, origem, usuario_id, usuario_nome)
select p.id, p.criado_em, 'criada',
  case when p.nota_id is not null then 'nota' when p.usuario_id is not null then 'manual' when p.tiny_id is not null then 'tiny' else 'sistema' end,
  p.usuario_id,
  case when p.nota_id is null and p.usuario_id is null and p.tiny_id is not null then 'Tiny' else u.nome end
from public.contas_pagar p
left join public.usuarios u on u.id = p.usuario_id;

alter table public.contas_pagar_historico enable row level security;
-- Vê o histórico quem vê a conta (a subconsulta passa pela regra da conta).
create policy ver on public.contas_pagar_historico for select to authenticated
  using (public.tem_permissao('financeiro.pagar', 'ver') and exists (select 1 from public.contas_pagar p where p.id = conta_id));
revoke all on public.contas_pagar_historico from public, anon, authenticated;
grant select on public.contas_pagar_historico to authenticated;
