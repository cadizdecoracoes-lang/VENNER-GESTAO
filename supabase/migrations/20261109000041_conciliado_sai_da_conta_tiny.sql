-- Título conciliado que voltou para "Tiny · conta não informada".
--
-- Antes do pacote #37 (editado_aqui), a leitura do Tiny podia desfazer o que a
-- conciliação tinha feito num título pago no Tiny sem conta: a conciliação
-- trazia o título para a conta e a data do extrato, e a leitura seguinte o
-- devolvia para "Tiny · conta não informada". A linha do extrato continuava
-- conciliada, mas o título ficava fora da conta, e a tela de conciliação
-- mostrava "conciliada com título baixado em outra conta" (ex.: FWC 175,65 em
-- 15/10 no C6).
--
-- Esta correção, feita uma vez só, põe esses títulos de volta na conta e na
-- data da linha conciliada, guardando a conta e a data de antes para o
-- "Desfazer conciliação" devolver. A mudança é marcada em editado_aqui pelo
-- gatilho de sempre, então a leitura do Tiny não volta a mexer.

create function public.trazer_conciliados_da_conta_tiny()
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Guarda a conta e a data de antes, onde ainda não estão guardadas.
  update public.extrato_conciliacoes c
  set conta_anterior = p.conta_bancaria_id, data_anterior = p.data_pagamento
  from public.contas_pagar p, public.extrato_lancamentos l
  where c.conta_pagar_id = p.id and l.id = c.lancamento_id and l.situacao = 'conciliado'
    and p.situacao = 'pago' and public.conta_tiny_sem_banco(p.conta_bancaria_id)
    and c.conta_anterior is null;
  update public.extrato_conciliacoes c
  set conta_anterior = r.conta_bancaria_id, data_anterior = r.data_recebimento
  from public.contas_receber r, public.extrato_lancamentos l
  where c.conta_receber_id = r.id and l.id = c.lancamento_id and l.situacao = 'conciliado'
    and r.situacao = 'pago' and public.conta_tiny_sem_banco(r.conta_bancaria_id)
    and c.conta_anterior is null;

  -- Traz o título para a conta e a data da linha do extrato.
  update public.contas_pagar p
  set conta_bancaria_id = l.conta_bancaria_id, data_pagamento = l.data
  from public.extrato_conciliacoes c, public.extrato_lancamentos l
  where c.conta_pagar_id = p.id and l.id = c.lancamento_id and l.situacao = 'conciliado'
    and p.situacao = 'pago' and public.conta_tiny_sem_banco(p.conta_bancaria_id);
  update public.contas_receber r
  set conta_bancaria_id = l.conta_bancaria_id, data_recebimento = l.data
  from public.extrato_conciliacoes c, public.extrato_lancamentos l
  where c.conta_receber_id = r.id and l.id = c.lancamento_id and l.situacao = 'conciliado'
    and r.situacao = 'pago' and public.conta_tiny_sem_banco(r.conta_bancaria_id);
end;
$$;
revoke execute on function public.trazer_conciliados_da_conta_tiny() from public, anon, authenticated;

select public.trazer_conciliados_da_conta_tiny();
