-- =============================================================================
-- Conciliação bancária e fluxo de caixa (pacote 17).
--
-- Conciliação:
--   - extrato_importacoes: cada arquivo do banco importado (OFX, planilha, PDF)
--     ou leitura automática pela integração com o banco (origem 'banco', já
--     prevista: o robô vai chamar a mesma importar_extrato).
--   - extrato_lancamentos: cada linha do extrato, uma vez só por conta (a
--     chave impede importar o mesmo lançamento duas vezes).
--   - extrato_conciliacoes: liga a linha do extrato aos títulos de pagar ou
--     receber que ela quita (um PIX pode pagar vários boletos; uma liberação
--     do Mercado Livre cobre várias vendas).
--   Funções: importar_extrato, conciliar_lancamento (dá baixa nos títulos em
--   aberto com a data e a conta do extrato), marcar_lancamento (transferência
--   entre contas ou ignorar com motivo) e desfazer_conciliacao.
--   A conciliação não cria lançamentos: o reflexo dela é só a baixa no contas
--   a pagar e a receber. Linha sem título pede criar o título lá antes.
--   Título conciliado que é estornado no pagar/receber devolve a linha do
--   extrato para pendente (gatilho soltar_conciliado).
--
-- Fluxo de caixa:
--   - fluxo_previsoes: valor digitado à mão por dia (entrada ou saída prevista
--     que ainda não é título), por empresa.
--   - fluxo_caixa(de, ate, empresa): movimentos somados por dia e categoria:
--     realizado (pagos e recebidos), previsto (em aberto pelo vencimento),
--     atrasado (em aberto vencido, entra em "hoje"), previsão manual e
--     transferências do extrato.
--   - fluxo_caixa_saldos(de, empresa): saldo de cada conta no início do período.
--   O saldo inicial da conta vale para o começo do dia data_saldo_inicial.
--
-- As contas bancárias passam a ser lidas também por quem vê a conciliação ou
-- o fluxo de caixa (perfil Contabilidade, por exemplo).
-- =============================================================================

create type public.origem_extrato as enum ('ofx', 'planilha', 'pdf', 'banco');
create type public.situacao_extrato as enum ('pendente', 'conciliado', 'transferencia', 'ignorado');

create policy ver_conciliacao_fluxo on public.contas_bancarias for select to authenticated
  using (
    (public.tem_permissao('financeiro.conciliacao', 'ver') or public.tem_permissao('financeiro.fluxo_caixa', 'ver'))
    and public.pode_ver_empresa(empresa_id)
  );

-- -----------------------------------------------------------------------------
-- Extrato
-- -----------------------------------------------------------------------------
create table public.extrato_importacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  conta_bancaria_id uuid not null references public.contas_bancarias(id),
  origem public.origem_extrato not null,
  arquivo text,
  periodo_de date,
  periodo_ate date,
  -- Saldo que o banco informa no fim do arquivo, para conferir com o sistema.
  saldo_final numeric(14, 2),
  importadas integer not null default 0,
  repetidas integer not null default 0,
  usuario_id uuid default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now()
);
create index extrato_importacoes_conta_idx on public.extrato_importacoes (conta_bancaria_id, criado_em desc);

create table public.extrato_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  conta_bancaria_id uuid not null references public.contas_bancarias(id),
  importacao_id uuid references public.extrato_importacoes(id) on delete cascade,
  data date not null,
  descricao text not null,
  documento text,
  -- Positivo = entrou na conta (crédito); negativo = saiu (débito).
  valor numeric(14, 2) not null check (valor <> 0),
  saldo numeric(14, 2),
  -- Identificação do banco (FITID do OFX) ou data|valor|descrição|ocorrência.
  chave text not null,
  situacao public.situacao_extrato not null default 'pendente',
  observacao text,
  conciliado_por uuid references public.usuarios(id),
  conciliado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (conta_bancaria_id, chave),
  check (situacao <> 'ignorado' or nullif(trim(observacao), '') is not null)
);
create index extrato_lancamentos_conta_idx on public.extrato_lancamentos (conta_bancaria_id, data);
create index extrato_lancamentos_pendentes_idx on public.extrato_lancamentos (empresa_id, situacao) where situacao = 'pendente';

create table public.extrato_conciliacoes (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references public.extrato_lancamentos(id) on delete cascade,
  conta_pagar_id uuid references public.contas_pagar(id),
  conta_receber_id uuid references public.contas_receber(id),
  valor numeric(14, 2) not null check (valor > 0),
  -- O que a conciliação fez com o título, para desfazer certo:
  -- vinculou (já estava pago) ou baixou (estava em aberto).
  efeito text not null check (efeito in ('vinculou', 'baixou')),
  check (num_nonnulls(conta_pagar_id, conta_receber_id) = 1)
);
create index extrato_conciliacoes_lancamento_idx on public.extrato_conciliacoes (lancamento_id);
-- Um título é conciliado com uma linha do extrato só.
create unique index extrato_conciliacoes_pagar_idx on public.extrato_conciliacoes (conta_pagar_id) where conta_pagar_id is not null;
create unique index extrato_conciliacoes_receber_idx on public.extrato_conciliacoes (conta_receber_id) where conta_receber_id is not null;

-- Importação e linha usam conta bancária do mesmo CNPJ.
create function public.validar_extrato()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.contas_bancarias b where b.id = new.conta_bancaria_id and b.empresa_id = new.empresa_id) then
    raise exception 'A conta bancária precisa ser da mesma empresa do extrato';
  end if;
  return new;
end;
$$;
create trigger validar_extrato before insert or update on public.extrato_importacoes
  for each row execute function public.validar_extrato();
create trigger validar_extrato before insert or update on public.extrato_lancamentos
  for each row execute function public.validar_extrato();

alter table public.extrato_importacoes enable row level security;
alter table public.extrato_lancamentos enable row level security;
alter table public.extrato_conciliacoes enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['extrato_importacoes', 'extrato_lancamentos'] loop
    execute format('create policy ver on public.%I for select to authenticated
      using (public.tem_permissao(''financeiro.conciliacao'', ''ver'') and public.pode_ver_empresa(empresa_id))', t);
    execute format('create policy criar on public.%I for insert to authenticated
      with check (public.tem_permissao(''financeiro.conciliacao'', ''criar'') and public.pode_ver_empresa(empresa_id))', t);
    execute format('create policy editar on public.%I for update to authenticated
      using (public.tem_permissao(''financeiro.conciliacao'', ''editar'') and public.pode_ver_empresa(empresa_id))
      with check (public.tem_permissao(''financeiro.conciliacao'', ''editar'') and public.pode_ver_empresa(empresa_id))', t);
    execute format('create policy excluir on public.%I for delete to authenticated
      using (public.tem_permissao(''financeiro.conciliacao'', ''excluir'') and public.pode_ver_empresa(empresa_id))', t);
    execute format(
      'create trigger auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()', t);
  end loop;
end;
$$;

-- A ligação segue a linha do extrato (a RLS dela vale dentro do exists).
create policy ver on public.extrato_conciliacoes for select to authenticated
  using (public.tem_permissao('financeiro.conciliacao', 'ver')
    and exists (select 1 from public.extrato_lancamentos l where l.id = lancamento_id));
create policy criar on public.extrato_conciliacoes for insert to authenticated
  with check (public.tem_permissao('financeiro.conciliacao', 'editar')
    and exists (select 1 from public.extrato_lancamentos l where l.id = lancamento_id));
create policy excluir on public.extrato_conciliacoes for delete to authenticated
  using (public.tem_permissao('financeiro.conciliacao', 'editar')
    and exists (select 1 from public.extrato_lancamentos l where l.id = lancamento_id));
create trigger auditoria after insert or update or delete on public.extrato_conciliacoes
  for each row execute function public.registrar_auditoria();

-- Importa as linhas de um extrato. linhas: [{data, descricao, documento,
-- valor, saldo, id_banco}]. Lançamento já importado (mesma chave) é contado
-- como repetido e não entra de novo.
create function public.importar_extrato(
  conta_bancaria uuid,
  origem public.origem_extrato,
  arquivo text,
  linhas jsonb,
  saldo_final numeric default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  empresa uuid;
  imp uuid;
  l jsonb;
  base text;
  ocorrencias jsonb := '{}';
  n integer;
  novas integer := 0;
  total integer := 0;
  inseridas integer;
begin
  select b.empresa_id into empresa from public.contas_bancarias b where b.id = conta_bancaria;
  if empresa is null then
    raise exception 'Conta bancária não encontrada';
  end if;
  if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) = 0 then
    raise exception 'O extrato não tem lançamentos';
  end if;

  insert into public.extrato_importacoes (empresa_id, conta_bancaria_id, origem, arquivo, saldo_final, periodo_de, periodo_ate)
  values (empresa, conta_bancaria, origem, arquivo, saldo_final,
    (select min((x ->> 'data')::date) from jsonb_array_elements(linhas) x),
    (select max((x ->> 'data')::date) from jsonb_array_elements(linhas) x))
  returning id into imp;

  for l in select * from jsonb_array_elements(linhas) loop
    if coalesce((l ->> 'valor')::numeric, 0) = 0 then
      continue;
    end if;
    total := total + 1;
    if nullif(l ->> 'id_banco', '') is not null then
      base := 'id:' || (l ->> 'id_banco');
    else
      -- Duas tarifas iguais no mesmo dia são lançamentos diferentes: conta a ocorrência.
      base := (l ->> 'data') || '|' || round((l ->> 'valor')::numeric, 2) || '|'
        || lower(regexp_replace(trim(l ->> 'descricao'), '\s+', ' ', 'g'));
      n := coalesce((ocorrencias ->> base)::integer, 0) + 1;
      ocorrencias := ocorrencias || jsonb_build_object(base, n);
      base := base || '|' || n;
    end if;
    insert into public.extrato_lancamentos (empresa_id, conta_bancaria_id, importacao_id, data, descricao, documento, valor, saldo, chave)
    values (empresa, conta_bancaria, imp, (l ->> 'data')::date, coalesce(nullif(trim(l ->> 'descricao'), ''), 'Sem descrição'),
      nullif(trim(l ->> 'documento'), ''), round((l ->> 'valor')::numeric, 2), round((l ->> 'saldo')::numeric, 2), base)
    on conflict (conta_bancaria_id, chave) do nothing;
    get diagnostics inseridas = row_count;
    novas := novas + inseridas;
  end loop;

  update public.extrato_importacoes set importadas = novas, repetidas = total - novas where id = imp;
  return jsonb_build_object('importadas', novas, 'repetidas', total - novas, 'importacao', imp);
end;
$$;
revoke execute on function public.importar_extrato(uuid, public.origem_extrato, text, jsonb, numeric) from public, anon;
grant execute on function public.importar_extrato(uuid, public.origem_extrato, text, jsonb, numeric) to authenticated;

-- Concilia uma linha do extrato com títulos do mesmo CNPJ: débito com contas a
-- pagar, crédito com contas a receber. Título em aberto recebe a baixa com a
-- data e a conta do extrato; com um título só, o valor baixado é o do extrato
-- (juros ou desconto). Com vários, a soma precisa bater com a linha.
create function public.conciliar_lancamento(lancamento uuid, pagar uuid[] default '{}', receber uuid[] default '{}')
returns void
language plpgsql
set search_path = ''
as $$
declare
  l public.extrato_lancamentos;
  t record;
  quantos integer := coalesce(cardinality(pagar), 0) + coalesce(cardinality(receber), 0);
  soma numeric := 0;
  alvo numeric;
begin
  if not public.tem_permissao('financeiro.conciliacao', 'editar') then
    raise exception 'Seu perfil não pode conciliar o extrato';
  end if;
  select * into l from public.extrato_lancamentos where id = lancamento for update;
  if l.id is null then
    raise exception 'Lançamento do extrato não encontrado';
  end if;
  if l.situacao <> 'pendente' then
    raise exception 'Este lançamento já foi resolvido. Desfaça antes de conciliar de novo';
  end if;
  if quantos = 0 then
    raise exception 'Escolha ao menos um título para conciliar';
  end if;
  if l.valor < 0 and coalesce(cardinality(receber), 0) > 0 then
    raise exception 'Saída do extrato se concilia com contas a pagar';
  end if;
  if l.valor > 0 and coalesce(cardinality(pagar), 0) > 0 then
    raise exception 'Entrada do extrato se concilia com contas a receber';
  end if;
  alvo := abs(l.valor);

  for t in
    select p.id, p.empresa_id, p.situacao, p.valor, p.valor_pago as pago, p.conta_bancaria_id, p.descricao
    from public.contas_pagar p where p.id = any(pagar)
    union all
    select r.id, r.empresa_id, r.situacao, r.valor_liquido, r.valor_recebido, r.conta_bancaria_id, r.descricao
    from public.contas_receber r where r.id = any(receber)
  loop
    if t.empresa_id <> l.empresa_id then
      raise exception 'O título "%" é de outra empresa', t.descricao;
    end if;
    if t.situacao = 'cancelado' then
      raise exception 'O título "%" está cancelado', t.descricao;
    end if;
    if t.situacao = 'pago' and t.conta_bancaria_id <> l.conta_bancaria_id then
      raise exception 'O título "%" foi baixado em outra conta bancária. Estorne a baixa ou concilie na conta certa', t.descricao;
    end if;
    soma := soma + case when t.situacao = 'pago' then t.pago when quantos = 1 then alvo else t.valor end;
  end loop;
  if (select count(*) from public.contas_pagar where id = any(pagar)) + (select count(*) from public.contas_receber where id = any(receber)) <> quantos then
    raise exception 'Algum título não foi encontrado ou seu perfil não o enxerga';
  end if;
  if abs(soma - alvo) > 0.009 then
    raise exception 'Os títulos somam % e o extrato mostra %. Ajuste a escolha', to_char(soma, 'FM999G999G990D00'), to_char(alvo, 'FM999G999G990D00');
  end if;

  -- Vínculo e baixa.
  insert into public.extrato_conciliacoes (lancamento_id, conta_pagar_id, valor, efeito)
  select lancamento, p.id, case when p.situacao = 'pago' then p.valor_pago when quantos = 1 then alvo else p.valor end,
    case when p.situacao = 'pago' then 'vinculou' else 'baixou' end
  from public.contas_pagar p where p.id = any(pagar);
  insert into public.extrato_conciliacoes (lancamento_id, conta_receber_id, valor, efeito)
  select lancamento, r.id, case when r.situacao = 'pago' then r.valor_recebido when quantos = 1 then alvo else r.valor_liquido end,
    case when r.situacao = 'pago' then 'vinculou' else 'baixou' end
  from public.contas_receber r where r.id = any(receber);

  update public.contas_pagar p set situacao = 'pago', data_pagamento = l.data, conta_bancaria_id = l.conta_bancaria_id,
    valor_pago = c.valor
  from public.extrato_conciliacoes c
  where c.lancamento_id = lancamento and c.conta_pagar_id = p.id and c.efeito = 'baixou';
  update public.contas_receber r set situacao = 'pago', data_recebimento = l.data, conta_bancaria_id = l.conta_bancaria_id,
    valor_recebido = c.valor
  from public.extrato_conciliacoes c
  where c.lancamento_id = lancamento and c.conta_receber_id = r.id and c.efeito = 'baixou';

  update public.extrato_lancamentos set situacao = 'conciliado', conciliado_por = auth.uid(), conciliado_em = now()
  where id = lancamento;
end;
$$;
revoke execute on function public.conciliar_lancamento(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.conciliar_lancamento(uuid, uuid[], uuid[]) to authenticated;

-- Transferência entre contas do grupo (não é receita nem despesa) ou linha a
-- ignorar (estorno que se anula, lançamento repetido do banco), com motivo.
create function public.marcar_lancamento(lancamento uuid, situacao public.situacao_extrato, observacao text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.tem_permissao('financeiro.conciliacao', 'editar') then
    raise exception 'Seu perfil não pode conciliar o extrato';
  end if;
  if marcar_lancamento.situacao not in ('transferencia', 'ignorado') then
    raise exception 'Use a conciliação com títulos para conciliar';
  end if;
  if marcar_lancamento.situacao = 'ignorado' and nullif(trim(marcar_lancamento.observacao), '') is null then
    raise exception 'Escreva o motivo para ignorar o lançamento';
  end if;
  update public.extrato_lancamentos e
  set situacao = marcar_lancamento.situacao, observacao = nullif(trim(marcar_lancamento.observacao), ''),
    conciliado_por = auth.uid(), conciliado_em = now()
  where e.id = lancamento and e.situacao = 'pendente';
  if not found then
    raise exception 'Este lançamento já foi resolvido ou não foi encontrado';
  end if;
end;
$$;
revoke execute on function public.marcar_lancamento(uuid, public.situacao_extrato, text) from public, anon;
grant execute on function public.marcar_lancamento(uuid, public.situacao_extrato, text) to authenticated;

-- Volta a linha para pendente: títulos baixados pela conciliação voltam a
-- ficar em aberto; os que já estavam pagos só perdem a ligação.
create function public.desfazer_conciliacao(lancamento uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  l public.extrato_lancamentos;
  pagar uuid[];
  receber uuid[];
begin
  if not public.tem_permissao('financeiro.conciliacao', 'editar') then
    raise exception 'Seu perfil não pode conciliar o extrato';
  end if;
  select * into l from public.extrato_lancamentos where id = lancamento for update;
  if l.id is null then
    raise exception 'Lançamento do extrato não encontrado';
  end if;

  select array_agg(conta_pagar_id) filter (where efeito = 'baixou'), array_agg(conta_receber_id) filter (where efeito = 'baixou')
  into pagar, receber
  from public.extrato_conciliacoes where lancamento_id = lancamento;
  delete from public.extrato_conciliacoes where lancamento_id = lancamento;

  update public.contas_pagar set situacao = 'aberto', data_pagamento = null, valor_pago = null, conta_bancaria_id = null
  where id = any(coalesce(pagar, '{}'));
  update public.contas_receber set situacao = 'aberto', data_recebimento = null, valor_recebido = null, conta_bancaria_id = null
  where id = any(coalesce(receber, '{}'));

  update public.extrato_lancamentos
  set situacao = 'pendente', observacao = null, conciliado_por = null, conciliado_em = null
  where id = lancamento;
end;
$$;
revoke execute on function public.desfazer_conciliacao(uuid) from public, anon;
grant execute on function public.desfazer_conciliacao(uuid) to authenticated;

-- Título conciliado que deixa de estar pago (estorno no contas a pagar/receber,
-- cancelamento vindo do Tiny): a linha do extrato volta para pendente e perde
-- as ligações, para ser conciliada de novo. Roda como dono porque quem estorna
-- pode não ter acesso à conciliação.
create function public.soltar_titulo_conciliado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linha uuid;
begin
  if old.situacao = 'pago' and new.situacao <> 'pago' then
    select c.lancamento_id into linha from public.extrato_conciliacoes c
    where (tg_table_name = 'contas_pagar' and c.conta_pagar_id = old.id)
       or (tg_table_name = 'contas_receber' and c.conta_receber_id = old.id);
    if linha is not null then
      delete from public.extrato_conciliacoes where lancamento_id = linha;
      update public.extrato_lancamentos set situacao = 'pendente', conciliado_por = null, conciliado_em = null where id = linha;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.soltar_titulo_conciliado() from public, anon, authenticated;
create trigger soltar_conciliado after update on public.contas_pagar
  for each row execute function public.soltar_titulo_conciliado();
create trigger soltar_conciliado after update on public.contas_receber
  for each row execute function public.soltar_titulo_conciliado();

-- -----------------------------------------------------------------------------
-- Fluxo de caixa
-- -----------------------------------------------------------------------------
create table public.fluxo_previsoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  data date not null,
  tipo text not null check (tipo in ('entrada', 'saida')),
  valor numeric(14, 2) not null check (valor > 0),
  descricao text,
  usuario_id uuid default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now(),
  unique (empresa_id, data, tipo)
);

alter table public.fluxo_previsoes enable row level security;
create policy ver on public.fluxo_previsoes for select to authenticated
  using (public.tem_permissao('financeiro.fluxo_caixa', 'ver') and public.pode_ver_empresa(empresa_id));
create policy criar on public.fluxo_previsoes for insert to authenticated
  with check (public.tem_permissao('financeiro.fluxo_caixa', 'criar') and public.pode_ver_empresa(empresa_id));
create policy editar on public.fluxo_previsoes for update to authenticated
  using (public.tem_permissao('financeiro.fluxo_caixa', 'editar') and public.pode_ver_empresa(empresa_id))
  with check (public.tem_permissao('financeiro.fluxo_caixa', 'editar') and public.pode_ver_empresa(empresa_id));
-- Apagar a própria previsão faz parte de editar o fluxo.
create policy excluir on public.fluxo_previsoes for delete to authenticated
  using (public.tem_permissao('financeiro.fluxo_caixa', 'editar') and public.pode_ver_empresa(empresa_id));
create trigger auditoria after insert or update or delete on public.fluxo_previsoes
  for each row execute function public.registrar_auditoria();

-- Movimentos do fluxo somados por dia, categoria e conta. Roda com o acesso de
-- quem chama (a RLS de pagar, receber e extrato vale). natureza:
--   realizado  pago/recebido na data do pagamento (conta bancária preenchida)
--   previsto   em aberto, pela data de vencimento (a tela leva fim de semana e
--              feriado para o dia útil seguinte; por isso busca 5 dias antes de "de")
--   atrasado   em aberto e vencido: a tela coloca em "hoje"
--   manual     previsão digitada no fluxo
--   transferencia  linha do extrato marcada como transferência entre contas
create function public.fluxo_caixa(de date, ate date, empresa uuid default null)
returns table (
  data date,
  tipo text,
  natureza text,
  categoria_id uuid,
  conta_bancaria_id uuid,
  empresa_id uuid,
  valor numeric,
  titulos bigint
)
language sql
stable
set search_path = ''
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  mov as (
    select p.data_pagamento as data, 'saida' as tipo, 'realizado' as natureza, p.categoria_id, p.conta_bancaria_id, p.empresa_id, p.valor_pago as valor
    from public.contas_pagar p
    where p.situacao = 'pago' and p.data_pagamento between de and ate
    union all
    select r.data_recebimento, 'entrada', 'realizado', r.categoria_id, r.conta_bancaria_id, r.empresa_id, r.valor_recebido
    from public.contas_receber r
    where r.situacao = 'pago' and r.data_recebimento between de and ate
    union all
    select p.vencimento, 'saida', case when p.vencimento < h.d then 'atrasado' else 'previsto' end, p.categoria_id, null, p.empresa_id, p.valor
    from public.contas_pagar p, hoje h
    where p.situacao = 'aberto' and p.vencimento <= ate and (p.vencimento >= de - 5 or (p.vencimento < h.d and h.d between de and ate))
    union all
    select r.vencimento, 'entrada', case when r.vencimento < h.d then 'atrasado' else 'previsto' end, r.categoria_id, null, r.empresa_id, r.valor_liquido
    from public.contas_receber r, hoje h
    where r.situacao = 'aberto' and r.vencimento <= ate and (r.vencimento >= de - 5 or (r.vencimento < h.d and h.d between de and ate))
    union all
    select f.data, f.tipo, 'manual', null, null, f.empresa_id, f.valor
    from public.fluxo_previsoes f, hoje h
    where f.data between greatest(de, h.d) and ate
    union all
    select e.data, case when e.valor > 0 then 'entrada' else 'saida' end, 'transferencia', null, e.conta_bancaria_id, e.empresa_id, abs(e.valor)
    from public.extrato_lancamentos e
    where e.situacao = 'transferencia' and e.data between de and ate
  )
  select m.data, m.tipo, m.natureza, m.categoria_id, m.conta_bancaria_id, m.empresa_id, sum(m.valor), count(*)
  from mov m
  where fluxo_caixa.empresa is null or m.empresa_id = fluxo_caixa.empresa
  group by 1, 2, 3, 4, 5, 6;
$$;
revoke execute on function public.fluxo_caixa(date, date, uuid) from public, anon;
grant execute on function public.fluxo_caixa(date, date, uuid) to authenticated;

-- Saldo de cada conta no começo de "de" (ou no dia do saldo inicial, se for
-- depois): saldo inicial + recebido − pago + transferências desde então.
create function public.fluxo_caixa_saldos(de date, empresa uuid default null)
returns table (conta_bancaria_id uuid, empresa_id uuid, nome text, tipo public.tipo_conta_bancaria, data_saldo date, saldo numeric)
language sql
stable
set search_path = ''
as $$
  select b.id, b.empresa_id, b.nome, b.tipo, greatest(de, b.data_saldo_inicial),
    b.saldo_inicial
    + coalesce((select sum(r.valor_recebido) from public.contas_receber r
                where r.conta_bancaria_id = b.id and r.situacao = 'pago'
                  and r.data_recebimento >= b.data_saldo_inicial and r.data_recebimento < de), 0)
    - coalesce((select sum(p.valor_pago) from public.contas_pagar p
                where p.conta_bancaria_id = b.id and p.situacao = 'pago'
                  and p.data_pagamento >= b.data_saldo_inicial and p.data_pagamento < de), 0)
    + coalesce((select sum(e.valor) from public.extrato_lancamentos e
                where e.conta_bancaria_id = b.id and e.situacao = 'transferencia'
                  and e.data >= b.data_saldo_inicial and e.data < de), 0)
  from public.contas_bancarias b
  where b.ativa and (fluxo_caixa_saldos.empresa is null or b.empresa_id = fluxo_caixa_saldos.empresa)
  order by b.nome;
$$;
revoke execute on function public.fluxo_caixa_saldos(date, uuid) from public, anon;
grant execute on function public.fluxo_caixa_saldos(date, uuid) to authenticated;

-- O Supabase da Venner não dá acesso automático às tabelas novas.
grant select, insert, update, delete on public.extrato_importacoes, public.extrato_lancamentos,
  public.extrato_conciliacoes, public.fluxo_previsoes to authenticated;
