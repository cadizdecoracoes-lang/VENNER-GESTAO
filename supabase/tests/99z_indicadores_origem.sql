-- Testes da origem dos números dos indicadores (indicadores_origem): títulos
-- por categoria, sem categoria, pela baixa, em aberto por faixa, por pessoa;
-- pedidos que entraram e que saíram da fábrica; notas; acesso.
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

-- Origem como diretoria (usuário b), período de 2032 (só deste teste).
create function pg_temp.origem(filtro jsonb, de date default '2032-01-01', ate date default '2032-01-31') returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  r := indicadores_origem(de, ate, null, filtro);
  reset role;
  return r;
end $$;

select set_config('teste.or_a', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.or_b', id::text, false) from empresas where cnpj = '22222222000122';
select set_config('teste.or_mp', id::text, false) from plano_contas where nome = 'Matéria-prima e embalagens';
select set_config('teste.or_conta', id::text, false) from contas_bancarias where empresa_id = current_setting('teste.or_a')::uuid limit 1;
insert into fornecedores (tipo_pessoa, documento, nome) values ('juridica', '70707070000170', 'FORNECEDOR ORIGEM');
insert into clientes (tipo_pessoa, documento, nome) values ('juridica', '60606060000160', 'CLIENTE ORIGEM');
select set_config('teste.or_forn', id::text, false) from fornecedores where documento = '70707070000170';
select set_config('teste.or_cli', id::text, false) from clientes where documento = '60606060000160';

-- A pagar em jan/2032: 1.000 de matéria-prima pago em fev, 400 de
-- matéria-prima em aberto, 50 sem categoria e 900 cancelado.
insert into contas_pagar (empresa_id, fornecedor_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id)
values
  (current_setting('teste.or_a')::uuid, current_setting('teste.or_forn')::uuid, 'Origem 1', current_setting('teste.or_mp')::uuid,
   1000, '2032-01-10', 'pago', '2032-02-03', 1000, current_setting('teste.or_conta')::uuid),
  (current_setting('teste.or_a')::uuid, current_setting('teste.or_forn')::uuid, 'Origem 2', current_setting('teste.or_mp')::uuid,
   400, '2032-01-20', 'aberto', null, null, null),
  (current_setting('teste.or_a')::uuid, null, 'Origem 3 ajuda de custo', null, 50, '2032-01-25', 'aberto', null, null, null),
  (current_setting('teste.or_a')::uuid, current_setting('teste.or_forn')::uuid, 'Origem 4', current_setting('teste.or_mp')::uuid,
   900, '2032-01-15', 'cancelado', null, null, null);
insert into contas_receber (empresa_id, cliente_id, descricao, valor, vencimento, situacao)
values (current_setting('teste.or_a')::uuid, current_setting('teste.or_cli')::uuid, 'Origem R1', 3000, '2032-01-12', 'aberto'),
       (current_setting('teste.or_b')::uuid, current_setting('teste.or_cli')::uuid, 'Origem R2', 2000, '2032-01-12', 'aberto');

-- Pedido de 05/01/2032 faturado no Tiny em 10/02/2032.
insert into pedidos_venda (empresa_id, cliente_id, data_pedido, prazo_entrega, etapa_id, dados_tiny)
values (current_setting('teste.or_a')::uuid, current_setting('teste.or_cli')::uuid, '2032-01-05', '2032-01-30',
        (select id from etapas_pedido where nome = 'Emitido'), '{"dataFaturamento": "2032-02-10"}');
insert into pedido_venda_itens (pedido_id, item_id, quantidade, preco_unitario)
select p.id, (select id from itens order by codigo limit 1), 2, 1250 from pedidos_venda p where p.cliente_id = current_setting('teste.or_cli')::uuid;
update pedidos_venda set etapa_id = (select id from etapas_pedido where nome = 'Entregue') where cliente_id = current_setting('teste.or_cli')::uuid;

insert into notas_tiny (empresa_id, tiny_id, tipo, numero, situacao, emissao, valor, contato_nome)
values (current_setting('teste.or_a')::uuid, 990101, 'S', '101', 6, '2032-02-10', 2500, 'CLIENTE ORIGEM'),
       (current_setting('teste.or_a')::uuid, 990102, 'S', '102', 3, '2032-02-11', 999, 'CLIENTE ORIGEM');

select pg_temp.esperar(
  (select (r ->> 'total')::numeric = 1400 and (r ->> 'qtd')::int = 2
   from pg_temp.origem(jsonb_build_object('tipo', 'pagar', 'categorias', jsonb_build_array(current_setting('teste.or_mp')))) r),
  'matéria-prima pelo vencimento: os dois títulos, sem o cancelado');
select pg_temp.esperar(
  (select (r ->> 'total')::numeric = 1450
   from pg_temp.origem(jsonb_build_object('tipo', 'pagar', 'categorias', jsonb_build_array(current_setting('teste.or_mp')), 'sem_categoria', true)) r),
  'com sem_categoria entra o título sem categoria');
select pg_temp.esperar(
  (select (r ->> 'total')::numeric = 1000 and r -> 'linhas' -> 0 ->> 'descricao' = 'Origem 1' and r -> 'linhas' -> 0 ->> 'pessoa' = 'FORNECEDOR ORIGEM'
   from pg_temp.origem('{"tipo": "pagar", "base": "baixa"}', '2032-02-01', '2032-02-29') r),
  'pela baixa: o pago em fevereiro, com o fornecedor');
select pg_temp.esperar(
  (select (r ->> 'total')::numeric = 50
   from pg_temp.origem('{"tipo": "pagar", "ajuda": true}') r),
  'ajuda de custo pela descrição');
select pg_temp.esperar(
  (select (r ->> 'total')::numeric = 5000 and (r ->> 'qtd')::int = 2
   from pg_temp.origem(jsonb_build_object('tipo', 'receber', 'pessoa', current_setting('teste.or_cli'))) r),
  'por cliente, nas duas empresas');
select pg_temp.esperar(
  (select (r ->> 'qtd')::int >= 3
   from pg_temp.origem('{"base": "aberto", "faixa": "vence_61"}') r),
  'em aberto vencendo daqui a mais de 60 dias');
select pg_temp.esperar(
  (select (r ->> 'total')::numeric = 2500 and r -> 'linhas' -> 0 ->> 'cliente' = 'CLIENTE ORIGEM'
   from pg_temp.origem('{"fonte": "pedidos", "modo": "entrada"}') r),
  'pedido que entrou em janeiro');
select pg_temp.esperar(
  (select (r ->> 'total')::numeric = 2500 and r -> 'linhas' -> 0 ->> 'saiu' = '2032-02-10'
   from pg_temp.origem('{"fonte": "pedidos", "modo": "saida"}', '2032-02-01', '2032-02-29') r),
  'pedido que saiu da fábrica pela data de faturamento');
select pg_temp.esperar(
  (select (r ->> 'total')::numeric = 2500 and (r ->> 'qtd')::int = 1
   from pg_temp.origem('{"fonte": "notas", "tipo_nota": "S"}', '2032-02-01', '2032-02-29') r),
  'só notas válidas');

-- Perfil sem contas a pagar e só com a empresa A (criado no teste 99y).
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a9';
select set_config('teste.or_restrito_pagar', indicadores_origem('2032-01-01', '2032-01-31', null, '{"tipo": "pagar"}')::text, false);
select set_config('teste.or_restrito_receber', indicadores_origem('2032-01-01', '2032-01-31', null, '{"tipo": "receber"}')::text, false);
select pg_temp.esperar_erro($$select indicadores_origem('2032-01-01', '2032-01-31', null, '{"fonte": "outra"}')$$, 'Origem desconhecida', 'origem desconhecida dá erro');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar_erro($$select indicadores_origem('2032-01-01', '2032-01-31')$$, 'não tem acesso', 'sem a tela de indicadores não vê a origem');
reset role;
set role anon;
select pg_temp.esperar_erro($$select indicadores_origem('2032-01-01', '2032-01-31')$$, 'permission denied', 'anônimo não chama a função');
reset role;
select pg_temp.esperar((current_setting('teste.or_restrito_pagar')::jsonb ->> 'qtd')::int = 0, 'sem financeiro.pagar não vê os títulos a pagar');
select pg_temp.esperar((current_setting('teste.or_restrito_receber')::jsonb ->> 'total')::numeric = 3000, 'só a empresa liberada no contas a receber');

-- Limpa o que este teste criou.
delete from notas_tiny where tiny_id in (990101, 990102);
delete from pedidos_venda where cliente_id = current_setting('teste.or_cli')::uuid;
delete from contas_pagar where descricao like 'Origem %';
delete from contas_receber where descricao like 'Origem R%';
