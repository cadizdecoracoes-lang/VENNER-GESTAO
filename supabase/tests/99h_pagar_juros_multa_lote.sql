-- Testes de juros, multa e desconto no pagamento e do grupo de lançamentos
-- (parcelado/recorrente) das contas a pagar.
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
select set_config('teste.banco', id::text, false) from contas_bancarias where nome = 'Itaú movimento';

-- Diretoria lança uma conta parcelada (mesmo grupo) e paga a 1ª com juros e multa.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into contas_pagar (empresa_id, descricao, parcela, valor, vencimento, grupo_id)
select current_setting('teste.industria')::uuid, 'Máquina parcelada', p, 500, v, '11111111-2222-3333-4444-555555555555'
from (values ('1/2', date '2026-11-10'), ('2/2', date '2026-12-10')) x(p, v);
select pg_temp.esperar(
  (select count(*) = 2 from contas_pagar where grupo_id = '11111111-2222-3333-4444-555555555555'),
  'parcelas lançadas juntas ficam no mesmo grupo');

update contas_pagar set situacao = 'pago', data_pagamento = '2026-11-12', conta_bancaria_id = current_setting('teste.banco')::uuid,
  valor_pago = 515, juros = 5, multa = 10, desconto = 0
where descricao = 'Máquina parcelada' and parcela = '1/2';
select pg_temp.esperar(
  (select juros = 5 and multa = 10 and valor_pago = 515 from contas_pagar where descricao = 'Máquina parcelada' and parcela = '1/2'),
  'pagamento guarda juros e multa separados do principal');
select pg_temp.esperar(
  (select h.mudancas -> 'Juros' = '[null, "5,00"]'::jsonb and h.mudancas -> 'Multa' = '[null, "10,00"]'::jsonb
   from contas_pagar p join contas_pagar_historico h on h.conta_id = p.id and h.evento = 'alterada'
   where p.descricao = 'Máquina parcelada' and p.parcela = '1/2'),
  'histórico mostra juros e multa');

select pg_temp.esperar_erro(
  $$update contas_pagar set juros = -1 where descricao = 'Máquina parcelada' and parcela = '1/2'$$,
  'check', 'juros não pode ser negativo');

-- Estorno: juros, multa e desconto somem junto com o pagamento.
update contas_pagar set situacao = 'aberto', data_pagamento = null, conta_bancaria_id = null, valor_pago = null
where descricao = 'Máquina parcelada' and parcela = '1/2';
select pg_temp.esperar(
  (select juros is null and multa is null and desconto is null from contas_pagar where descricao = 'Máquina parcelada' and parcela = '1/2'),
  'conta reaberta não guarda juros nem multa');

-- Conta em aberto não aceita juros (só valem no pagamento).
update contas_pagar set juros = 3 where descricao = 'Máquina parcelada' and parcela = '2/2';
select pg_temp.esperar(
  (select juros is null from contas_pagar where descricao = 'Máquina parcelada' and parcela = '2/2'),
  'juros em conta aberta é descartado');

reset role;
delete from contas_pagar where descricao = 'Máquina parcelada';
