-- Testes da conciliação de antecipação (factoring): entrada líquida = título
-- a receber menos os juros a pagar.
\set ON_ERROR_STOP 1
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
select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Itaú Junta';

insert into contas_receber (empresa_id, descricao, categoria_id, valor, vencimento)
values (current_setting('teste.industria')::uuid, 'NF 442 AKL', (select id from plano_contas where codigo = '1.01'), 21400.33, '2026-11-30');
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento)
values (current_setting('teste.industria')::uuid, 'Juros antecipação NF 442 AKL', (select id from plano_contas where codigo = '4.06'), 1573.43, '2026-10-21');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'antecipacao.ofx',
  '[{"data": "2026-10-21", "descricao": "Pix recebido de SMART CAPITAL SECURITIZADORA", "valor": 19826.90, "id_banco": "F1"}]'::jsonb);
select set_config('teste.linha', id::text, false) from extrato_lancamentos where chave = 'id:F1';

select pg_temp.esperar_erro(
  $$select conciliar_lancamento(current_setting('teste.linha')::uuid,
    array[(select id from contas_pagar where descricao = 'Juros antecipação NF 442 AKL')], '{}')$$,
  'contas a receber', 'entrada só com título a pagar: recusa');
select pg_temp.esperar_erro(
  $$select conciliar_lancamento(current_setting('teste.linha')::uuid,
    array[(select id from contas_pagar where descricao = 'Juros antecipação NF 442 AKL')],
    array[(select id from contas_receber where descricao = 'NF 442 AKL'), (select id from contas_receber where descricao = 'CONC venda 1')])$$,
  'somam', 'soma com sinal diferente do extrato: recusa');

select conciliar_lancamento(current_setting('teste.linha')::uuid,
  array[(select id from contas_pagar where descricao = 'Juros antecipação NF 442 AKL')],
  array[(select id from contas_receber where descricao = 'NF 442 AKL')]);
reset role;

select pg_temp.esperar(
  (select situacao = 'conciliado' from extrato_lancamentos where id = current_setting('teste.linha')::uuid),
  'linha conciliada com receber menos juros');
select pg_temp.esperar(
  (select situacao = 'pago' and valor_recebido = 21400.33 and data_recebimento = '2026-10-21' from contas_receber where descricao = 'NF 442 AKL'),
  'título a receber baixado pelo valor cheio');
select pg_temp.esperar(
  (select situacao = 'pago' and valor_pago = 1573.43 and conta_bancaria_id = current_setting('teste.conta')::uuid
   from contas_pagar where descricao = 'Juros antecipação NF 442 AKL'),
  'juros da antecipação baixados na mesma conta');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select desfazer_conciliacao(current_setting('teste.linha')::uuid);
reset role;
select pg_temp.esperar(
  (select situacao = 'aberto' from contas_receber where descricao = 'NF 442 AKL')
  and (select situacao = 'aberto' from contas_pagar where descricao = 'Juros antecipação NF 442 AKL'),
  'desfazer reabre os dois títulos');
