-- Testes do pedido com os campos do Tiny: cópia do Tiny preenchendo campos,
-- cadastros e parcelas; cadastros diários do robô; pedido lançado pela tela.
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

select set_config('teste.tiny', id::text, false) from integracoes_plataforma where canal = 'tiny';
select set_config('teste.chave', chave, false) from integracao_robo where integracao_id = current_setting('teste.tiny')::uuid;
select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';

select pg_temp.esperar(
  (select string_agg(nome, ',' order by ordem) from etapas_pedido where ativa and situacao_tiny is not null)
    = 'Em aberto,Dados incompletos,Aprovado,Preparando envio,Faturado,Pronto para envio,Enviado,Não entregue,Entregue,Em devolução,Cancelado',
  'etapas são as situações do Tiny');
select pg_temp.esperar(not exists (select 1 from etapas_pedido where ativa and nome in ('Emitido', 'Montagem', 'Em trânsito')),
  'etapas provisórias saíram de uso');

-- Robô: cadastros do dia (vendedores, formas, listas com preço próprio).
set role anon;
select pg_temp.esperar_erro(
  $$select robo_tiny_cadastros(current_setting('teste.tiny')::uuid, 'chave-errada-chave-errada-chave-errada-123', '{}')$$,
  'não confere', 'cadastros do robô exigem a chave');
select pg_temp.esperar(
  robo_tiny_cadastros(current_setting('teste.tiny')::uuid, current_setting('teste.chave'), $${
    "vendedores": [{"id": 51, "nome": "CRISTIANE", "email": "cris@teste", "ativo": true}, {"id": 52, "nome": "ANTIGO", "ativo": false}],
    "formas_pagamento": [{"id": 61, "nome": "Boleto", "ativo": true}],
    "formas_envio": [{"id": 71, "nome": "Transportadora", "ativo": true}],
    "listas_preco": [{"id": 81, "nome": "Distribuidor", "acrescimo_desconto": -10,
                      "precos": [{"produto_id": 3001, "preco": 6.9}, {"produto_id": 999999, "preco": 1}]}]
  }$$::jsonb) = '{"vendedores": 2, "formas_pagamento": 1, "formas_envio": 1, "listas_preco": 1}'::jsonb,
  'robô grava os cadastros do Tiny');
reset role;
select pg_temp.esperar(
  (select l.acrescimo_desconto = -10 and count(li.*) = 1 and max(li.preco) = 6.9
   from listas_preco l left join lista_preco_itens li on li.lista_id = l.id where l.tiny_id = 81 group by l.id),
  'lista de preço com o preço próprio do produto que existe aqui');
select pg_temp.esperar((select not ativo from vendedores where tiny_id = 52), 'vendedor inativo no Tiny fica inativo');

-- Pedido lido com a cópia completa do Tiny.
update integracao_robo set executando_ate = null where integracao_id = current_setting('teste.tiny')::uuid;
set role anon;
select robo_tiny_inicio(current_setting('teste.tiny')::uuid, current_setting('teste.chave'));
select robo_tiny_aplicar(current_setting('teste.tiny')::uuid, current_setting('teste.chave'), $${
  "pedidos": [{"id": 200, "numero": "350", "data": "2026-10-20", "situacao": 0, "cliente": {"id": 7001}, "condicao": "28/56",
    "itens": [{"produto_id": 3001, "sku": "10001", "quantidade": 10, "valor_unitario": 6.9}],
    "original": {"id": 200, "numeroPedido": 350, "situacao": 0, "numeroOrdemCompra": "OC-77", "valorOutrasDespesas": 12.5,
      "observacoesInternas": "Cliente pediu entrega pela manhã", "dataEnvio": "", "dataEntrega": "0000-00-00",
      "vendedor": {"id": 51, "nome": "CRISTIANE"}, "listaPreco": {"id": 81, "nome": "Distribuidor"},
      "naturezaOperacao": {"id": 91, "nome": "Venda de mercadoria"},
      "transportador": {"id": 7100, "nome": "TRANSPORTES SUL", "fretePorConta": "D", "formaEnvio": {"id": 71, "nome": "Transportadora"},
                        "codigoRastreamento": "AB123"},
      "enderecoEntrega": {"endereco": "Rua das Flores", "numero": "10", "municipio": "Recife", "uf": "pe", "cep": "50.000-000",
                          "nomeDestinatario": "Depósito Norte"},
      "pagamento": {"formaRecebimento": {"id": 61, "nome": "Boleto"}, "condicaoPagamento": "28/56",
                    "parcelas": [{"dias": 28, "data": "2026-11-17", "valor": 34.5, "formaRecebimento": {"id": 61, "nome": "Boleto"}},
                                 {"dias": 56, "data": "2026-12-15", "valor": 34.5, "observacoes": "segunda"}]},
      "itens": [{"produto": {"id": 3001, "sku": "10001"}, "quantidade": 10, "valorUnitario": 6.9, "infoAdicional": "Cor branca"}]}}]
}$$::jsonb);
reset role;

select pg_temp.esperar(
  (select p.numero_ordem_compra || '|' || p.valor_outras_despesas || '|' || p.frete_por_conta || '|' || p.codigo_rastreamento
     || '|' || v.nome || '|' || l.nome || '|' || n.nome || '|' || t.nome || '|' || f.nome || '|' || fp.nome || '|' || e.nome
     || '|' || (p.data_envio is null) || '|' || (p.endereco_entrega ->> 'uf') || '|' || (p.endereco_entrega ->> 'cep')
   from pedidos_venda p
   join vendedores v on v.id = p.vendedor_cadastro_id join listas_preco l on l.id = p.lista_preco_id
   join naturezas_operacao n on n.id = p.natureza_operacao_id join transportadoras t on t.id = p.transportadora_id
   join formas_envio f on f.id = p.forma_envio_id join formas_pagamento fp on fp.id = p.forma_pagamento_id
   join etapas_pedido e on e.id = p.etapa_id
   where p.tiny_id = 200)
  = 'OC-77|12.50|D|AB123|CRISTIANE|Distribuidor|Venda de mercadoria|TRANSPORTES SUL|Transportadora|Boleto|Em aberto|true|PE|50000000',
  'cópia do Tiny preenche os campos e liga os cadastros');
select pg_temp.esperar(
  (select string_agg(pp.numero || ':' || pp.dias || ':' || pp.vencimento || ':' || pp.valor || ':' || coalesce(pp.observacao, '-'), ',' order by pp.numero)
   from pedido_parcelas pp join pedidos_venda p on p.id = pp.pedido_id where p.tiny_id = 200)
  = '1:28:2026-11-17:34.50:-,2:56:2026-12-15:34.50:segunda',
  'parcelas do Tiny');
select pg_temp.esperar(
  (select info_adicional from pedido_venda_itens pi join pedidos_venda p on p.id = pi.pedido_id where p.tiny_id = 200) = 'Cor branca',
  'informação adicional do item');
select pg_temp.esperar((select dias from condicoes_pagamento where nome = '28/56') = '{28,56}', 'condição de pagamento cadastrada com os dias');

-- Comercial lança pelo sistema com os campos novos.
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Comercial') where email = 'comercial@teste';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.esperar((select count(*) from vendedores) = 2 and (select count(*) from transportadoras) = 1, 'comercial vê os cadastros');
insert into transportadoras (nome, documento) values ('TRANSPORTE NOVO', '12345678000199');
select set_config('teste.pedido', salvar_pedido_venda(jsonb_build_object(
  'empresa_id', current_setting('teste.industria'),
  'cliente_id', (select id from clientes where tiny_id = 7001),
  'data_pedido', '2026-10-24', 'prazo_entrega', '2026-11-10', 'condicao_pagamento', '28/56',
  'vendedor_cadastro_id', (select id from vendedores where tiny_id = 51),
  'lista_preco_id', (select id from listas_preco where tiny_id = 81),
  'natureza_operacao_id', (select id from naturezas_operacao where tiny_id = 91),
  'forma_pagamento_id', (select id from formas_pagamento where tiny_id = 61),
  'transportadora_id', (select id from transportadoras where nome = 'TRANSPORTE NOVO'),
  'frete_por_conta', 'R', 'valor_frete', 20, 'valor_desconto', 5, 'valor_outras_despesas', 0,
  'numero_ordem_compra', 'OC-1', 'observacao_interna', 'conferir estoque',
  'endereco_entrega', '{}'::jsonb,
  'parcelas', '[{"dias": 28, "vencimento": "2026-11-21", "valor": 50}, {"dias": 56, "vencimento": "2026-12-19", "valor": 49}]'::jsonb,
  'itens', jsonb_build_array(jsonb_build_object('item_id', (select id from itens where tiny_id = 3001), 'quantidade', 12,
                                                'preco_unitario', 7, 'info_adicional', 'embalar em caixa'))
))::text, false);
select pg_temp.esperar(
  (select p.numero_ordem_compra || '|' || p.frete_por_conta || '|' || p.valor_frete || '|' || t.nome || '|' || (p.endereco_entrega is null)
     || '|' || e.nome || '|' || (select count(*) from pedido_parcelas where pedido_id = p.id)
     || '|' || (select info_adicional from pedido_venda_itens where pedido_id = p.id)
   from pedidos_venda p join transportadoras t on t.id = p.transportadora_id join etapas_pedido e on e.id = p.etapa_id
   where p.id = current_setting('teste.pedido')::uuid)
  = 'OC-1|R|20.00|TRANSPORTE NOVO|true|Em aberto|2|embalar em caixa',
  'pedido lançado aqui com os campos do Tiny e as parcelas');
select pg_temp.esperar_erro(
  $$insert into transportadoras (nome, documento) values ('X', '123')$$, 'check', 'documento da transportadora com 11 ou 14 dígitos');
reset role;

-- Compras não vê os cadastros do comercial.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar((select count(*) from vendedores) = 0, 'compras não vê vendedores');
reset role;
