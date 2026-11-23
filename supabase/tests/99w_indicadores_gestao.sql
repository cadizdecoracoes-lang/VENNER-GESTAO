-- Testes dos indicadores de gestão (indicadores_gestao): somas por mês e
-- categoria, em aberto por faixa, pedidos por etapa, saída da fábrica pela
-- data de faturamento do Tiny, notas, compras, filtro por empresa e acesso.
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

-- Dados num período só deste teste (2030), para não somar com os outros.
select set_config('teste.ind_a', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.ind_b', id::text, false) from empresas where cnpj = '22222222000122';

insert into fornecedores (tipo_pessoa, documento, nome, condicao_pagamento)
values ('juridica', '90909090000190', 'FORNECEDOR INDICADOR', '28 dd');
insert into clientes (tipo_pessoa, documento, nome) values ('juridica', '80808080000180', 'CLIENTE INDICADOR');
select set_config('teste.ind_forn', id::text, false) from fornecedores where documento = '90909090000190';
select set_config('teste.ind_cli', id::text, false) from clientes where documento = '80808080000180';
select set_config('teste.ind_mp', id::text, false) from plano_contas where nome = 'Matéria-prima e embalagens';
select set_config('teste.ind_conta', id::text, false) from contas_bancarias where empresa_id = current_setting('teste.ind_a')::uuid limit 1;
select set_config('teste.ind_rec', id::text, false) from plano_contas where nome = 'Venda de produtos';

-- A pagar: 1.000 pago em dia em jan/2030, 500 em aberto vencendo em fev/2030,
-- 300 cancelado (não conta) e 700 de outra empresa.
insert into contas_pagar (empresa_id, fornecedor_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id)
values
  (current_setting('teste.ind_a')::uuid, current_setting('teste.ind_forn')::uuid, 'Ind 1', current_setting('teste.ind_mp')::uuid,
   1000, '2030-01-10', 'pago', '2030-01-10', 1000, current_setting('teste.ind_conta')::uuid),
  (current_setting('teste.ind_a')::uuid, current_setting('teste.ind_forn')::uuid, 'Ind 2', current_setting('teste.ind_mp')::uuid,
   500, '2030-02-10', 'aberto', null, null, null),
  (current_setting('teste.ind_a')::uuid, current_setting('teste.ind_forn')::uuid, 'Ind 3', current_setting('teste.ind_mp')::uuid,
   300, '2030-01-15', 'cancelado', null, null, null),
  (current_setting('teste.ind_b')::uuid, current_setting('teste.ind_forn')::uuid, 'Ind 4', current_setting('teste.ind_mp')::uuid,
   700, '2030-01-20', 'aberto', null, null, null);
-- A receber: 2.000 recebido com 5 dias de atraso.
insert into contas_receber (empresa_id, cliente_id, descricao, categoria_id, valor, vencimento, situacao, data_recebimento, valor_recebido, conta_bancaria_id)
values (current_setting('teste.ind_a')::uuid, current_setting('teste.ind_cli')::uuid, 'Ind R1', current_setting('teste.ind_rec')::uuid,
        2000, '2030-01-05', 'pago', '2030-01-10', 2000, current_setting('teste.ind_conta')::uuid);

-- Pedidos: um faturado no Tiny em 20/02/2030 (pedido de 01/01) e um em produção.
insert into pedidos_venda (empresa_id, cliente_id, data_pedido, prazo_entrega, condicao_pagamento, etapa_id, dados_tiny)
values (current_setting('teste.ind_a')::uuid, current_setting('teste.ind_cli')::uuid, '2030-01-01', '2030-01-30', '30/60',
        (select id from etapas_pedido where nome = 'Emitido'), '{"dataFaturamento": "2030-02-20"}'),
       (current_setting('teste.ind_a')::uuid, current_setting('teste.ind_cli')::uuid, '2030-01-15', '2030-02-28', '30',
        (select id from etapas_pedido where nome = 'Emitido'), null);
insert into pedido_venda_itens (pedido_id, item_id, quantidade, preco_unitario)
select p.id, (select id from itens order by codigo limit 1), 1, v
from pedidos_venda p
join (values ('2030-01-01'::date, 3000), ('2030-01-15'::date, 4000)) x(d, v) on x.d = p.data_pedido
where p.cliente_id = current_setting('teste.ind_cli')::uuid;
update pedidos_venda set etapa_id = (select id from etapas_pedido where nome = case when data_pedido = '2030-01-01' then 'Entregue' else 'Em produção' end)
where cliente_id = current_setting('teste.ind_cli')::uuid;

-- Nota de saída válida e uma cancelada (não conta).
insert into notas_tiny (empresa_id, tiny_id, tipo, numero, situacao, emissao, valor)
values (current_setting('teste.ind_a')::uuid, 990001, 'S', '1', 6, '2030-02-20', 3000),
       (current_setting('teste.ind_a')::uuid, 990002, 'S', '2', 3, '2030-02-21', 999);

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select set_config('teste.ind', indicadores_gestao('2030-01-01', '2030-03-31', current_setting('teste.ind_a')::uuid)::text, false);
select set_config('teste.ind_todas', indicadores_gestao('2030-01-01', '2030-03-31')::text, false);
reset role;

select pg_temp.esperar(
  (select sum((x ->> 'previsto')::numeric) = 1500 and sum((x ->> 'realizado')::numeric) = 1000
   from jsonb_array_elements(current_setting('teste.ind')::jsonb -> 'titulos_mes') x where x ->> 'tipo' = 'pagar'),
  'a pagar: previsto pelo vencimento, realizado pela baixa, sem cancelado');
select pg_temp.esperar(
  (select sum((x ->> 'previsto')::numeric) = 2200
   from jsonb_array_elements(current_setting('teste.ind_todas')::jsonb -> 'titulos_mes') x
   where x ->> 'tipo' = 'pagar' and x ->> 'mes' like '2030-%'),
  'consolidado soma as duas empresas');
select pg_temp.esperar(
  (select (x ->> 'em_dia')::int = 0 and (x ->> 'dias_atraso_valor')::numeric = 10000
   from jsonb_array_elements(current_setting('teste.ind')::jsonb -> 'pontualidade') x where x ->> 'tipo' = 'receber'),
  'recebimento com 5 dias de atraso');
select pg_temp.esperar(
  (select (x ->> 'total')::numeric = 1500 and x ->> 'nome' = 'FORNECEDOR INDICADOR' and x ->> 'condicao_cadastro' = '28 dd'
   from jsonb_array_elements(current_setting('teste.ind')::jsonb -> 'pessoas') x
   where x ->> 'pessoa_id' = current_setting('teste.ind_forn')),
  'principal fornecedor com volume e condição do cadastro');
select pg_temp.esperar(
  (select count(*) = 2 and sum((x ->> 'valor')::numeric) = 7000
   from jsonb_array_elements(current_setting('teste.ind')::jsonb -> 'condicoes') x where x ->> 'tipo' = 'receber'),
  'condições dos pedidos de venda do período');
select pg_temp.esperar(
  (select (x ->> 'saida_valor')::numeric = 3000 and (x ->> 'ciclo_dias')::numeric = 50
   from jsonb_array_elements(current_setting('teste.ind')::jsonb -> 'pedidos_mes') x where x ->> 'mes' = '2030-02'),
  'saída da fábrica pela data de faturamento do Tiny');
select pg_temp.esperar(
  (select sum((x ->> 'entrada_valor')::numeric) = 7000
   from jsonb_array_elements(current_setting('teste.ind')::jsonb -> 'pedidos_mes') x where x ->> 'mes' = '2030-01'),
  'entrada de pedidos pela data do pedido');
select pg_temp.esperar(
  (select (x ->> 'qtd')::int >= 1 and (x ->> 'valor')::numeric >= 4000
   from jsonb_array_elements(current_setting('teste.ind')::jsonb -> 'pedidos_etapa') x where x ->> 'nome' = 'Em produção'),
  'pedido em produção aparece na etapa');
select pg_temp.esperar(
  (select count(*) = 1 and sum((x ->> 'valor')::numeric) = 3000
   from jsonb_array_elements(current_setting('teste.ind')::jsonb -> 'notas_mes') x where x ->> 'mes' = '2030-02'),
  'só notas válidas contam');

-- Quem não tem a tela de indicadores não chama a função.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar_erro($$select indicadores_gestao('2030-01-01', '2030-03-31')$$, 'não tem acesso', 'sem permissão não vê os indicadores');
reset role;
set role anon;
select pg_temp.esperar_erro($$select indicadores_gestao('2030-01-01', '2030-03-31')$$, 'permission denied', 'anônimo não chama a função');
reset role;

-- Limpa o que este teste criou.
delete from notas_tiny where tiny_id in (990001, 990002);
delete from pedidos_venda where cliente_id = current_setting('teste.ind_cli')::uuid;
delete from contas_pagar where fornecedor_id = current_setting('teste.ind_forn')::uuid;
delete from contas_receber where cliente_id = current_setting('teste.ind_cli')::uuid;
