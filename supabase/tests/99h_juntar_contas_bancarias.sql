-- Testes de juntar duas contas bancárias (a mesma conta cadastrada duas vezes):
-- uso por conta, permissão, títulos e extrato passam para a conta certa, o
-- número do Tiny vai junto e a conta errada some.
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
select set_config('teste.comercio', id::text, false) from empresas where cnpj = '22222222000122';

-- A conta certa (cadastrada à mão) e a errada (veio do Tiny), na mesma empresa.
insert into contas_bancarias (empresa_id, nome, saldo_inicial) values (current_setting('teste.industria')::uuid, 'Itaú Junta', 500);
insert into contas_bancarias (empresa_id, nome, tiny_id) values (current_setting('teste.industria')::uuid, 'Itau junta (Tiny)', 987654);
insert into contas_bancarias (empresa_id, nome) values (current_setting('teste.comercio')::uuid, 'Itaú do comércio');
select set_config('teste.certa', id::text, false) from contas_bancarias where nome = 'Itaú Junta';
select set_config('teste.errada', id::text, false) from contas_bancarias where nome = 'Itau junta (Tiny)';
select set_config('teste.outra', id::text, false) from contas_bancarias where nome = 'Itaú do comércio';

insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id)
values (current_setting('teste.industria')::uuid, 'Pago na conta errada', (select id from plano_contas where codigo = '4.06'), 90, '2026-12-10',
  'pago', '2026-12-10', 90, current_setting('teste.errada')::uuid);

-- Extrato: o mesmo arquivo importado nas duas contas (mesma chave), mais uma linha só na errada.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_extrato(current_setting('teste.certa')::uuid, 'ofx', 'certa.ofx',
  '[{"data": "2026-12-11", "descricao": "PIX", "valor": -90, "id_banco": "J1"}]'::jsonb);
select importar_extrato(current_setting('teste.errada')::uuid, 'ofx', 'errada.ofx',
  '[{"data": "2026-12-11", "descricao": "PIX", "valor": -90, "id_banco": "J1"},
    {"data": "2026-12-12", "descricao": "TARIFA", "valor": -3, "id_banco": "J2"}]'::jsonb);

select pg_temp.esperar(
  (select titulos = 1 and extrato = 2 and importacoes = 1 from uso_contas_bancarias(current_setting('teste.industria')::uuid)
   where conta_bancaria_id = current_setting('teste.errada')::uuid),
  'uso mostra o que a conta errada tem');
reset role;

-- Financeiro (sem "excluir" em contas bancárias) não junta.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar_erro(
  $$select juntar_contas_bancarias(current_setting('teste.errada')::uuid, current_setting('teste.certa')::uuid)$$,
  'não pode excluir', 'sem permissão de excluir não junta');
reset role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar_erro(
  $$select juntar_contas_bancarias(current_setting('teste.errada')::uuid, current_setting('teste.outra')::uuid)$$,
  'mesma empresa', 'não junta contas de empresas diferentes');
select pg_temp.esperar_erro(
  $$select juntar_contas_bancarias(current_setting('teste.certa')::uuid, current_setting('teste.certa')::uuid)$$,
  'outra conta', 'não junta a conta com ela mesma');

select set_config('teste.r', juntar_contas_bancarias(current_setting('teste.errada')::uuid, current_setting('teste.certa')::uuid)::text, false);
select pg_temp.esperar(
  (current_setting('teste.r')::jsonb ->> 'pagar')::int = 1 and (current_setting('teste.r')::jsonb ->> 'extrato')::int = 2
  and (current_setting('teste.r')::jsonb ->> 'importacoes')::int = 1,
  'junta: 1 título, 2 linhas e 1 importação mudam de conta');
reset role;

select pg_temp.esperar(not exists (select 1 from contas_bancarias where id = current_setting('teste.errada')::uuid), 'conta errada apagada');
select pg_temp.esperar(
  (select tiny_id = 987654 and saldo_inicial = 500 from contas_bancarias where id = current_setting('teste.certa')::uuid),
  'conta certa fica com o número do Tiny e o próprio saldo inicial');
select pg_temp.esperar(
  (select conta_bancaria_id = current_setting('teste.certa')::uuid from contas_pagar where descricao = 'Pago na conta errada'),
  'título pago passa para a conta certa');
select pg_temp.esperar(
  exists (select 1 from contas_pagar_historico h join contas_pagar p on p.id = h.conta_id
          where p.descricao = 'Pago na conta errada' and h.mudancas ? 'Conta bancária'),
  'mudança de conta fica no histórico do título');
select pg_temp.esperar(
  (select count(*) filter (where situacao = 'pendente') = 2 and count(*) = 3
   from extrato_lancamentos where conta_bancaria_id = current_setting('teste.certa')::uuid),
  'extrato na conta certa: o PIX repetido sai da lista, a tarifa entra');

-- Duas contas do Tiny não se juntam.
insert into contas_bancarias (empresa_id, nome, tiny_id) values (current_setting('teste.industria')::uuid, 'Outra do Tiny', 111222);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar_erro(
  $$select juntar_contas_bancarias((select id from contas_bancarias where nome = 'Outra do Tiny'), current_setting('teste.certa')::uuid)$$,
  'vieram do Tiny', 'duas contas do Tiny: recusa');
reset role;
