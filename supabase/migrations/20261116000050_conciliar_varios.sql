-- Conciliação de vários lançamentos do extrato com vários títulos de uma vez.
--
-- Pedido do Alexandre (16/11/2026): recebimentos sem pedido de venda, em que o
-- financeiro criou títulos manuais no Tiny. Às vezes são dois títulos para uma
-- entrada no banco; às vezes um título só, recebido em duas entradas em dias
-- diferentes. O financeiro marca as linhas do extrato e os títulos e confirma;
-- tudo sai da lista de pendentes junto.
--
-- - extrato_conciliacoes.grupo: as ligações conciliadas juntas. Até aqui cada
--   linha era o seu grupo (grupo = lancamento_id, também o padrão para quem
--   grava sem grupo, como conciliar_lancamento e lancar_transferencia).
-- - Um título pode agora estar ligado a mais de uma linha, mas só dentro do
--   mesmo grupo (antes: índice único por título). Continua valendo "um título
--   é conciliado uma vez só".
-- - conciliar_lancamentos(lancamentos, pagar, receber). O nome contém
--   "conciliar_lancamento" de propósito: o gatilho bloquear_titulo_tiny (pacote
--   #58) só deixa a conciliação mexer em título do Tiny pelas funções cujo nome
--   bate com esse padrão.
--   mesma regra de sempre (tudo
--   conciliado vem de um título a pagar/receber, a soma tem de bater). Com uma
--   linha só, é o conciliar_lancamento de sempre. Com várias: todas da mesma
--   conta, todas entradas (com contas a receber) ou todas saídas (com contas a
--   pagar). O valor de cada título é repartido entre as linhas em ordem de
--   data; título em aberto é baixado na data da última linha que o recebeu.
-- - Desfazer uma linha de um grupo desfaz o grupo todo; excluir uma importação
--   também devolve para pendente as linhas de outra importação que estavam no
--   mesmo grupo.

alter table public.extrato_conciliacoes add column grupo uuid;
update public.extrato_conciliacoes set grupo = lancamento_id;
alter table public.extrato_conciliacoes alter column grupo set not null;
create index extrato_conciliacoes_grupo_idx on public.extrato_conciliacoes (grupo);

drop index public.extrato_conciliacoes_pagar_idx;
drop index public.extrato_conciliacoes_receber_idx;
create unique index extrato_conciliacoes_pagar_idx on public.extrato_conciliacoes (conta_pagar_id, lancamento_id) where conta_pagar_id is not null;
create unique index extrato_conciliacoes_receber_idx on public.extrato_conciliacoes (conta_receber_id, lancamento_id) where conta_receber_id is not null;

-- Sem grupo informado, a linha é o próprio grupo; título já conciliado em
-- outro grupo é recusado.
create function public.validar_grupo_conciliacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.grupo := coalesce(new.grupo, new.lancamento_id);
  if exists (
    select 1 from public.extrato_conciliacoes c
    where c.grupo <> new.grupo
      and ((new.conta_pagar_id is not null and c.conta_pagar_id = new.conta_pagar_id)
        or (new.conta_receber_id is not null and c.conta_receber_id = new.conta_receber_id))
  ) then
    raise exception 'Este título já está conciliado com outro lançamento do extrato. Desfaça aquela conciliação antes';
  end if;
  return new;
end;
$$;
create trigger validar_grupo before insert or update of grupo, conta_pagar_id, conta_receber_id on public.extrato_conciliacoes
  for each row execute function public.validar_grupo_conciliacao();

-- Linhas ligadas às linhas dadas pela conciliação em grupo (inclui as dadas).
create function public.linhas_do_grupo(linhas uuid[])
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.id), '{}') from (
    select unnest(linhas) as id
    union
    select c2.lancamento_id
    from public.extrato_conciliacoes c
    join public.extrato_conciliacoes c2 on c2.grupo = c.grupo
    where c.lancamento_id = any(linhas)
  ) x;
$$;
revoke execute on function public.linhas_do_grupo(uuid[]) from public, anon;
grant execute on function public.linhas_do_grupo(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Conciliar vários de uma vez
-- -----------------------------------------------------------------------------
create function public.conciliar_lancamentos(lancamentos uuid[], pagar uuid[] default '{}', receber uuid[] default '{}')
returns void
language plpgsql
set search_path = ''
as $$
declare
  ls public.extrato_lancamentos[];
  l public.extrato_lancamentos;
  t record;
  ts jsonb := '[]';
  qtd_linhas integer := coalesce(cardinality(lancamentos), 0);
  qtd_titulos integer := coalesce(cardinality(pagar), 0) + coalesce(cardinality(receber), 0);
  entrada boolean;
  alvo numeric;
  soma numeric := 0;
  grupo_novo uuid := gen_random_uuid();
  -- repartição
  i integer := 1;
  j integer := 0;
  resto_linha numeric;
  resto_titulo numeric;
  parte numeric;
  titulo jsonb;
begin
  if not public.tem_permissao('financeiro.conciliacao', 'editar') then
    raise exception 'Seu perfil não pode conciliar o extrato';
  end if;
  if qtd_linhas = 0 then
    raise exception 'Escolha ao menos um lançamento do extrato';
  end if;
  if qtd_linhas = 1 then
    perform public.conciliar_lancamento(lancamentos[1], coalesce(pagar, '{}'), coalesce(receber, '{}'));
    return;
  end if;
  if qtd_titulos = 0 then
    raise exception 'Escolha ao menos um título para conciliar';
  end if;

  select array_agg(e order by e.data, e.chave, e.id) into ls
  from (select * from public.extrato_lancamentos where id = any(lancamentos) order by id for update) e;
  if coalesce(cardinality(ls), 0) <> (select count(distinct x) from unnest(lancamentos) x) then
    raise exception 'Algum lançamento do extrato não foi encontrado';
  end if;
  entrada := ls[1].valor > 0;
  foreach l in array ls loop
    if l.situacao <> 'pendente' then
      raise exception 'O lançamento de % (%) já foi resolvido. Desfaça antes de conciliar de novo', to_char(l.data, 'DD/MM/YYYY'), l.descricao;
    end if;
    if l.conta_bancaria_id <> ls[1].conta_bancaria_id then
      raise exception 'Os lançamentos escolhidos são de contas bancárias diferentes';
    end if;
    if (l.valor > 0) <> entrada then
      raise exception 'Escolha só entradas ou só saídas do extrato';
    end if;
  end loop;
  if entrada and coalesce(cardinality(pagar), 0) > 0 then
    raise exception 'Entradas do extrato juntas se conciliam só com contas a receber';
  end if;
  if not entrada and coalesce(cardinality(receber), 0) > 0 then
    raise exception 'Saídas do extrato juntas se conciliam só com contas a pagar';
  end if;
  select sum(abs(x.valor)) into alvo from unnest(ls) x;

  -- Títulos em ordem de data (vencimento ou baixa), com o valor que entra.
  for t in
    select p.id, p.empresa_id, p.situacao, p.valor_pago as valor_baixado, p.valor as valor_aberto,
      p.conta_bancaria_id, p.descricao, coalesce(p.data_pagamento, p.vencimento) as data_ref
    from public.contas_pagar p where p.id = any(pagar)
    union all
    select r.id, r.empresa_id, r.situacao, r.valor_recebido, r.valor_liquido,
      r.conta_bancaria_id, r.descricao, coalesce(r.data_recebimento, r.vencimento)
    from public.contas_receber r where r.id = any(receber)
    order by data_ref, id
  loop
    if t.empresa_id <> ls[1].empresa_id then
      raise exception 'O título "%" é de outra empresa', t.descricao;
    end if;
    if t.situacao = 'cancelado' then
      raise exception 'O título "%" está cancelado', t.descricao;
    end if;
    if t.situacao = 'pago' and t.conta_bancaria_id <> ls[1].conta_bancaria_id and not public.conta_tiny_sem_banco(t.conta_bancaria_id) then
      raise exception 'O título "%" foi baixado em outra conta bancária. Estorne a baixa ou concilie na conta certa', t.descricao;
    end if;
    if exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = t.id or c.conta_receber_id = t.id) then
      raise exception 'O título "%" já está conciliado com outro lançamento do extrato', t.descricao;
    end if;
    ts := ts || jsonb_build_object(
      'id', t.id,
      'pago', t.situacao = 'pago',
      -- Com várias linhas, o título tem de bater exato (sem baixa pelo valor do extrato).
      'valor', case when t.situacao = 'pago' then t.valor_baixado else t.valor_aberto end,
      'conta', t.conta_bancaria_id,
      'data', t.data_ref);
    soma := soma + case when t.situacao = 'pago' then t.valor_baixado else t.valor_aberto end;
  end loop;
  if jsonb_array_length(ts) <> qtd_titulos then
    raise exception 'Algum título não foi encontrado ou seu perfil não o enxerga';
  end if;
  if abs(soma - alvo) > 0.009 then
    raise exception 'Os títulos somam % e os lançamentos do extrato somam %. Ajuste a escolha',
      to_char(soma, 'FM999G999G990D00'), to_char(alvo, 'FM999G999G990D00');
  end if;

  -- Reparte: cada linha (em ordem de data) recebe pedaços dos títulos (em
  -- ordem de data) até completar o seu valor.
  resto_linha := abs(ls[1].valor);
  titulo := ts -> 0;
  resto_titulo := (titulo ->> 'valor')::numeric;
  loop
    parte := least(resto_linha, resto_titulo);
    if parte > 0.004 then
      l := ls[i];
      insert into public.extrato_conciliacoes (lancamento_id, conta_pagar_id, conta_receber_id, valor, efeito, conta_anterior, data_anterior, grupo)
      values (l.id,
        case when not entrada then (titulo ->> 'id')::uuid end,
        case when entrada then (titulo ->> 'id')::uuid end,
        round(parte, 2),
        case when (titulo ->> 'pago')::boolean then 'vinculou' else 'baixou' end,
        case when (titulo ->> 'pago')::boolean and (titulo ->> 'conta')::uuid <> l.conta_bancaria_id then (titulo ->> 'conta')::uuid end,
        case when (titulo ->> 'pago')::boolean and (titulo ->> 'conta')::uuid <> l.conta_bancaria_id then (titulo ->> 'data')::date end,
        grupo_novo);
    end if;
    resto_linha := resto_linha - parte;
    resto_titulo := resto_titulo - parte;
    if resto_titulo <= 0.004 then
      j := j + 1;
      exit when j >= jsonb_array_length(ts);
      titulo := ts -> j;
      resto_titulo := (titulo ->> 'valor')::numeric;
    end if;
    if resto_linha <= 0.004 then
      i := i + 1;
      exit when i > cardinality(ls);
      resto_linha := abs(ls[i].valor);
    end if;
  end loop;

  -- Pago do Tiny sem conta passa a ser desta conta; em aberto é baixado. A
  -- data é a da última linha do extrato ligada ao título.
  update public.contas_pagar p
  set conta_bancaria_id = x.conta, data_pagamento = x.dia,
    situacao = 'pago', valor_pago = case when x.baixou then x.total else p.valor_pago end
  from (
    select c.conta_pagar_id as id, max(e.data) as dia, max(e.conta_bancaria_id::text)::uuid as conta,
      sum(c.valor) as total, bool_or(c.efeito = 'baixou') as baixou, bool_or(c.conta_anterior is not null) as mudou
    from public.extrato_conciliacoes c join public.extrato_lancamentos e on e.id = c.lancamento_id
    where c.grupo = grupo_novo and c.conta_pagar_id is not null
    group by c.conta_pagar_id
  ) x
  where p.id = x.id and (x.baixou or x.mudou);
  update public.contas_receber r
  set conta_bancaria_id = x.conta, data_recebimento = x.dia,
    situacao = 'pago', valor_recebido = case when x.baixou then x.total else r.valor_recebido end
  from (
    select c.conta_receber_id as id, max(e.data) as dia, max(e.conta_bancaria_id::text)::uuid as conta,
      sum(c.valor) as total, bool_or(c.efeito = 'baixou') as baixou, bool_or(c.conta_anterior is not null) as mudou
    from public.extrato_conciliacoes c join public.extrato_lancamentos e on e.id = c.lancamento_id
    where c.grupo = grupo_novo and c.conta_receber_id is not null
    group by c.conta_receber_id
  ) x
  where r.id = x.id and (x.baixou or x.mudou);

  update public.extrato_lancamentos set situacao = 'conciliado', conciliado_por = auth.uid(), conciliado_em = now()
  where id = any(lancamentos);
end;
$$;
revoke execute on function public.conciliar_lancamentos(uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.conciliar_lancamentos(uuid[], uuid[], uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Desfazer: o grupo todo
-- -----------------------------------------------------------------------------
create or replace function public.desfazer_conciliacao(lancamento uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  linhas uuid[];
  pagar uuid[];
  receber uuid[];
begin
  if not public.tem_permissao('financeiro.conciliacao', 'editar') then
    raise exception 'Seu perfil não pode conciliar o extrato';
  end if;
  if not exists (select 1 from public.extrato_lancamentos where id = lancamento) then
    raise exception 'Lançamento do extrato não encontrado';
  end if;
  linhas := public.linhas_do_grupo(array[lancamento]);
  perform 1 from public.extrato_lancamentos where id = any(linhas) order by id for update;

  select array_agg(distinct conta_pagar_id) filter (where efeito = 'baixou'), array_agg(distinct conta_receber_id) filter (where efeito = 'baixou')
  into pagar, receber
  from public.extrato_conciliacoes where lancamento_id = any(linhas);
  perform public.devolver_conta_tiny(linhas);
  delete from public.extrato_conciliacoes where lancamento_id = any(linhas);

  update public.contas_pagar set situacao = 'aberto', data_pagamento = null, valor_pago = null, conta_bancaria_id = null
  where id = any(coalesce(pagar, '{}'));
  update public.contas_receber set situacao = 'aberto', data_recebimento = null, valor_recebido = null, conta_bancaria_id = null
  where id = any(coalesce(receber, '{}'));

  update public.extrato_lancamentos
  set situacao = 'pendente', observacao = null, conciliado_por = null, conciliado_em = null
  where id = any(linhas);
end;
$$;

-- -----------------------------------------------------------------------------
-- Excluir importação: linhas de outra importação no mesmo grupo voltam a pendente
-- -----------------------------------------------------------------------------
create or replace function public.excluir_importacao_extrato(importacao uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  imp public.extrato_importacoes;
  todas uuid[];
  pagar uuid[];
  receber uuid[];
  linhas integer;
  conciliadas integer;
begin
  if not public.tem_permissao('financeiro.conciliacao', 'excluir') then
    raise exception 'Seu perfil não pode excluir extrato importado';
  end if;
  select * into imp from public.extrato_importacoes where id = importacao for update;
  if imp.id is null or not public.pode_ver_empresa(imp.empresa_id) then
    raise exception 'Importação não encontrada';
  end if;

  select count(*), count(*) filter (where situacao <> 'pendente')
  into linhas, conciliadas
  from public.extrato_lancamentos where importacao_id = importacao;

  todas := public.linhas_do_grupo(array(select id from public.extrato_lancamentos where importacao_id = importacao));

  select array_agg(distinct c.conta_pagar_id) filter (where c.efeito = 'baixou'),
    array_agg(distinct c.conta_receber_id) filter (where c.efeito = 'baixou')
  into pagar, receber
  from public.extrato_conciliacoes c
  where c.lancamento_id = any(todas);

  perform public.devolver_conta_tiny(todas);
  delete from public.extrato_conciliacoes c where c.lancamento_id = any(todas);

  update public.contas_pagar set situacao = 'aberto', data_pagamento = null, valor_pago = null, conta_bancaria_id = null
  where id = any(coalesce(pagar, '{}'));
  update public.contas_receber set situacao = 'aberto', data_recebimento = null, valor_recebido = null, conta_bancaria_id = null
  where id = any(coalesce(receber, '{}'));

  -- Linhas de outra importação que estavam no mesmo grupo voltam para a lista.
  update public.extrato_lancamentos
  set situacao = 'pendente', observacao = null, conciliado_por = null, conciliado_em = null
  where id = any(todas) and importacao_id is distinct from importacao and situacao = 'conciliado';

  -- As linhas saem junto (on delete cascade).
  delete from public.extrato_importacoes where id = importacao;
  -- Cópia que estava de fora por repetir uma linha desta importação volta para a lista.
  perform public.marcar_repetidos_extrato(imp.conta_bancaria_id);

  return jsonb_build_object(
    'linhas', linhas,
    'conciliadas', conciliadas,
    'reabertos', coalesce(array_length(pagar, 1), 0) + coalesce(array_length(receber, 1), 0));
end;
$$;
