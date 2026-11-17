-- Teste da limpeza das linhas de saldo do OFX do Itaú: apaga só as linhas
-- "SALDO ..." de OFX que estão pendentes ou ignoradas e sem conciliação;
-- não mexe em lançamentos de verdade nem em linhas de saldo de PDF/planilha.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

reset role;
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Itaú movimento';

-- Importação de OFX como a da Venner: saldo do dia misturado com os PIX.
select set_config('teste.ofx', (importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'itau-novembro.ofx', '[
    {"data": "2026-11-03", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "documento": "20261103001", "valor": -3030.11, "id_banco": "S1"},
    {"data": "2026-11-03", "descricao": "PIX RECEBIDO AX CAPI03/11", "valor": 12700, "id_banco": "S2"},
    {"data": "2026-11-04", "descricao": "Saldo total disponivel dia", "documento": "20261104001", "valor": -2719.74, "id_banco": "S3"},
    {"data": "2026-11-05", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "documento": "20261105001", "valor": -2421.74, "id_banco": "S4"},
    {"data": "2026-11-05", "descricao": "TOTALPASS MENSAL", "valor": -50, "id_banco": "S5"}
  ]'::jsonb, -2421.74) ->> 'importacao'), false);
-- Uma das linhas de saldo foi ignorada à mão.
update extrato_lancamentos set situacao = 'ignorado', observacao = 'é saldo'
where conta_bancaria_id = current_setting('teste.conta')::uuid and chave = 'id:S4';
-- Linha "SALDO" de PDF fica (a limpeza é só do OFX).
select importar_extrato(current_setting('teste.conta')::uuid, 'pdf', 'itau-novembro.pdf',
  '[{"data": "2026-11-06", "descricao": "SALDO APLIC AUT", "valor": -10}]'::jsonb);

select pg_temp.esperar(
  (select importadas from extrato_importacoes where id = current_setting('teste.ofx')::uuid) = 5,
  'antes da limpeza a importação conta as 5 linhas');

select pg_temp.esperar(excluir_linhas_saldo_extrato() = 3, 'apaga as 3 linhas de saldo do OFX');
select pg_temp.esperar(
  (select array_agg(descricao order by data) from extrato_lancamentos where importacao_id = current_setting('teste.ofx')::uuid)
    = array['PIX RECEBIDO AX CAPI03/11', 'TOTALPASS MENSAL'],
  'ficam só os lançamentos de verdade do OFX');
select pg_temp.esperar(
  (select importadas from extrato_importacoes where id = current_setting('teste.ofx')::uuid) = 3,
  'a contagem da importação desconta as 2 pendentes apagadas (a ignorada já não contava como pendente)');
select pg_temp.esperar(
  exists (select 1 from extrato_lancamentos where descricao = 'SALDO APLIC AUT'),
  'linha de saldo vinda de PDF não é apagada');
select pg_temp.esperar(
  (select saldo_final from extrato_importacoes where id = current_setting('teste.ofx')::uuid) = -2421.74,
  'o saldo final da importação (usado na diferença do fim do extrato) continua');
select pg_temp.esperar(excluir_linhas_saldo_extrato() = 0, 'rodar de novo não apaga nada');
