-- Testes da transferência que vira título: saída no contas a pagar e entrada
-- no contas a receber, já baixadas e conciliadas; marcar sem título é
-- recusado; desfazer cancela o título.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

create function pg_temp.esperar_erro(comando text, trecho text, mensagem text) returns void language plpgsql as $$
begin
  execute comando;
  raise exception 'FALHOU: %', mensagem;
exception when others then
  if sqlerrm like 'FALHOU%' or sqlerrm not like '%' || trecho || '%' then raise; end if;
  raise notice 'ok: %', mensagem;
end $$;

select pg_temp.esperar(
  public.categoria_transferencia('despesa') is not null and public.categoria_transferencia('receita') is not null,
  'categorias de transferência existem (despesa e receita)');

select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
insert into contas_bancarias (empresa_id, nome) values (current_setting('teste.industria')::uuid, 'Conta transf A');
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Conta transf A';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'transf.ofx',
  '[{"data": "2026-12-20", "descricao": "TRANSF PARA CONTA B", "valor": -300, "id_banco": "T1"},
    {"data": "2026-12-21", "descricao": "TRANSF DA CONTA B", "valor": 120, "id_banco": "T2"}]'::jsonb);
select set_config('teste.saida', id::text, false) from extrato_lancamentos where chave = 'id:T1';
select set_config('teste.entrada', id::text, false) from extrato_lancamentos where chave = 'id:T2';

select pg_temp.esperar_erro(
  $$select marcar_lancamento(current_setting('teste.saida')::uuid, 'transferencia')$$,
  'vira título', 'marcar como transferência sem título: recusa');

select lancar_transferencia(current_setting('teste.saida')::uuid);
select lancar_transferencia(current_setting('teste.entrada')::uuid);
reset role;

select pg_temp.esperar(
  (select situacao = 'pago' and valor_pago = 300 and data_pagamento = '2026-12-20' and conta_bancaria_id = current_setting('teste.conta')::uuid
     and categoria_id = public.categoria_transferencia('despesa')
   from contas_pagar where descricao = 'Transferência entre contas · TRANSF PARA CONTA B'),
  'saída vira título pago no contas a pagar, nesta conta e na data do extrato');
select pg_temp.esperar(
  (select situacao = 'pago' and valor_recebido = 120 and data_recebimento = '2026-12-21' and categoria_id = public.categoria_transferencia('receita')
   from contas_receber where descricao = 'Transferência entre contas · TRANSF DA CONTA B'),
  'entrada vira título recebido no contas a receber');
select pg_temp.esperar(
  (select count(*) = 2 from extrato_lancamentos
   where id in (current_setting('teste.saida')::uuid, current_setting('teste.entrada')::uuid) and situacao = 'conciliado'),
  'as duas linhas ficam conciliadas com os títulos');

-- Linha marcada como transferência antes da regra também vira título.
update extrato_lancamentos set situacao = 'transferencia' where id = current_setting('teste.entrada')::uuid;
delete from extrato_conciliacoes where lancamento_id = current_setting('teste.entrada')::uuid;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select lancar_transferencia(current_setting('teste.entrada')::uuid);
select pg_temp.esperar_erro(
  $$select lancar_transferencia(current_setting('teste.entrada')::uuid)$$,
  'já foi conciliado', 'linha já conciliada: recusa');

-- Desfazer cancela o título da transferência (não fica em aberto).
select desfazer_conciliacao(current_setting('teste.saida')::uuid);
reset role;
select pg_temp.esperar(
  (select situacao = 'cancelado' from contas_pagar where descricao = 'Transferência entre contas · TRANSF PARA CONTA B'),
  'desfazer cancela o título da transferência');
select pg_temp.esperar(
  (select situacao = 'pendente' from extrato_lancamentos where id = current_setting('teste.saida')::uuid),
  'a linha volta para pendente');

-- Sem permissão de conciliar, não lança.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar_erro(
  $$select lancar_transferencia(current_setting('teste.saida')::uuid)$$,
  'não pode conciliar', 'sem permissão: recusa');
reset role;
