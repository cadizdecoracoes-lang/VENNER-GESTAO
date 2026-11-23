-- Testes da migração 20261123000072: na junção de contas, o título lançado
-- só aqui que estava ligado à cópia repetida do extrato é cancelado (como o
-- "Lançar transferência" feito nas duas contas do Itaú).
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

select set_config('teste.emp', id::text, false) from empresas where cnpj = '11111111000111';
insert into contas_bancarias (empresa_id, nome, tiny_id) values
  (current_setting('teste.emp')::uuid, 'Certa TR', 6660001),
  (current_setting('teste.emp')::uuid, 'Errada TR', 6660002);
select set_config('teste.certa', id::text, false) from contas_bancarias where tiny_id = 6660001;
select set_config('teste.errada', id::text, false) from contas_bancarias where tiny_id = 6660002;

select importar_extrato(current_setting('teste.certa')::uuid, 'ofx', 'tr.ofx', '[{"data": "2027-04-02", "descricao": "PIX ASHI", "valor": -80, "id_banco": "TR1"}]'::jsonb);
select importar_extrato(current_setting('teste.errada')::uuid, 'ofx', 'tr.ofx', '[{"data": "2027-04-02", "descricao": "PIX ASHI", "valor": -80, "id_banco": "TR1"}]'::jsonb);

-- Cada cópia virou um título de transferência lançado aqui.
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id)
values
  (current_setting('teste.emp')::uuid, 'TR certa', (select id from plano_contas where codigo = '4.06'), 80, '2027-04-02', 'pago', '2027-04-02', 80, current_setting('teste.certa')::uuid),
  (current_setting('teste.emp')::uuid, 'TR errada', (select id from plano_contas where codigo = '4.06'), 80, '2027-04-02', 'pago', '2027-04-02', 80, current_setting('teste.errada')::uuid);
insert into extrato_conciliacoes (lancamento_id, conta_pagar_id, valor, efeito)
select l.id, p.id, 80, 'vinculou' from extrato_lancamentos l, contas_pagar p
where l.chave = 'id:TR1' and ((l.conta_bancaria_id = current_setting('teste.certa')::uuid and p.descricao = 'TR certa')
   or (l.conta_bancaria_id = current_setting('teste.errada')::uuid and p.descricao = 'TR errada'));
update extrato_lancamentos set situacao = 'conciliado' where chave = 'id:TR1';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select set_config('teste.r', juntar_contas_bancarias(current_setting('teste.errada')::uuid, current_setting('teste.certa')::uuid)::text, false);
reset role;

select pg_temp.esperar((current_setting('teste.r')::jsonb ->> 'titulos_cancelados')::int = 1, 'um título repetido cancelado');
select pg_temp.esperar((select situacao = 'cancelado' and observacao like 'Repetido%' from contas_pagar where descricao = 'TR errada'),
  'o título da cópia que saiu fica cancelado (não dobra o fluxo)');
select pg_temp.esperar(
  (select p.situacao = 'pago' and exists (select 1 from extrato_conciliacoes c where c.conta_pagar_id = p.id) from contas_pagar p where p.descricao = 'TR certa'),
  'o título da linha que fica continua pago e conciliado');
