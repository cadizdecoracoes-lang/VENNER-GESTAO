-- Testes das ordens de compra lidas do Tiny: viram pedidos de compra com
-- itens e parcelas, a situação do Tiny vira a etapa e o pedido do Tiny não
-- muda aqui.
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
select set_config('teste.robo', (select integracao_id::text from integracao_robo limit 1), false);
select set_config('teste.chave', (select chave from integracao_robo limit 1), false);

-- A listagem põe a ordem 900 na fila.
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'),
  '{"listados": [{"tipo": "compra", "id": 900, "assinatura": "0|2026-11-02||1250|900"}]}'::jsonb);
reset role;
select pg_temp.esperar(
  (select pendente from integracao_fila where tipo = 'compra' and id_externo = 900),
  'ordem de compra listada entra na fila');

-- O detalhe chega: em andamento, com o mesmo produto em duas linhas e duas parcelas.
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), $${
  "compras": [{
    "id": 900, "numero": "900", "data": "2026-11-02", "data_prevista": "2026-11-20", "situacao": 3,
    "fornecedor": {"id": 9001, "nome": "FORNECEDOR DA ORDEM", "documento": "22.333.444/0001-55"},
    "categoria_id": null, "categoria_nome": null, "frete": 50, "desconto": 0, "frete_por_conta": "R",
    "observacoes": "Entregar na fábrica", "observacoes_internas": null,
    "itens": [{"produto_id": 9101, "sku": "MP-ORDEM", "descricao": "Chapa da ordem", "quantidade": 10, "valor_unitario": 100, "aliquota_ipi": 5},
              {"produto_id": 9101, "sku": "MP-ORDEM", "descricao": "Chapa da ordem", "quantidade": 10, "valor_unitario": 120, "aliquota_ipi": 5}],
    "parcelas": [{"dias": 30, "vencimento": "2026-12-02", "valor": 600, "meio_pagamento": "15", "observacao": null},
                 {"dias": 60, "vencimento": "2027-01-01", "valor": 650, "meio_pagamento": "77", "observacao": null}]
  }]
}$$::jsonb);
reset role;

select pg_temp.esperar(
  (select ultimo_erro is null from integracao_robo where integracao_id = current_setting('teste.robo')::uuid),
  'robô grava as ordens sem erro');
select set_config('teste.compra', (select id::text from pedidos_compra where tiny_id = 900), false);
select pg_temp.esperar(
  (select etapa = 'aprovado' and numero_tiny = '900' and situacao_tiny = 3 and valor_frete = 50 and frete_por_conta = 'R'
     and empresa_id = current_setting('teste.industria')::uuid
   from pedidos_compra where tiny_id = 900),
  'ordem em andamento no Tiny vira pedido aprovado da empresa do Tiny');
select pg_temp.esperar(
  (select f.nome = 'FORNECEDOR DA ORDEM' from pedidos_compra p join fornecedores f on f.id = p.fornecedor_id where p.tiny_id = 900),
  'fornecedor vem do Tiny');
select pg_temp.esperar(
  (select count(*) = 1 and sum(quantidade) = 20 and max(valor_unitario) = 110 and max(aliquota_ipi) = 5
   from pedido_compra_itens where pedido_id = current_setting('teste.compra')::uuid),
  'produto repetido é somado, com o preço médio');
select pg_temp.esperar(
  (select string_agg(valor || ':' || coalesce(meio_pagamento, '-'), ',' order by vencimento)
   from pedido_compra_parcelas where pedido_id = current_setting('teste.compra')::uuid) = '600.00:15,650.00:-',
  'parcelas vêm do Tiny (meio de pagamento desconhecido fica vazio)');
select pg_temp.esperar(
  not (select pendente from integracao_fila where tipo = 'compra' and id_externo = 900),
  'ordem lida sai da fila');

-- Aqui o pedido do Tiny não muda.
select pg_temp.esperar_erro(
  $$update pedidos_compra set observacoes = 'mudei aqui' where tiny_id = 900$$,
  'vem do Tiny', 'pedido do Tiny não é editado aqui');
select pg_temp.esperar_erro(
  $$delete from pedido_compra_parcelas where pedido_id = current_setting('teste.compra')::uuid$$,
  'vem do Tiny', 'parcelas do pedido do Tiny não mudam aqui');

-- No Tiny a ordem foi atendida e mudou o frete: o pedido segue, com histórico.
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), $${
  "compras": [{
    "id": 900, "numero": "900", "data": "2026-11-02", "data_prevista": "2026-11-21", "situacao": 1,
    "fornecedor": {"id": 9001, "nome": "FORNECEDOR DA ORDEM", "documento": "22.333.444/0001-55"},
    "frete": 70, "desconto": 0, "frete_por_conta": "R",
    "itens": [{"produto_id": 9101, "sku": "MP-ORDEM", "quantidade": 20, "valor_unitario": 110, "aliquota_ipi": 5}],
    "parcelas": [{"dias": 30, "vencimento": "2026-12-02", "valor": 1270}]
  }]
}$$::jsonb);
reset role;
select pg_temp.esperar(
  (select etapa = 'recebido' and valor_frete = 70 and data_prevista = '2026-11-21' and situacao_tiny = 1
   from pedidos_compra where tiny_id = 900),
  'ordem atendida no Tiny vira recebido aqui');
select pg_temp.esperar(
  (select count(*) = 1 from pedido_compra_historico
   where pedido_id = current_setting('teste.compra')::uuid and etapa = 'recebido' and observacao = 'Situação mudou no Tiny'),
  'mudança de situação fica no histórico');
select pg_temp.esperar(
  (select count(*) = 1 from pedido_compra_parcelas where pedido_id = current_setting('teste.compra')::uuid),
  'parcelas são trocadas pelas do Tiny');

-- Apagada no Tiny: fica cancelada.
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'),
  '{"removidos": [{"tipo": "compra", "id": 900}]}'::jsonb);
reset role;
select pg_temp.esperar(
  (select etapa = 'cancelado' from pedidos_compra where tiny_id = 900),
  'ordem apagada no Tiny fica cancelada');

-- Pedido lançado aqui segue as regras de antes.
select pg_temp.esperar_erro(
  $$insert into pedidos_compra (empresa_id, etapa) values (current_setting('teste.industria')::uuid, 'aprovado')$$,
  'nasce na etapa', 'pedido lançado aqui ainda nasce em Criação');

select pg_temp.esperar(
  (select numero_tiny = '900' and situacao_tiny = 2 from pedidos_compra_resumo where tiny_id = 900),
  'resumo das telas mostra o número e a situação do Tiny');
