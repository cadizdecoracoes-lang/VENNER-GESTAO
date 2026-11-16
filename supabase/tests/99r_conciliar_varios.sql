-- Testes da conciliação de vários lançamentos do extrato com vários títulos de
-- uma vez: dois títulos manuais para uma entrada; um título recebido em duas
-- entradas em dias diferentes; desfazer o grupo todo; excluir importação.
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
insert into contas_bancarias (empresa_id, nome) values (current_setting('teste.industria')::uuid, 'Conta Vários');
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Conta Vários';

insert into contas_receber (empresa_id, descricao, categoria_id, valor, vencimento)
select current_setting('teste.industria')::uuid, x.d, (select id from plano_contas where codigo = '1.01'), x.v, x.venc::date
from (values ('VAR manual A', 600, '2026-11-03'), ('VAR manual B', 400, '2026-11-03'),
             ('VAR manual parcelado', 1500, '2026-11-05'), ('VAR outro', 10, '2026-11-05')) as x(d, v, venc);
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento)
values (current_setting('teste.industria')::uuid, 'VAR fornecedor', (select id from plano_contas where codigo = '4.06'), 50, '2026-11-05');

create function pg_temp.linha(chave_banco text) returns uuid language sql as $$
  select id from extrato_lancamentos where chave = 'id:' || chave_banco
$$;
create function pg_temp.receber(d text) returns uuid language sql as $$
  select id from contas_receber where descricao = d
$$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'varios.ofx', '[
  {"data": "2026-11-03", "descricao": "PIX CLIENTE MANUAL", "valor": 1000, "id_banco": "V1"},
  {"data": "2026-11-05", "descricao": "PIX CLIENTE 1a PARTE", "valor": 900, "id_banco": "V2"},
  {"data": "2026-11-07", "descricao": "PIX CLIENTE 2a PARTE", "valor": 600, "id_banco": "V3"},
  {"data": "2026-11-07", "descricao": "PAGAMENTO", "valor": -50, "id_banco": "V4"}
]'::jsonb);

-- Recusas.
select pg_temp.esperar_erro(
  $$select conciliar_lancamentos(array[pg_temp.linha('V2'), pg_temp.linha('V3')], '{}', array[pg_temp.receber('VAR manual A')])$$,
  'somam', 'soma diferente do extrato: recusa');
select pg_temp.esperar_erro(
  $$select conciliar_lancamentos(array[pg_temp.linha('V3'), pg_temp.linha('V4')], '{}', array[pg_temp.receber('VAR manual A')])$$,
  'só entradas ou só saídas', 'entrada e saída juntas: recusa');
select pg_temp.esperar_erro(
  $$select conciliar_lancamentos(array[pg_temp.linha('V2'), pg_temp.linha('V3')],
    array[(select id from contas_pagar where descricao = 'VAR fornecedor')], array[pg_temp.receber('VAR manual parcelado')])$$,
  'só com contas a receber', 'entradas juntas com título a pagar: recusa');

-- Dois títulos manuais para uma entrada (uma linha: mesmo caminho de sempre).
select conciliar_lancamentos(array[pg_temp.linha('V1')], '{}', array[pg_temp.receber('VAR manual A'), pg_temp.receber('VAR manual B')]);
-- Um título recebido em duas entradas em dias diferentes.
select conciliar_lancamentos(array[pg_temp.linha('V2'), pg_temp.linha('V3')], '{}', array[pg_temp.receber('VAR manual parcelado')]);
reset role;

select pg_temp.esperar(
  (select count(*) from extrato_lancamentos where chave in ('id:V1', 'id:V2', 'id:V3') and situacao = 'conciliado') = 3,
  'as três entradas saem da lista de pendentes');
select pg_temp.esperar(
  (select bool_and(situacao = 'pago' and data_recebimento = '2026-11-03' and conta_bancaria_id = current_setting('teste.conta')::uuid)
   from contas_receber where descricao in ('VAR manual A', 'VAR manual B')),
  'os dois títulos manuais baixados na data da entrada');
select pg_temp.esperar(
  (select situacao = 'pago' and valor_recebido = 1500 and data_recebimento = '2026-11-07' from contas_receber where descricao = 'VAR manual parcelado'),
  'título parcelado baixado pelo total, na data da última entrada');
select pg_temp.esperar(
  (select count(*) = 2 and count(distinct grupo) = 1 and sum(valor) = 1500
   from extrato_conciliacoes where conta_receber_id = pg_temp.receber('VAR manual parcelado')),
  'título ligado às duas entradas no mesmo grupo, cada uma com a sua parte');

-- Um título conciliado não entra em outro grupo.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'varios2.ofx', '[
  {"data": "2026-11-08", "descricao": "PIX X", "valor": 1490, "id_banco": "V5"},
  {"data": "2026-11-08", "descricao": "PIX Y", "valor": 20, "id_banco": "V6"}
]'::jsonb);
select pg_temp.esperar_erro(
  $$select conciliar_lancamentos(array[pg_temp.linha('V5'), pg_temp.linha('V6')], '{}',
    array[pg_temp.receber('VAR manual parcelado'), pg_temp.receber('VAR outro')])$$,
  'já está conciliado', 'título já conciliado não entra em outro grupo');
reset role;
select pg_temp.esperar_erro(
  $$insert into extrato_conciliacoes (lancamento_id, conta_receber_id, valor, efeito)
    values (pg_temp.linha('V6'), pg_temp.receber('VAR manual parcelado'), 20, 'vinculou')$$,
  'já está conciliado', 'nem por fora da conciliação em grupo');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';

-- Desfazer uma das linhas desfaz o grupo todo.
select desfazer_conciliacao(pg_temp.linha('V3'));
reset role;
select pg_temp.esperar(
  (select count(*) from extrato_lancamentos where chave in ('id:V2', 'id:V3') and situacao = 'pendente') = 2,
  'desfazer uma linha volta as duas para pendente');
select pg_temp.esperar(
  (select situacao = 'aberto' and valor_recebido is null from contas_receber where descricao = 'VAR manual parcelado'),
  'título volta para em aberto');
select pg_temp.esperar(
  not exists (select 1 from extrato_conciliacoes where conta_receber_id = pg_temp.receber('VAR manual parcelado')),
  'ligações do grupo apagadas');
select pg_temp.esperar(
  (select situacao = 'conciliado' from extrato_lancamentos where chave = 'id:V1'),
  'outra conciliação fica como estava');

-- Grupo com linhas de duas importações: excluir uma devolve a outra para pendente.
-- V3 600 + V5 1490 = parcelado 1500 + outro 590.
update contas_receber set valor = 590 where descricao = 'VAR outro';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select conciliar_lancamentos(array[pg_temp.linha('V3'), pg_temp.linha('V5')], '{}',
  array[pg_temp.receber('VAR manual parcelado'), pg_temp.receber('VAR outro')]);
reset role;
select pg_temp.esperar(
  (select count(distinct lancamento_id) = 2 from extrato_conciliacoes where conta_receber_id = pg_temp.receber('VAR manual parcelado')),
  'título repartido entre linhas de duas importações');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select excluir_importacao_extrato((select id from extrato_importacoes where arquivo = 'varios2.ofx'));
reset role;
select pg_temp.esperar(
  (select situacao = 'pendente' from extrato_lancamentos where chave = 'id:V3'),
  'linha da outra importação volta para pendente');
select pg_temp.esperar(
  (select bool_and(situacao = 'aberto') from contas_receber where descricao in ('VAR manual parcelado', 'VAR outro')),
  'títulos do grupo voltam para em aberto');
