-- Conciliação de vários lançamentos do extrato com vários títulos de uma vez.
--
-- Pedido do Alexandre (16/11/2026): recebimentos sem pedido de venda, em que o
-- financeiro criou títulos manuais no Tiny. Às vezes são dois títulos para uma
-- entrada no banco; às vezes um título só, recebido em duas entradas em dias
-- diferentes. O financeiro marca as linhas do extrato e os títulos e confirma;
-- tudo sai da lista de pendentes junto.
--
-- Regra do Alexandre (16/11/2026 14:30): a conciliação é só apoio para achar
-- diferença e erro de baixa feita no Tiny; não dá baixa nem altera título (a
-- correção é feita só no Tiny). Por isso esta conciliação só VINCULA linhas e
-- títulos (efeito 'vinculou'), em aberto ou pagos; a Conferência com o Tiny
-- aponta o que ficou diferente (título em aberto, outra data, outra conta).
--
-- - extrato_conciliacoes.grupo: as ligações conciliadas juntas. Até aqui cada
--   linha era o seu grupo (grupo = lancamento_id, também o padrão para quem
--   grava sem grupo, como conciliar_lancamento e lancar_transferencia).
-- - Um título pode agora estar ligado a mais de uma linha, mas só dentro do
--   mesmo grupo (antes: índice único por título). Continua valendo "um título
--   é conciliado uma vez só".
-- - conciliar_lancamentos(lancamentos, pagar, receber): com uma linha chama o
--   conciliar_lancamento de sempre. Com várias: todas da mesma conta, todas
--   entradas (com contas a receber) ou todas saídas (com contas a pagar), e a
--   soma dos títulos (pago: valor baixado no Tiny; em aberto: valor do título)
--   tem de bater com o total das linhas. O valor de cada título é repartido
--   entre as linhas em ordem de data, só para mostrar.
-- - Desfazer uma linha de um grupo desfaz o grupo todo; excluir uma importação
--   também devolve para pendente as linhas de outra importação que estavam no
--   mesmo grupo (gatilho soltar_grupo; as funções de desfazer e excluir não
--   mudam).

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
    if exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = t.id or c.conta_receber_id = t.id) then
      raise exception 'O título "%" já está conciliado com outro lançamento do extrato', t.descricao;
    end if;
    ts := ts || jsonb_build_object(
      'id', t.id,
      'pago', t.situacao = 'pago',
      'valor', case when t.situacao = 'pago' then t.valor_baixado else t.valor_aberto end);
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
      insert into public.extrato_conciliacoes (lancamento_id, conta_pagar_id, conta_receber_id, valor, efeito, grupo)
      values (l.id,
        case when not entrada then (titulo ->> 'id')::uuid end,
        case when entrada then (titulo ->> 'id')::uuid end,
        round(parte, 2), 'vinculou', grupo_novo);
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

  -- Os títulos não mudam: a baixa é a do Tiny.
  update public.extrato_lancamentos set situacao = 'conciliado', conciliado_por = auth.uid(), conciliado_em = now()
  where id = any(lancamentos);
end;
$$;
revoke execute on function public.conciliar_lancamentos(uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.conciliar_lancamentos(uuid[], uuid[], uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Desfazer ou excluir uma linha solta o grupo todo
-- -----------------------------------------------------------------------------
-- Quando sai uma ligação de um grupo com várias linhas (desfazer a conciliação
-- de uma linha, excluir a importação), saem as outras ligações do grupo e as
-- outras linhas voltam para pendente. Assim desfazer_conciliacao e
-- excluir_importacao_extrato seguem como estão (o que fazem com os títulos é
-- deles; as ligações em grupo só vinculam e não mudam título nenhum).
create function public.soltar_grupo_conciliacao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  outras uuid[];
begin
  with apagadas as (
    delete from public.extrato_conciliacoes c where c.grupo = old.grupo returning c.lancamento_id
  )
  select array_agg(distinct lancamento_id) into outras from apagadas where lancamento_id <> old.lancamento_id;
  if outras is not null then
    update public.extrato_lancamentos e
    set situacao = 'pendente', observacao = null, conciliado_por = null, conciliado_em = null
    where e.id = any(outras) and e.situacao = 'conciliado'
      and not exists (select 1 from public.extrato_conciliacoes c where c.lancamento_id = e.id);
  end if;
  return null;
end;
$$;
create trigger soltar_grupo after delete on public.extrato_conciliacoes
  for each row when (old.grupo <> old.lancamento_id) execute function public.soltar_grupo_conciliacao();
