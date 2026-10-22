-- Testes do contas a receber: parcelas do pedido, vendas das plataformas
-- (pedido, baixa do estoque e título pelo líquido), recebimento e custo padrão.
-- financeiro@teste volta a ser do Financeiro, só com o CNPJ 11111111000111.
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

update usuarios set perfil_id = (select id from perfis where nome = 'Financeiro') where email = 'financeiro@teste';
select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.comercio', id::text, false) from empresas where cnpj = '22222222000122';
select set_config('teste.pedido', id::text, false) from pedidos_venda where empresa_id = current_setting('teste.industria')::uuid;
select set_config('teste.local', id::text, false) from locais_estoque where nome = 'Expedição';
select set_config('teste.pa1', id::text, false) from itens where codigo = 'PA1';

create function pg_temp.venda(numero text) returns jsonb language sql as $$
  select jsonb_build_object('numero', numero, 'data', '2026-10-10', 'liberacao', '2026-10-25', 'comprador', 'Ana',
    'valor', 250, 'tarifas', 40,
    'itens', jsonb_build_array(jsonb_build_object('codigo', 'MLB123', 'titulo', 'Kit 2 PA1', 'quantidade', 1, 'valor', 250)))
$$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';

-- Parcelas do pedido das distribuidoras.
select pg_temp.esperar(
  gerar_receber_pedido(current_setting('teste.pedido')::uuid,
    '[{"valor": 150, "vencimento": "2026-11-10"}, {"valor": 150, "vencimento": "2026-12-10"}]') = 2,
  'pedido gera as parcelas a receber');
select pg_temp.esperar(
  (select string_agg(parcela || '=' || valor || '|' || p.codigo, ',' order by vencimento)
   from contas_receber r join plano_contas p on p.id = r.categoria_id) = '1/2=150.00|1.01,2/2=150.00|1.01',
  'parcelas numeradas na categoria de venda de produtos');
select pg_temp.esperar_erro(
  $$select gerar_receber_pedido(current_setting('teste.pedido')::uuid, '[{"valor": 300, "vencimento": "2026-11-10"}]')$$,
  'já tem contas a receber', 'pedido não gera parcelas duas vezes');

-- Recebimento.
update contas_receber set situacao = 'pago', data_recebimento = '2026-11-10', valor_recebido = 150,
  conta_bancaria_id = (select id from contas_bancarias where nome = 'Itaú movimento')
where parcela = '1/2';
select pg_temp.esperar((select count(*) from contas_receber where situacao = 'pago') = 1, 'financeiro baixa o recebimento');
select pg_temp.esperar_erro(
  $$update contas_receber set situacao = 'pago' where parcela = '2/2'$$, 'check', 'recebido exige data, valor e conta');
select pg_temp.esperar_erro(
  $$insert into contas_receber (empresa_id, descricao, valor, vencimento, categoria_id)
    values (current_setting('teste.industria')::uuid, 'x', 1, '2026-11-01', (select id from plano_contas where codigo = '3.01'))$$,
  'receita', 'contas a receber só com categoria de receita');

-- Venda de plataforma: o anúncio precisa estar ligado ao produto.
select pg_temp.esperar_erro(
  $$select importar_vendas_plataforma(current_setting('teste.industria')::uuid, 'mercado_livre', jsonb_build_array(pg_temp.venda('2000001')), current_setting('teste.local')::uuid)$$,
  'MLB123', 'anúncio sem produto ligado barra a importação');
insert into anuncios_plataforma (empresa_id, canal, codigo, titulo, item_id, quantidade)
values (current_setting('teste.industria')::uuid, 'mercado_livre', 'MLB123', 'Kit 2 PA1', current_setting('teste.pa1')::uuid, 2);
select pg_temp.esperar(
  importar_vendas_plataforma(current_setting('teste.industria')::uuid, 'mercado_livre',
    jsonb_build_array(pg_temp.venda('2000001')), current_setting('teste.local')::uuid) = '{"importadas": 1, "repetidas": 0}',
  'venda da plataforma é importada');
select pg_temp.esperar(
  importar_vendas_plataforma(current_setting('teste.industria')::uuid, 'mercado_livre',
    jsonb_build_array(pg_temp.venda('2000001')), current_setting('teste.local')::uuid) = '{"importadas": 0, "repetidas": 1}',
  'a mesma venda não entra duas vezes');
select pg_temp.esperar(
  (select valor_liquido || '|' || vencimento || '|' || p.codigo from contas_receber r join plano_contas p on p.id = r.categoria_id
   where canal = 'mercado_livre') = '210.00|2026-10-25|1.02',
  'título da plataforma pelo líquido, na data de liberação');
select pg_temp.esperar_erro(
  $$select importar_vendas_plataforma(current_setting('teste.comercio')::uuid, 'mercado_livre', '[]', current_setting('teste.local')::uuid)$$,
  'não tem acesso', 'não importa em CNPJ não liberado');
reset role;

select pg_temp.esperar(
  (select string_agg(i.quantidade || '@' || i.preco_unitario, ',') from pedido_venda_itens i
   join pedidos_venda p on p.id = i.pedido_id where p.numero_externo = '2000001') = '2.0000@125.0000',
  'kit abre em duas unidades do produto');
select pg_temp.esperar(
  (select e.fase from pedidos_venda p join etapas_pedido e on e.id = p.etapa_id where p.numero_externo = '2000001') = 'encerrado',
  'venda da plataforma entra encerrada (fora da fila de produção)');
select pg_temp.esperar(
  (select sum(quantidade) from movimentos_estoque where origem_tipo = 'pedido_venda') = -2,
  'venda baixa o estoque do produto');

-- Custo padrão pela ficha técnica, para a margem.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.esperar((select count(*) from custos_padrao(array[current_setting('teste.pa1')::uuid])) = 1, 'comercial vê o custo padrão');
select pg_temp.esperar((select count(*) from contas_receber) = 3, 'comercial acompanha o receber do seu CNPJ');
reset role;

-- Contas das plataformas: chaves fora do alcance das telas.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar(
  salvar_integracao(current_setting('teste.industria')::uuid, 'mercado_livre', '123456', 'Loja ML', 'tok1', 'ref1', now() + interval '6 hours') is not null,
  'financeiro liga a conta do Mercado Livre');
select pg_temp.esperar(
  (select count(*) from listar_integracoes()) = 1 and (select access_token from acesso_integracao((select id from listar_integracoes()))) = 'tok1',
  'servidor lê a chave pela função que confere o perfil');
select pg_temp.esperar_erro($$select * from integracoes_plataforma$$, 'permission denied', 'tabela das chaves fechada para as telas');
select pg_temp.esperar_erro(
  $$select salvar_integracao(current_setting('teste.comercio')::uuid, 'shopee', '9', 'x', 't', null, null)$$,
  'não pode ligar', 'não liga conta em CNPJ não liberado');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.esperar((select count(*) from listar_integracoes()) = 0, 'comercial não vê as contas ligadas');
select pg_temp.esperar_erro($$select * from acesso_integracao(gen_random_uuid())$$, 'não pode sincronizar', 'comercial não lê chaves');
reset role;

select pg_temp.esperar(
  (select count(*) from auditoria where tabela = 'integracoes_plataforma') = 1
  and not exists (select 1 from auditoria where tabela = 'integracoes_plataforma' and dados_depois::text like '%tok1%'),
  'auditoria das contas ligadas não guarda as chaves');
