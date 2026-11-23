-- Testes da migração 20261123000071: juntar a mesma conta cadastrada duas
-- vezes no Tiny (como "Itaú" e "Banco Itaú"), com o mesmo extrato importado
-- e conciliado em partes diferentes nas duas.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

select set_config('teste.emp', id::text, false) from empresas where cnpj = '11111111000111';
insert into contas_bancarias (empresa_id, nome, tiny_id) values
  (current_setting('teste.emp')::uuid, 'Banco Itaú JT', 5550001),
  (current_setting('teste.emp')::uuid, 'Itaú JT', 5550002);
select set_config('teste.certa', id::text, false) from contas_bancarias where tiny_id = 5550001;
select set_config('teste.errada', id::text, false) from contas_bancarias where tiny_id = 5550002;

-- Títulos baixados na conta errada: um do Tiny, um lançado só aqui.
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id, tiny_id)
values
  (current_setting('teste.emp')::uuid, 'JT do Tiny', (select id from plano_contas where codigo = '4.06'), 50, '2027-03-02', 'pago', '2027-03-02', 50, current_setting('teste.errada')::uuid, 7770001),
  (current_setting('teste.emp')::uuid, 'JT daqui', (select id from plano_contas where codigo = '4.06'), 30, '2027-03-03', 'pago', '2027-03-03', 30, current_setting('teste.errada')::uuid, null),
  (current_setting('teste.emp')::uuid, 'JT certa', (select id from plano_contas where codigo = '4.06'), 20, '2027-03-04', 'pago', '2027-03-04', 20, current_setting('teste.certa')::uuid, 7770002);

-- O mesmo OFX nas duas contas (mesmas chaves) e uma linha só na errada.
select importar_extrato(current_setting('teste.certa')::uuid, 'ofx', 'itau.ofx',
  '[{"data": "2027-03-02", "descricao": "PIX A", "valor": -50, "id_banco": "JT1"},
    {"data": "2027-03-04", "descricao": "PIX C", "valor": -20, "id_banco": "JT3"},
    {"data": "2027-03-05", "descricao": "TED D", "valor": 70, "id_banco": "JT4"}]'::jsonb);
select importar_extrato(current_setting('teste.errada')::uuid, 'ofx', 'itau.ofx',
  '[{"data": "2027-03-01", "descricao": "SÓ NA ERRADA", "valor": -9, "id_banco": "JT0"},
    {"data": "2027-03-02", "descricao": "PIX A", "valor": -50, "id_banco": "JT1"},
    {"data": "2027-03-04", "descricao": "PIX C", "valor": -20, "id_banco": "JT3"},
    {"data": "2027-03-05", "descricao": "TED D", "valor": 70, "id_banco": "JT4"}]'::jsonb);

-- PIX A conciliado só na errada; PIX C conciliado só na certa; TED D pendente nas duas.
insert into extrato_conciliacoes (lancamento_id, conta_pagar_id, valor, efeito)
select l.id, p.id, 50, 'vinculou' from extrato_lancamentos l, contas_pagar p
where l.conta_bancaria_id = current_setting('teste.errada')::uuid and l.chave = 'id:JT1' and p.descricao = 'JT do Tiny';
update extrato_lancamentos set situacao = 'conciliado' where conta_bancaria_id = current_setting('teste.errada')::uuid and chave = 'id:JT1';
insert into extrato_conciliacoes (lancamento_id, conta_pagar_id, valor, efeito)
select l.id, p.id, 20, 'vinculou' from extrato_lancamentos l, contas_pagar p
where l.conta_bancaria_id = current_setting('teste.certa')::uuid and l.chave = 'id:JT3' and p.descricao = 'JT certa';
update extrato_lancamentos set situacao = 'conciliado' where conta_bancaria_id = current_setting('teste.certa')::uuid and chave = 'id:JT3';

-- Quem pode excluir conta bancária junta as duas do Tiny.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select set_config('teste.r', juntar_contas_bancarias(current_setting('teste.errada')::uuid, current_setting('teste.certa')::uuid)::text, false);
reset role;

select pg_temp.esperar((current_setting('teste.r')::jsonb ->> 'inativada')::boolean, 'duas contas do Tiny se juntam');
select pg_temp.esperar(
  (select not ativa and tiny_id = 5550002 and nome = 'Itaú JT (juntada em Banco Itaú JT)' from contas_bancarias where id = current_setting('teste.errada')::uuid),
  'a conta errada fica inativa, com o número do Tiny (a leitura do Tiny não recria) e o nome dizendo onde foi juntada');
select pg_temp.esperar(
  (select conta_bancaria_id = current_setting('teste.errada')::uuid from contas_pagar where descricao = 'JT do Tiny'),
  'título do Tiny não muda de conta (o Tiny vale)');
select pg_temp.esperar(
  (select conta_bancaria_id = current_setting('teste.certa')::uuid from contas_pagar where descricao = 'JT daqui'),
  'título lançado só aqui passa para a conta certa');
select pg_temp.esperar(
  (select count(*) = 0 from extrato_lancamentos where conta_bancaria_id = current_setting('teste.errada')::uuid)
  and (select count(*) = 4 from extrato_lancamentos where conta_bancaria_id = current_setting('teste.certa')::uuid),
  'extrato todo na conta certa, cada linha do banco uma vez só (4 linhas)');
select pg_temp.esperar(
  (select situacao = 'conciliado' and exists (select 1 from extrato_conciliacoes c join contas_pagar p on p.id = c.conta_pagar_id
                                              where c.lancamento_id = l.id and p.descricao = 'JT do Tiny')
   from extrato_lancamentos l where conta_bancaria_id = current_setting('teste.certa')::uuid and chave = 'id:JT1'),
  'a conciliação feita na conta errada vem junto');
select pg_temp.esperar(
  (select situacao = 'conciliado' from extrato_lancamentos where conta_bancaria_id = current_setting('teste.certa')::uuid and chave = 'id:JT3'),
  'a conciliação da conta certa continua');
select pg_temp.esperar(
  (select count(*) filter (where situacao = 'pendente') = 2 from extrato_lancamentos where conta_bancaria_id = current_setting('teste.certa')::uuid),
  'pendentes: a linha só da errada e o TED (uma vez)');
select pg_temp.esperar(
  (select count(*) = 2 from extrato_importacoes where conta_bancaria_id = current_setting('teste.certa')::uuid),
  'as duas importações ficam na conta certa');
