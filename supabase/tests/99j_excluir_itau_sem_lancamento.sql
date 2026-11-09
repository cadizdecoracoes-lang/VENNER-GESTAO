-- Teste da limpeza do Itaú repetido: apaga só a conta Itaú sem lançamento,
-- leva o número do Tiny para a que fica e não mexe nas outras.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

select set_config('teste.comercio', id::text, false) from empresas where cnpj = '22222222000122';
-- Comércio: "Itaú do comércio" (do teste 99h, sem lançamento) + uma Itau vinda do Tiny, também vazia,
-- + uma Itau com um título pago.
insert into contas_bancarias (empresa_id, nome, tiny_id) values (current_setting('teste.comercio')::uuid, 'ITAU (Tiny)', 555666);
insert into contas_bancarias (empresa_id, nome) values (current_setting('teste.comercio')::uuid, 'Itau usada');
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id)
values (current_setting('teste.comercio')::uuid, 'Pago no Itau', (select id from plano_contas where codigo = '4.06'), 10, '2026-12-01',
  'pago', '2026-12-01', 10, (select id from contas_bancarias where nome = 'Itau usada'));
select set_config('teste.antes', count(*)::text, false) from contas_bancarias where empresa_id <> current_setting('teste.comercio')::uuid;

select set_config('teste.n', excluir_itau_sem_lancamento()::text, false);
select pg_temp.esperar(current_setting('teste.n')::int >= 2, 'apaga as Itaú vazias');
select pg_temp.esperar(
  (select array_agg(nome order by nome) from contas_bancarias where empresa_id = current_setting('teste.comercio')::uuid
     and (lower(nome) like '%ita%')) = array['Itau usada'],
  'no comércio fica só a Itaú com lançamento');
select pg_temp.esperar(
  (select tiny_id = 555666 from contas_bancarias where nome = 'Itau usada'),
  'o número do Tiny passa para a que fica');
select pg_temp.esperar(
  exists (select 1 from contas_bancarias where nome = 'Itaú Junta'),
  'na indústria, a Itaú com lançamento continua');
select pg_temp.esperar(excluir_itau_sem_lancamento() = 0, 'rodar de novo não apaga nada');
