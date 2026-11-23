-- Junção de contas bancárias: título lançado só aqui que ficou repetido.
--
-- Na junção do Itaú (migração 20261123000071) a mesma linha do extrato
-- estava nas duas contas e, nas duas, foi usada no "Lançar transferência"
-- (PIX para a ASHI de 920,51 em 03/11): cada cópia criou o próprio título.
-- A cópia da conta juntada saiu, mas o título dela ficou pago no Banco Itaú,
-- sem extrato, dobrando a saída no fluxo de caixa.
--
-- - juntar_contas_bancarias_interno: título lançado só aqui (sem Tiny) que
--   estava ligado à cópia que sai e não fica ligado a mais nenhuma linha é
--   cancelado (fica o rastro; o do Tiny nunca é mexido).
-- - Corrige o título repetido da junção do Itaú da Venner.

create or replace function public.juntar_contas_bancarias_interno(de_conta uuid, para_conta uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.contas_bancarias;
  b public.contas_bancarias;
  dois_tiny boolean;
  pagar integer;
  receber integer;
  linhas integer;
  imps integer;
  repetidas integer;
  sair uuid[];
  soltos_pagar uuid[];
  soltos_receber uuid[];
  cancelados integer := 0;
  n integer;
begin
  if de_conta = para_conta then
    raise exception 'Escolha outra conta para receber os lançamentos';
  end if;
  select * into a from public.contas_bancarias where id = de_conta for update;
  select * into b from public.contas_bancarias where id = para_conta for update;
  if a.id is null or b.id is null then
    raise exception 'Conta bancária não encontrada';
  end if;
  if a.empresa_id <> b.empresa_id then
    raise exception 'As duas contas precisam ser da mesma empresa (CNPJ)';
  end if;
  dois_tiny := a.tiny_id is not null and b.tiny_id is not null;

  -- Títulos: com duas contas do Tiny, só os lançados aqui mudam (o Tiny vale).
  update public.contas_pagar set conta_bancaria_id = para_conta
  where conta_bancaria_id = de_conta and (not dois_tiny or tiny_id is null);
  get diagnostics pagar = row_count;
  update public.contas_receber set conta_bancaria_id = para_conta
  where conta_bancaria_id = de_conta and (not dois_tiny or tiny_id is null);
  get diagnostics receber = row_count;
  update public.extrato_conciliacoes set conta_anterior = para_conta where conta_anterior = de_conta;

  -- A mesma linha do banco nas duas contas (mesma chave): fica uma só.
  with pares as (
    select o.id as o_id, d.id as d_id,
      (o.situacao <> 'pendente' and d.situacao = 'pendente') as fica_a_da_origem
    from public.extrato_lancamentos o
    join public.extrato_lancamentos d on d.conta_bancaria_id = para_conta and d.chave = o.chave
    where o.conta_bancaria_id = de_conta
  )
  select array_agg(case when fica_a_da_origem then d_id else o_id end) into sair from pares;
  repetidas := coalesce(cardinality(sair), 0);
  if repetidas > 0 then
    -- Títulos lançados só aqui ligados à cópia que sai (ex.: "Lançar
    -- transferência" feito nas duas contas): a outra cópia tem o dela.
    select array_agg(c.conta_pagar_id) filter (where p.tiny_id is null),
      array_agg(c.conta_receber_id) filter (where r.tiny_id is null)
    into soltos_pagar, soltos_receber
    from public.extrato_conciliacoes c
    left join public.contas_pagar p on p.id = c.conta_pagar_id
    left join public.contas_receber r on r.id = c.conta_receber_id
    where c.lancamento_id = any(sair);
    perform public.devolver_conta_tiny(sair);
    delete from public.extrato_conciliacoes where lancamento_id = any(sair);
    delete from public.extrato_lancamentos where id = any(sair);
    -- Sem outra linha do extrato, o título repetido é cancelado (não some: fica o rastro).
    update public.contas_pagar p set situacao = 'cancelado', data_pagamento = null, valor_pago = null, conta_bancaria_id = null,
      observacao = 'Repetido na junção de contas bancárias (a outra cópia continua conciliada)'
    where p.id = any(coalesce(soltos_pagar, '{}')) and p.situacao <> 'cancelado'
      and not exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = p.id);
    get diagnostics n = row_count;
    cancelados := n;
    update public.contas_receber r set situacao = 'cancelado', data_recebimento = null, valor_recebido = null, conta_bancaria_id = null,
      observacao = 'Repetido na junção de contas bancárias (a outra cópia continua conciliada)'
    where r.id = any(coalesce(soltos_receber, '{}')) and r.situacao <> 'cancelado'
      and not exists (select 1 from public.extrato_conciliacoes c where c.conta_receber_id = r.id);
    get diagnostics n = row_count;
    cancelados := cancelados + n;
  end if;

  -- Mesma chave que sobrou (não deveria): ganha um sufixo para caber.
  update public.extrato_lancamentos l set chave = l.chave || '|junta:' || de_conta
  where l.conta_bancaria_id = de_conta
    and exists (select 1 from public.extrato_lancamentos d where d.conta_bancaria_id = para_conta and d.chave = l.chave);
  update public.extrato_lancamentos set conta_bancaria_id = para_conta where conta_bancaria_id = de_conta;
  get diagnostics linhas = row_count;
  update public.extrato_importacoes set conta_bancaria_id = para_conta where conta_bancaria_id = de_conta;
  get diagnostics imps = row_count;

  if dois_tiny then
    update public.contas_bancarias
    set ativa = false, nome = left(a.nome || ' (juntada em ' || b.nome || ')', 120)
    where id = de_conta;
  else
    if a.tiny_id is not null then
      update public.contas_bancarias set tiny_id = null where id = de_conta;
      update public.contas_bancarias set tiny_id = a.tiny_id where id = para_conta;
    end if;
    delete from public.contas_bancarias where id = de_conta;
  end if;
  if linhas > 0 or repetidas > 0 then
    perform public.marcar_repetidos_extrato(para_conta);
  end if;

  return jsonb_build_object('pagar', pagar, 'receber', receber, 'extrato', linhas, 'importacoes', imps,
    'repetidas', repetidas, 'inativada', dois_tiny, 'titulos_cancelados', cancelados);
end;
$$;
revoke execute on function public.juntar_contas_bancarias_interno(uuid, uuid) from public, anon, authenticated;

-- Itaú da Venner: o título de transferência da cópia que saiu.
update public.contas_pagar p set situacao = 'cancelado', data_pagamento = null, valor_pago = null, conta_bancaria_id = null,
  observacao = 'Repetido na junção de contas bancárias (a outra cópia continua conciliada)'
where p.tiny_id is null and p.situacao = 'pago' and p.valor = 920.51 and p.data_pagamento = '2026-11-03'
  and p.descricao like 'Transferência entre contas%ASHI%'
  and not exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = p.id)
  and exists (select 1 from public.contas_pagar o join public.extrato_conciliacoes c on c.conta_pagar_id = o.id
              where o.id <> p.id and o.descricao = p.descricao and o.valor = p.valor and o.data_pagamento = p.data_pagamento
                and o.conta_bancaria_id = p.conta_bancaria_id and o.situacao = 'pago');
