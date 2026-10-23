-- Testes dos pedidos de venda (etapas, histórico, acesso por CNPJ), dos dados
-- do planejamento e do inventário. comercial@teste vê só o CNPJ 11111111000111;
-- producao@teste (PCP) não tem CNPJ liberado, mas planeja a fábrica toda.
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000f', 'comercial@teste');
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Comercial') where email = 'comercial@teste';
insert into usuario_empresas (usuario_id, empresa_id)
select '00000000-0000-0000-0000-00000000000f', id from empresas where cnpj = '11111111000111';
select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.comercio', id::text, false) from empresas where cnpj = '22222222000122';
select set_config('teste.cliente', id::text, false) from clientes limit 1;
select set_config('teste.pa1', id::text, false) from itens where codigo = 'PA1';
select set_config('teste.local', id::text, false) from locais_estoque where nome = 'Expedição';

create function pg_temp.pedido(empresa text) returns jsonb language sql as $$
  select jsonb_build_object(
    'empresa_id', empresa, 'cliente_id', current_setting('teste.cliente'), 'prazo_entrega', '2026-09-01',
    'prazo_recebimento_dias', 28, 'itens', jsonb_build_array(
      jsonb_build_object('item_id', current_setting('teste.pa1'), 'quantidade', 3, 'preco_unitario', 100)))
$$;

-- Comercial lança o pedido no CNPJ liberado.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.esperar((select count(*) from itens) > 0, 'comercial enxerga os produtos para vender');
select set_config('teste.pedido', salvar_pedido_venda(pg_temp.pedido(current_setting('teste.industria')))::text, false);
select pg_temp.esperar(
  (select etapa_nome || '|' || valor_total || '|' || (dias_atraso > 0) from pedidos_venda_resumo where id = current_setting('teste.pedido')::uuid)
    = 'Em aberto|300.00|true',
  'pedido nasce na primeira etapa com o total dos itens');
select pg_temp.esperar_erro(
  $$select salvar_pedido_venda(pg_temp.pedido(current_setting('teste.comercio')))$$,
  'row-level security', 'comercial não lança pedido em CNPJ não liberado');
select pg_temp.esperar_erro(
  $$select salvar_pedido_venda(pg_temp.pedido(current_setting('teste.industria')) - 'itens')$$,
  'pelo menos um item', 'pedido sem itens é recusado');

update pedidos_venda set etapa_id = (select id from etapas_pedido where nome = 'Aprovado')
where id = current_setting('teste.pedido')::uuid;
select pg_temp.esperar(
  (select count(*) from pedido_etapas_historico where pedido_id = current_setting('teste.pedido')::uuid) = 2,
  'troca de etapa fica no histórico');
select pg_temp.esperar_erro(
  $$update pedido_venda_itens set quantidade = 5 where pedido_id = current_setting('teste.pedido')::uuid$$,
  'negociação', 'itens só mudam em negociação');
-- O comercial acompanha a fila de produção para prometer prazos.
select pg_temp.esperar(dados_planejamento() ? 'pedidos', 'comercial consulta o planejamento');
reset role;

-- PCP vê e movimenta pedidos de todos os CNPJs e lê o planejamento.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.esperar((select count(*) from pedidos_venda) = 1, 'PCP vê os pedidos sem ter CNPJ liberado');
update pedidos_venda set etapa_id = (select id from etapas_pedido where nome = 'Preparando envio');
select pg_temp.esperar(
  (select etapa_nome from pedidos_venda_resumo) = 'Preparando envio', 'PCP muda a etapa do pedido');
select pg_temp.esperar(
  (select jsonb_array_length(dados_planejamento() -> 'pedidos')) = 1,
  'planejamento traz os pedidos em fase de produção');

-- Inventário: o saldo do local passa a ser o contado.
select pg_temp.esperar(
  registrar_inventario(current_setting('teste.local')::uuid,
    jsonb_build_array(jsonb_build_object('item_id', current_setting('teste.pa1'), 'quantidade', 7))) = 1,
  'inventário gera o ajuste da diferença');
select pg_temp.esperar(
  registrar_inventario(current_setting('teste.local')::uuid,
    jsonb_build_array(jsonb_build_object('item_id', current_setting('teste.pa1'), 'quantidade', 7))) = 0,
  'contagem igual ao sistema não gera ajuste');
reset role;
select pg_temp.esperar(
  (select saldo from saldos_estoque where item_id = current_setting('teste.pa1')::uuid and local_id = current_setting('teste.local')::uuid) = 7,
  'saldo do local fica igual ao contado');

-- Compras lê o planejamento; Contabilidade não.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar(dados_planejamento() ? 'itens', 'compras lê o planejamento');
reset role;
update usuarios set perfil_id = (select id from perfis where nome = 'Contabilidade') where email = 'financeiro@teste';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar((select count(*) from pedidos_venda) = 0, 'contabilidade não vê pedidos');
select pg_temp.esperar_erro($$select dados_planejamento()$$, 'não tem acesso', 'contabilidade não abre o planejamento');
reset role;

-- Histórico com nomes só para quem vê o pedido.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.esperar(
  (select count(*) from historico_pedido(current_setting('teste.pedido')::uuid)) = 3, 'histórico do pedido mostra as trocas de etapa');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar(
  (select count(*) from historico_pedido(current_setting('teste.pedido')::uuid)) = 0, 'histórico fechado para quem não vê o pedido');
reset role;
