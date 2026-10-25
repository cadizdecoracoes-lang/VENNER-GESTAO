-- Testes da conciliação bancária (importar extrato sem repetir, conciliar com
-- títulos, lançar tarifa, transferência, desfazer) e do fluxo de caixa
-- (movimentos por natureza e saldo das contas).
-- financeiro@teste: perfil Financeiro, só o CNPJ 11111111000111.
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

update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Financeiro') where email = 'financeiro@teste';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000011', 'contabil@teste');
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Contabilidade') where email = 'contabil@teste';
insert into usuario_empresas (usuario_id, empresa_id)
select '00000000-0000-0000-0000-000000000011', id from empresas where cnpj = '11111111000111';

select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.comercio', id::text, false) from empresas where cnpj = '22222222000122';
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Itaú movimento';
select set_config('teste.inter', id::text, false) from contas_bancarias where nome = 'Inter';
-- Saldo inicial conhecido: R$ 1.000,00 no começo de 01/10/2026.
update contas_bancarias set saldo_inicial = 1000, data_saldo_inicial = '2026-10-01' where nome = 'Itaú movimento';

-- Títulos de teste da indústria.
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento)
select current_setting('teste.industria')::uuid, x.d, (select id from plano_contas where codigo = '4.06'), x.v, x.venc::date
from (values ('CONC energia', 300, '2026-10-05'), ('CONC boleto A', 100, '2026-10-06'), ('CONC boleto B', 50, '2026-10-06'),
             ('CONC aluguel futuro', 2000, '2099-01-10')) as x(d, v, venc);
insert into contas_receber (empresa_id, descricao, categoria_id, valor, vencimento)
values (current_setting('teste.industria')::uuid, 'CONC venda 1', (select id from plano_contas where codigo = '1.01'), 500, '2026-10-07');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';

create function pg_temp.extrato() returns jsonb language sql as $$
  select '[
    {"data": "2026-10-05", "descricao": "PAGTO ENERGIA", "valor": -305.10, "saldo": 694.90},
    {"data": "2026-10-06", "descricao": "PIX ENVIADO", "valor": -150},
    {"data": "2026-10-06", "descricao": "TARIFA PIX", "valor": -1.5},
    {"data": "2026-10-06", "descricao": "TARIFA PIX", "valor": -1.5},
    {"data": "2026-10-07", "descricao": "TED RECEBIDA", "valor": 500, "id_banco": "X1"},
    {"data": "2026-10-08", "descricao": "TRANSF CONTA INTER", "valor": -200},
    {"data": "2026-10-08", "descricao": "ESTORNO", "valor": 0}
  ]'::jsonb
$$;

-- Importação sem repetir.
select pg_temp.esperar(
  (importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'itau.ofx', pg_temp.extrato(), 340.40) - 'importacao')
    = '{"importadas": 6, "repetidas": 0}',
  'extrato importado (linha zerada fica de fora)');
select pg_temp.esperar(
  (importar_extrato(current_setting('teste.conta')::uuid, 'planilha', 'itau.xlsx', pg_temp.extrato()) - 'importacao')
    = '{"importadas": 0, "repetidas": 6}',
  'o mesmo extrato não entra duas vezes (duas tarifas iguais contam como duas)');
select pg_temp.esperar(
  (select periodo_de || '|' || periodo_ate || '|' || saldo_final from extrato_importacoes where arquivo = 'itau.ofx')
    = '2026-10-05|2026-10-08|340.40',
  'importação guarda período e saldo final do banco');
select pg_temp.esperar_erro(
  $$select importar_extrato(current_setting('teste.inter')::uuid, 'ofx', 'x.ofx', '[{"data": "2026-10-01", "descricao": "x", "valor": 1}]')$$,
  'não encontrada', 'financeiro não importa extrato de conta de outro CNPJ');

create function pg_temp.linha(descricao text) returns uuid language sql as $$
  select id from extrato_lancamentos where extrato_lancamentos.descricao = linha.descricao order by chave limit 1
$$;
create function pg_temp.pagar(descricao text) returns uuid language sql as $$
  select id from contas_pagar where contas_pagar.descricao = pagar.descricao
$$;

-- Conciliação com um título: a baixa usa a data, a conta e o valor do extrato (juros).
select conciliar_lancamento(pg_temp.linha('PAGTO ENERGIA'), array[pg_temp.pagar('CONC energia')]);
select pg_temp.esperar(
  (select situacao || '|' || data_pagamento || '|' || valor_pago from contas_pagar where descricao = 'CONC energia') = 'pago|2026-10-05|305.10',
  'título em aberto é baixado pelo extrato, com os juros');
select pg_temp.esperar((select situacao from extrato_lancamentos where descricao = 'PAGTO ENERGIA') = 'conciliado', 'linha conciliada');
select pg_temp.esperar_erro(
  $$select conciliar_lancamento(pg_temp.linha('PAGTO ENERGIA'), array[pg_temp.pagar('CONC boleto A')])$$,
  'já foi resolvido', 'linha conciliada não concilia de novo');

-- Um PIX pagando dois boletos: a soma precisa bater.
select pg_temp.esperar_erro(
  $$select conciliar_lancamento(pg_temp.linha('PIX ENVIADO'), array[pg_temp.pagar('CONC boleto A'), pg_temp.pagar('CONC aluguel futuro')])$$,
  'somam', 'soma dos títulos diferente do extrato é barrada');
select conciliar_lancamento(pg_temp.linha('PIX ENVIADO'), array[pg_temp.pagar('CONC boleto A'), pg_temp.pagar('CONC boleto B')]);
select pg_temp.esperar(
  (select string_agg(valor_pago::text, ',' order by descricao) from contas_pagar where descricao in ('CONC boleto A', 'CONC boleto B')) = '100.00,50.00',
  'cada boleto baixado pelo próprio valor');
select pg_temp.esperar_erro(
  $$select conciliar_lancamento(pg_temp.linha('TED RECEBIDA'), array[pg_temp.pagar('CONC aluguel futuro')])$$,
  'contas a receber', 'entrada não se concilia com conta a pagar');

-- Tarifa sem título: a conciliação não lança; o título é criado no contas a pagar e depois conciliado.
select pg_temp.esperar(
  not exists (select 1 from pg_proc where proname = 'lancar_do_extrato'), 'conciliação não cria lançamentos');
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento)
values (current_setting('teste.industria')::uuid, 'Tarifa PIX', (select id from plano_contas where codigo = '5.01'), 1.5, '2026-10-06');
select conciliar_lancamento(pg_temp.linha('TARIFA PIX'), array[pg_temp.pagar('Tarifa PIX')]);
select pg_temp.esperar(
  (select count(*) from contas_pagar where descricao = 'Tarifa PIX' and situacao = 'pago' and valor_pago = 1.5 and data_pagamento = '2026-10-06') = 1,
  'tarifa lançada no contas a pagar é baixada pela conciliação');

-- Recebimento e transferência.
select conciliar_lancamento(pg_temp.linha('TED RECEBIDA'), '{}', array[(select id from contas_receber where descricao = 'CONC venda 1')]);
select marcar_lancamento(pg_temp.linha('TRANSF CONTA INTER'), 'transferencia');
select pg_temp.esperar_erro(
  $$select marcar_lancamento((select id from extrato_lancamentos where descricao = 'TARIFA PIX' and situacao = 'pendente'), 'ignorado')$$,
  'motivo', 'ignorar exige o motivo');

-- Estornar no contas a pagar solta a linha do extrato.
update contas_pagar set situacao = 'aberto', data_pagamento = null, valor_pago = null, conta_bancaria_id = null
where descricao = 'CONC energia';
select pg_temp.esperar(
  (select situacao from extrato_lancamentos where descricao = 'PAGTO ENERGIA') = 'pendente'
  and not exists (select 1 from extrato_conciliacoes c join extrato_lancamentos l on l.id = c.lancamento_id where l.descricao = 'PAGTO ENERGIA'),
  'estorno do título volta a linha do extrato para pendente');
select conciliar_lancamento(pg_temp.linha('PAGTO ENERGIA'), array[pg_temp.pagar('CONC energia')]);

-- Desfazer: baixa volta para em aberto.
select desfazer_conciliacao(pg_temp.linha('PIX ENVIADO'));
select pg_temp.esperar(
  (select string_agg(situacao::text, ',') from contas_pagar where descricao in ('CONC boleto A', 'CONC boleto B')) = 'aberto,aberto'
  and (select situacao from extrato_lancamentos where descricao = 'PIX ENVIADO') = 'pendente',
  'desfazer devolve os boletos para em aberto');

-- Fluxo de caixa: realizado, previsto, atrasado e transferência.
select pg_temp.esperar(
  (select string_agg(tipo || ':' || natureza || ':' || valor, ',' order by tipo, natureza, valor)
   from fluxo_caixa('2026-10-01', '2026-10-31', current_setting('teste.industria')::uuid) f
   where f.data between '2026-10-05' and '2026-10-08' and natureza <> 'atrasado')
    = 'entrada:realizado:500.00,saida:realizado:1.50,saida:realizado:305.10,saida:transferencia:200.00',
  'fluxo mostra o realizado pela data do pagamento e a transferência');
select pg_temp.esperar(
  (select count(*) from fluxo_caixa('2099-01-01', '2099-01-31') where natureza = 'previsto' and valor = 2000) = 1,
  'título em aberto entra como previsto no vencimento');
select pg_temp.esperar(
  (select saldo from fluxo_caixa_saldos('2026-10-09', current_setting('teste.industria')::uuid) where nome = 'Itaú movimento') = 993.40,
  'saldo da conta: 1000 − 305,10 − 1,50 + 500 − 200');
select pg_temp.esperar(
  not exists (select 1 from fluxo_caixa_saldos('2026-10-09') where empresa_id <> current_setting('teste.industria')::uuid),
  'financeiro não vê saldo de conta de outro CNPJ');

-- Previsão manual por empresa.
insert into fluxo_previsoes (empresa_id, data, tipo, valor) values (current_setting('teste.industria')::uuid, '2099-01-15', 'entrada', 800);
select pg_temp.esperar(
  (select count(*) from fluxo_caixa('2099-01-01', '2099-01-31') where natureza = 'manual' and valor = 800) = 1,
  'previsão digitada entra no fluxo');
select pg_temp.esperar_erro(
  $$insert into fluxo_previsoes (empresa_id, data, tipo, valor) values (current_setting('teste.comercio')::uuid, '2099-01-15', 'entrada', 1)$$,
  'row-level security', 'previsão só em CNPJ liberado');
reset role;

-- Contabilidade: consulta a conciliação, mas não concilia.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
select pg_temp.esperar((select count(*) from extrato_lancamentos) = 6, 'contabilidade vê o extrato');
select pg_temp.esperar(
  (select count(*) from contas_bancarias where empresa_id <> current_setting('teste.industria')::uuid) = 0
  and (select count(*) from contas_bancarias) > 0,
  'contabilidade vê as contas do CNPJ para a conciliação');
select pg_temp.esperar_erro(
  $$select desfazer_conciliacao(pg_temp.linha('PAGTO ENERGIA'))$$, 'não pode conciliar', 'contabilidade não desfaz conciliação');
reset role;
