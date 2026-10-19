-- Testes das notas de fornecedores e do contas a pagar: lançamento da nota,
-- de-para de produtos, comparação de preços, entrada no estoque e pagamento.
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
select set_config('teste.local', id::text, false) from locais_estoque where nome = 'Expedição';
select set_config('teste.conta_comercio', id::text, false) from contas_bancarias where nome = 'Inter';

create function pg_temp.nota(numero text, chave text, empresa text, preco_a numeric) returns jsonb language sql as $$
  select jsonb_build_object(
    'empresa_id', empresa, 'numero', numero, 'serie', '1', 'chave', chave, 'data_emissao', '2026-10-0' || numero,
    'destinatario_cnpj', '11111111000111', 'origem', 'xml',
    'valor_produtos', 2 * preco_a + 50, 'valor_frete', 10, 'valor_total', 2 * preco_a + 60,
    'fornecedor', jsonb_build_object('documento', '44.444.444/0001-44', 'nome', 'Parafusos Brasil Ltda', 'uf', 'sp'),
    'categoria_id', (select id from plano_contas where codigo = '3.01'),
    'itens', jsonb_build_array(
      jsonb_build_object('codigo', 'A1', 'descricao', 'Parafuso cx 100', 'unidade', 'CX', 'quantidade', 2, 'valor_unitario', preco_a, 'valor_total', 2 * preco_a),
      jsonb_build_object('codigo', 'B2', 'descricao', 'Arruela', 'unidade', 'UN', 'quantidade', 5, 'valor_unitario', 10, 'valor_total', 50)),
    'parcelas', jsonb_build_array(
      jsonb_build_object('valor', preco_a + 30, 'vencimento', '2026-11-01'),
      jsonb_build_object('valor', preco_a + 30, 'vencimento', '2026-12-01')))
$$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';

-- Lançamento: cria o fornecedor pelo CNPJ, a nota, os itens e as parcelas.
select set_config('teste.nota1', registrar_nota_fornecedor(pg_temp.nota('1', repeat('1', 44), current_setting('teste.industria'), 50))::text, false);
select pg_temp.esperar(
  (select nome || '|' || uf from fornecedores where documento = '44444444000144') = 'Parafusos Brasil Ltda|SP',
  'fornecedor novo é cadastrado pelo CNPJ da nota');
select pg_temp.esperar(
  (select string_agg(parcela || '=' || valor, ',' order by vencimento) from contas_pagar where nota_id = current_setting('teste.nota1')::uuid) = '1/2=80.00,2/2=80.00',
  'parcelas da nota viram contas a pagar');
select pg_temp.esperar_erro(
  $$select registrar_nota_fornecedor(pg_temp.nota('9', repeat('1', 44), current_setting('teste.industria'), 50))$$,
  'chave', 'a mesma nota não é lançada duas vezes');
select pg_temp.esperar_erro(
  $$select registrar_nota_fornecedor(pg_temp.nota('8', repeat('8', 44), current_setting('teste.comercio'), 50))$$,
  'não tem acesso', 'não lança nota em CNPJ não liberado');
select pg_temp.esperar_erro(
  $$select registrar_nota_fornecedor(pg_temp.nota('7', repeat('7', 44), current_setting('teste.industria'), 50) || '{"destinatario_cnpj": "99999999000199"}')$$,
  'outro CNPJ', 'nota de outro destinatário é recusada');

-- Entrada no estoque exige todos os produtos vinculados.
select pg_temp.esperar_erro(
  $$select dar_entrada_nota(current_setting('teste.nota1')::uuid, current_setting('teste.local')::uuid)$$,
  'Vincule todos', 'entrada só com todos os produtos vinculados');

-- Vincular uma vez memoriza o de-para (com conversão CX -> PC).
update nota_fornecedor_itens set item_id = (select id from itens where codigo = 'MP1'), fator = 100
where nota_id = current_setting('teste.nota1')::uuid and codigo_fornecedor = 'A1';
select pg_temp.esperar(
  (select fator from fornecedor_produtos where codigo_fornecedor = 'A1') = 100,
  'vínculo do produto fica memorizado');

-- Segunda nota: A1 já chega vinculado e com preço comparado à nota anterior.
select set_config('teste.nota2', registrar_nota_fornecedor(pg_temp.nota('2', repeat('2', 44), current_setting('teste.industria'), 55))::text, false);
select pg_temp.esperar(
  (select item_id is not null and fator = 100 from nota_fornecedor_itens where nota_id = current_setting('teste.nota2')::uuid and codigo_fornecedor = 'A1'),
  'produto conhecido é vinculado sozinho na próxima nota');
select pg_temp.esperar(
  (select variacao_preco_pct from nota_fornecedor_itens_comparacao where nota_id = current_setting('teste.nota2')::uuid and codigo_fornecedor = 'A1') = 10.0,
  'comparação mostra a variação de preço sobre a nota anterior');
select pg_temp.esperar(
  (select bool_and(produto_novo) from nota_fornecedor_itens_comparacao where nota_id = current_setting('teste.nota1')::uuid),
  'primeira compra aparece como produto novo');

-- Vincular B2 na nota 1 também vincula a nota 2.
update nota_fornecedor_itens set item_id = (select id from itens where codigo = 'PA1')
where nota_id = current_setting('teste.nota1')::uuid and codigo_fornecedor = 'B2';
select pg_temp.esperar(
  (select count(*) from nota_fornecedor_itens where item_id is null) = 0,
  'vínculo novo alcança as outras notas do fornecedor');

select pg_temp.esperar(
  dar_entrada_nota(current_setting('teste.nota1')::uuid, current_setting('teste.local')::uuid) = 2,
  'nota dá entrada no estoque');
select pg_temp.esperar_erro(
  $$select dar_entrada_nota(current_setting('teste.nota1')::uuid, current_setting('teste.local')::uuid)$$,
  'já deu entrada', 'nota não dá entrada duas vezes');
select pg_temp.esperar_erro(
  $$update nota_fornecedor_itens set fator = 1 where nota_id = current_setting('teste.nota1')::uuid and codigo_fornecedor = 'A1'$$,
  'já deu entrada', 'vínculo não muda depois da entrada');

-- Pagamento.
update contas_pagar set situacao = 'pago', data_pagamento = '2026-11-01', valor_pago = 80,
  conta_bancaria_id = (select id from contas_bancarias where nome = 'Itaú movimento')
where nota_id = current_setting('teste.nota1')::uuid and parcela = '1/2';
select pg_temp.esperar(
  (select count(*) from contas_pagar where situacao = 'pago') = 1,
  'financeiro baixa o pagamento');
select pg_temp.esperar_erro(
  $$update contas_pagar set conta_bancaria_id = current_setting('teste.conta_comercio')::uuid where parcela = '1/2' and nota_id = current_setting('teste.nota1')::uuid$$,
  'mesma empresa', 'pagamento só por conta da mesma empresa');
select pg_temp.esperar_erro(
  $$update contas_pagar set situacao = 'pago' where parcela = '2/2' and nota_id = current_setting('teste.nota1')::uuid$$,
  'check', 'título pago exige data, valor e conta');
select pg_temp.esperar_erro(
  $$insert into contas_pagar (empresa_id, descricao, valor, vencimento, categoria_id)
    values (current_setting('teste.industria')::uuid, 'x', 1, '2026-11-01', (select id from plano_contas where codigo = '1.01'))$$,
  'despesa', 'contas a pagar só com categoria de despesa');
select pg_temp.esperar_erro(
  $$insert into contas_pagar (empresa_id, descricao, valor, vencimento, categoria_id)
    values (current_setting('teste.industria')::uuid, 'x', 1, '2026-11-01', (select id from plano_contas where codigo = '4'))$$,
  'mais detalhada', 'contas a pagar só com categoria sem subcategorias');

-- Arquivos da nota ficam na pasta do CNPJ.
insert into storage.objects (bucket_id, name) values ('notas-fornecedor', current_setting('teste.industria') || '/x.xml');
select pg_temp.esperar_erro(
  $$insert into storage.objects (bucket_id, name) values ('notas-fornecedor', current_setting('teste.comercio') || '/x.xml')$$,
  'row-level security', 'arquivo só na pasta de CNPJ liberado');
reset role;

-- Estoque e custo médio: MP1 tinha 10 PC a custo 0; entram 200 PC a 0,5333
-- (R$ 100 dos itens + rateio do frete: 160/150).
select pg_temp.esperar(
  (select sum(saldo) from saldos_estoque s join itens i on i.id = s.item_id where i.codigo = 'MP1') = 210,
  'entrada converte caixas em peças');
select pg_temp.esperar(
  (select custo_medio from itens where codigo = 'MP1') = 0.5079,
  'custo médio recalculado com o frete rateado');

-- Compras (sem CNPJ liberado) não vê as notas nem as contas a pagar.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar(
  (select count(*) from notas_fornecedor) + (select count(*) from contas_pagar) = 0,
  'compras sem CNPJ liberado não vê notas nem títulos');
reset role;
