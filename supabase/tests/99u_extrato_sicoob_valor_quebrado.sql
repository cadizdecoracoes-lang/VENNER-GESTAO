-- Teste da limpeza das linhas erradas do PDF do Sicoob: apaga só as linhas de
-- PDF com valor solto no meio do texto que estão pendentes ou ignoradas e sem
-- conciliação; não mexe em lançamentos certos, em linhas conciliadas nem em OFX.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

reset role;
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Itaú movimento';

-- Importação como a do Sicoob de 16/11: linhas erradas misturadas com certas.
select set_config('teste.pdf', (importar_extrato(current_setting('teste.conta')::uuid, 'pdf', 'sicoob-novembro.pdf', '[
    {"data": "2026-11-05", "descricao": "TARIFA COBRANÇA · 2.278,56 · 05/11 CRÉD.LIQ.COBRANÇA", "documento": "4908910", "valor": 1.10},
    {"data": "2026-11-11", "descricao": "DÉB.TIT.COMPE.EFETI · 23.000,00 · 11/11 PIX RECEB.OUTRA IF · FWC", "valor": 1771.05},
    {"data": "2026-11-11", "descricao": "PIX EMIT.OUTRA IF · 72.675.028 0004-82 · 9.488,86", "valor": 584.92},
    {"data": "2026-11-12", "descricao": "PIX EMIT.OUTRA IF · 09.390.745 0001-89 · 10.296,91 · 12/11 CRED.TR.CT", "valor": 6891.29},
    {"data": "2026-11-12", "descricao": "PIX RECEB.OUTRA IF · CLIENTE · 57.455.984 0001-12", "valor": 100}
  ]'::jsonb, 7000) ->> 'importacao'), false);
-- Uma das erradas foi ignorada à mão; outra já foi conciliada (fica).
update extrato_lancamentos set situacao = 'ignorado', observacao = 'errado'
where importacao_id = current_setting('teste.pdf')::uuid and valor = 584.92;
insert into extrato_conciliacoes (lancamento_id, conta_receber_id, valor, efeito)
select l.id, r.id, 6891.29, 'vinculou'
from extrato_lancamentos l, contas_receber r
where l.importacao_id = current_setting('teste.pdf')::uuid and l.valor = 6891.29
  and not exists (select 1 from extrato_conciliacoes c where c.conta_receber_id = r.id)
limit 1;
update extrato_lancamentos set situacao = 'conciliado'
where importacao_id = current_setting('teste.pdf')::uuid and valor = 6891.29;
select pg_temp.esperar(
  exists (select 1 from extrato_conciliacoes c join extrato_lancamentos l on l.id = c.lancamento_id
          where l.importacao_id = current_setting('teste.pdf')::uuid),
  'uma das linhas erradas está conciliada');
-- Mesmo texto vindo de OFX não é mexido.
select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'outro.ofx',
  '[{"data": "2026-11-13", "descricao": "PAGTO · 1.000,00 · TESTE", "valor": -10, "id_banco": "X1"}]'::jsonb);

select pg_temp.esperar(
  (select importadas from extrato_importacoes where id = current_setting('teste.pdf')::uuid) = 5,
  'antes da limpeza a importação conta as 5 linhas');

select pg_temp.esperar(
  excluir_linhas_sicoob_valor_quebrado() = 3,
  'apaga as linhas erradas pendentes ou ignoradas e sem conciliação');
select pg_temp.esperar(
  exists (select 1 from extrato_lancamentos where descricao like 'PIX RECEB.OUTRA IF · CLIENTE%'),
  'lançamento certo (CNPJ no complemento, sem valor solto) fica');
select pg_temp.esperar(
  exists (select 1 from extrato_lancamentos where valor = 6891.29),
  'linha errada já conciliada fica para ser desfeita na tela');
select pg_temp.esperar(
  exists (select 1 from extrato_lancamentos where descricao = 'PAGTO · 1.000,00 · TESTE'),
  'linha de OFX não é apagada');
select pg_temp.esperar(
  (select importadas from extrato_importacoes where id = current_setting('teste.pdf')::uuid) = 3,
  'a contagem da importação desconta as 2 pendentes apagadas (a ignorada já não contava como pendente)');
select pg_temp.esperar(excluir_linhas_sicoob_valor_quebrado() = 0, 'rodar de novo não apaga nada');
