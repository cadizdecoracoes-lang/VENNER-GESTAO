-- Linhas de saldo do extrato OFX do Itaú (pedido do Alexandre em 17/11/2026:
-- "tela de conciliação bancária está aparecendo saldo disponível da conta").
--
-- O OFX do Itaú traz o saldo de cada dia como se fosse um lançamento
-- ("SALDO TOTAL DISPONÍVEL DIA", doc 2026110x001, valor = saldo do dia). A
-- leitura do OFX não pulava essas linhas (a da planilha e a do PDF já pulavam),
-- então elas entraram na conciliação como saídas a conciliar. A tela agora
-- pula essas linhas na leitura (src/lib/extrato.ts, lerOfx).
--
-- Aqui apagamos as que já foram importadas, só elas:
-- - só linhas vindas de arquivo OFX;
-- - só as que começam com "saldo" (sem acento, maiúscula ou minúscula);
-- - só pendentes ou ignoradas, e sem nenhuma conciliação ligada.
-- Uma linha de saldo que alguém conciliou ou marcou como transferência fica
-- como está (aparece num aviso) para ser desfeita na tela.
-- A contagem "importadas" da importação diminui das pendentes apagadas.

create function public.excluir_linhas_saldo_extrato()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  apagadas integer;
  sobra integer;
begin
  with saldo as (
    select l.id, l.importacao_id, l.situacao
    from public.extrato_lancamentos l
    join public.extrato_importacoes i on i.id = l.importacao_id
    where i.origem = 'ofx'
      and translate(lower(trim(l.descricao)), 'áàâãéêíóôõúç', 'aaaaeeiooouc') ~ '^(saldo|sdo\M|s a l d o)'
  ),
  apagar as (
    delete from public.extrato_lancamentos l
    using saldo s
    where l.id = s.id
      and s.situacao in ('pendente', 'ignorado')
      and not exists (select 1 from public.extrato_conciliacoes c where c.lancamento_id = l.id)
    returning s.importacao_id, s.situacao
  ),
  contagem as (
    update public.extrato_importacoes i
    set importadas = greatest(i.importadas - a.n, 0)
    from (select importacao_id, count(*) filter (where situacao = 'pendente') as n from apagar group by importacao_id) a
    where i.id = a.importacao_id
    returning i.id
  )
  select (select count(*) from apagar) into apagadas;

  select count(*) into sobra
  from public.extrato_lancamentos l
  join public.extrato_importacoes i on i.id = l.importacao_id
  where i.origem = 'ofx'
    and translate(lower(trim(l.descricao)), 'áàâãéêíóôõúç', 'aaaaeeiooouc') ~ '^(saldo|sdo\M|s a l d o)';
  if sobra > 0 then
    raise notice '% linha(s) de saldo do OFX ficaram por estarem conciliadas ou como transferência', sobra;
  end if;
  raise notice '% linha(s) de saldo do OFX apagadas', apagadas;
  return apagadas;
end;
$$;
revoke execute on function public.excluir_linhas_saldo_extrato() from public, anon, authenticated;

select public.excluir_linhas_saldo_extrato();
