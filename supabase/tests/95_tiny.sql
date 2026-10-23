-- Testes da leitura do Tiny: chaves do aplicativo, chave do robô, lote com
-- contas, categorias, títulos a receber e a pagar, pedidos e a fila.
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

-- A Diretoria (pcp@teste virou Diretoria nos testes anteriores) cola as chaves e liga a conta (o retorno da autorização grava assim).
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar_erro(
  $$select salvar_aplicativo_tiny(current_setting('teste.industria')::uuid, 'curto', 'x')$$,
  'completos', 'chaves incompletas são recusadas');
select salvar_aplicativo_tiny(current_setting('teste.industria')::uuid, 'tiny-api-cliente-teste', 'segredo-do-aplicativo');
select pg_temp.esperar((select client_id from aplicativo_tiny()) = 'tiny-api-cliente-teste', 'tela vê o Client ID');
select pg_temp.esperar(
  (select client_secret from credenciais_tiny(current_setting('teste.industria')::uuid)) = 'segredo-do-aplicativo',
  'servidor lê o segredo para trocar o código');
select set_config('teste.tiny',
  salvar_integracao(current_setting('teste.industria')::uuid, 'tiny', 'tiny', 'Tiny Venner', 'acesso-1', 'renova-1', now() + interval '4 hours')::text,
  false);
select set_config('teste.chave', preparar_robo_tiny(current_setting('teste.tiny')::uuid, 'https://venner.exemplo.dev'), false);
select pg_temp.esperar(length(current_setting('teste.chave')) = 64, 'chave do robô gerada pelo banco');
select pg_temp.esperar_erro($$select * from integracao_robo$$, 'permission denied', 'tela não lê a chave direto');
select pg_temp.esperar_erro($$select tiny_aplicar(current_setting('teste.tiny')::uuid, '{}')$$, 'permission denied',
  'função interna fechada');

-- O robô entra sem login, só com a chave.
set role anon;
reset request.jwt.claim.sub;
select pg_temp.esperar_erro($$select robo_tiny_inicio(current_setting('teste.tiny')::uuid, repeat('0', 64))$$, 'não confere',
  'chave errada não lê nada');
select set_config('teste.inicio', robo_tiny_inicio(current_setting('teste.tiny')::uuid, current_setting('teste.chave'))::text, false);
select pg_temp.esperar(
  (current_setting('teste.inicio')::jsonb ->> 'client_secret') = 'segredo-do-aplicativo'
  and (current_setting('teste.inicio')::jsonb ->> 'access_token') = 'acesso-1',
  'robô recebe o acesso e as chaves do aplicativo');
select pg_temp.esperar_erro($$select robo_tiny_inicio(current_setting('teste.tiny')::uuid, current_setting('teste.chave'))$$,
  'em andamento', 'uma leitura por vez');
select robo_tiny_tokens(current_setting('teste.tiny')::uuid, current_setting('teste.chave'), 'acesso-2', 'renova-2', now() + interval '4 hours');

select pg_temp.esperar(
  (robo_tiny_aplicar(current_setting('teste.tiny')::uuid, current_setting('teste.chave'), $${
    "contas": [{"id": 501, "descricao": "Venner C6 BANK", "ativa": true}],
    "categorias": [
      {"id": 901, "descricao": "VENDA DISTRIBUIDOR", "grupo": "RECEBIMENTO", "tipo": "receita", "ativa": true},
      {"id": 902, "descricao": "ALUGUEL MENSAL", "grupo": "ADMINISTRATIVO", "tipo": "despesa", "ativa": true},
      {"id": 903, "descricao": "TARIFA ANTIGA - NÃO USAR", "grupo": "BANCARIO", "tipo": "despesa", "ativa": false}
    ],
    "listados": [
      {"tipo": "receber", "id": 1, "assinatura": "a"}, {"tipo": "receber", "id": 2, "assinatura": "a"},
      {"tipo": "pagar", "id": 10, "assinatura": "a"}, {"tipo": "pedido", "id": 100, "assinatura": "a"}
    ],
    "pedidos": [
      {"id": 100, "numero": "301", "data": "2026-10-01", "data_prevista": "2026-10-20", "situacao": 3, "vendedor": "CRISTIANE",
       "nota": "000446", "condicao": "30/60", "prazo_dias": 45, "observacao": null, "canal": "venda_direta",
       "cliente": {"id": 7001, "nome": "TECIDOS MIGUEL SA", "documento": "12.345.678/0001-90", "uf": "sp", "ie": "123.456.789.000",
                   "logradouro": "Rua A", "numero": "10", "bairro": "Centro", "cep": "01.234-567"},
       "frete": 50, "desconto": 10, "transportadora": "TRANSPORTES Y", "original": {"naturezaOperacao": {"nome": "Venda"}},
       "itens": [{"produto_id": 3001, "sku": "10001", "descricao": "KIT VARÃO 1,50 BRANCO", "quantidade": 5, "valor_unitario": 7.5},
                 {"produto_id": 3001, "sku": "10001", "descricao": "KIT VARÃO 1,50 BRANCO", "quantidade": 5, "valor_unitario": 8.5},
                 {"produto_id": 3002, "sku": "PA1", "descricao": "Produto já cadastrado", "quantidade": 2, "valor_unitario": 100}]},
      {"id": 101, "numero": "2000123456", "numero_loja": "2000123456", "canal": "mercado_livre", "data": "2026-10-02", "situacao": 6,
       "cliente": {"id": 7002, "nome": "Ana Compradora", "documento": "123.456.789-01"},
       "itens": [{"produto_id": 3001, "sku": "10001", "descricao": "KIT", "quantidade": 1, "valor_unitario": 30}]}
    ],
    "produtos": [{"produto_id": 3003, "sku": "MP9", "descricao": "Matéria-prima do Tiny", "tipo_item": "materia_prima",
                  "unidade": "kg", "ncm": "3901.10.10", "peso": 1, "preco": 12.5},
                 {"produto_id": 3002, "sku": "PA1", "preco": 99, "ncm": "12345678"}],
    "receber": [
      {"id": 1, "situacao": "pago", "emissao": "2026-10-05", "vencimento": "2026-10-12", "liquidacao": "2026-10-13",
       "valor": 1500, "valor_pago": 1500, "descricao": "Ref. pedido nº 301", "documento": "000446", "conta_id": 501,
       "categoria_id": 901, "categoria_nome": "VENDA DISTRIBUIDOR",
       "contato": {"id": 7001, "nome": "TECIDOS MIGUEL SA", "documento": "12345678000190"}},
      {"id": 2, "situacao": "parcial", "emissao": "2026-10-05", "vencimento": "2026-11-12", "valor": 800, "valor_pago": 300,
       "saldo": 500, "descricao": "Parcela 2", "categoria_id": 902, "categoria_nome": "ALUGUEL MENSAL",
       "contato": {"id": 7001, "nome": "TECIDOS MIGUEL SA"}},
      {"id": 3, "situacao": "pago", "emissao": "2025-11-05", "vencimento": "2025-12-12", "valor": 99, "valor_pago": 99,
       "descricao": "Antigo", "contato": {"id": 7001}},
      {"id": 4, "situacao": "cancelado", "emissao": "2026-10-05", "vencimento": "2026-10-12", "valor": 10, "descricao": "Cancelado",
       "contato": {"id": 7001}}
    ],
    "pagar": [
      {"id": 10, "situacao": "pago", "emissao": "2026-09-01", "vencimento": "2026-09-10", "valor": 4200, "valor_pago": 4200,
       "descricao": "Aluguel setembro", "categoria_id": 902, "categoria_nome": "ALUGUEL MENSAL",
       "contato": {"id": 8001, "nome": "IMOBILIARIA X", "documento": "98765432000110"}},
      {"id": 11, "situacao": "aberto", "emissao": "2026-10-01", "vencimento": "2026-11-10", "valor": 4200,
       "descricao": "Aluguel novembro", "categoria_id": 902, "categoria_nome": "ALUGUEL MENSAL",
       "contato": {"id": 8001, "nome": "IMOBILIARIA X", "documento": "98765432000110"}}
    ],
    "estado": {"receber": {"desde": "2026-10-22 21:00:00", "offset": 0}},
    "historico_desde": "2026-01-01"
  }$$::jsonb) ->> 'pedidos')::integer = 2,
  'lote gravado');

reset role;

select pg_temp.esperar(
  (select tiny_id from contas_bancarias where nome = 'Venner C6 BANK' and empresa_id = current_setting('teste.industria')::uuid) = 501,
  'conta financeira do Tiny vira conta bancária');
select pg_temp.esperar(
  (select string_agg(f.codigo || '=' || f.nome || '<' || p.nome || ':' || f.ativa, ',' order by f.tiny_id)
   from plano_contas f join plano_contas p on p.id = f.pai_id where f.tiny_id is not null)
  ~ '^\d+\.01=VENDA DISTRIBUIDOR<RECEBIMENTO:true,\d+\.01=ALUGUEL MENSAL<ADMINISTRATIVO:true,\d+\.01=TARIFA ANTIGA - NÃO USAR<BANCARIO:false$',
  'grupos viram categorias mães e NÃO USAR entra inativa');

select pg_temp.esperar(
  (select situacao || '|' || valor_recebido || '|' || data_recebimento || '|' || b.nome || '|' || c.nome
   from contas_receber r join contas_bancarias b on b.id = r.conta_bancaria_id join plano_contas c on c.id = r.categoria_id
   where r.tiny_id = 1) = 'pago|1500.00|2026-10-13|Venner C6 BANK|VENDA DISTRIBUIDOR',
  'recebido entra pago na conta e categoria do Tiny');
select pg_temp.esperar(
  (select pedido_id = (select id from pedidos_venda where tiny_id = 100) from contas_receber where tiny_id = 1),
  'título ligado ao pedido pela nota fiscal');
select pg_temp.esperar(
  (select situacao = 'aberto' and categoria_id is null and observacao like 'Recebido em parte no Tiny: R$ 300%'
   from contas_receber where tiny_id = 2),
  'parcial fica em aberto com a anotação; categoria de despesa não entra no receber');
select pg_temp.esperar(not exists (select 1 from contas_receber where tiny_id in (3, 4)),
  'pago antes de 2026 e cancelado novo não entram');
select pg_temp.esperar(
  (select documento || '|' || uf from clientes where tiny_id = 7001) = '12345678000190|SP'
  and (select count(*) from clientes where tiny_id = 7001) = 1,
  'cliente criado uma vez, com CNPJ limpo');

select pg_temp.esperar(
  (select situacao || '|' || b.nome from contas_pagar p join contas_bancarias b on b.id = p.conta_bancaria_id where p.tiny_id = 10)
  = 'pago|Tiny · conta não informada',
  'pago sem conta informada vai para a conta reserva do Tiny');
select pg_temp.esperar(
  (select f.documento from contas_pagar p join fornecedores f on f.id = p.fornecedor_id where p.tiny_id = 11) = '98765432000110',
  'fornecedor com CNPJ');

select pg_temp.esperar(
  (select p.numero_externo || '|' || p.nota_fiscal || '|' || p.vendedor_externo || '|' || e.nome || '|' || p.prazo_recebimento_dias
   from pedidos_venda p join etapas_pedido e on e.id = p.etapa_id where p.tiny_id = 100)
  = '301|446|CRISTIANE|Aprovado|45',
  'pedido do Tiny com nota, vendedor e etapa');
select pg_temp.esperar(
  (select string_agg(i.codigo || '=' || pi.quantidade::numeric(10, 0) || 'x' || pi.preco_unitario::numeric(10, 2), ',' order by i.codigo)
   from pedido_venda_itens pi join itens i on i.id = pi.item_id join pedidos_venda p on p.id = pi.pedido_id where p.tiny_id = 100)
  = '10001=10x8.00,PA1=2x100.00',
  'itens somados por produto; SKU novo vira cadastro');
select pg_temp.esperar((select tiny_id from itens where codigo = 'PA1') = 3002, 'produto existente ganha o número do Tiny');
select pg_temp.esperar(
  (select tipo || '|' || unidade || '|' || ncm || '|' || preco_venda from itens where codigo = 'MP9') = 'materia_prima|KG|39011010|12.50',
  'produto novo do Tiny com tipo, unidade, NCM e preço');
select pg_temp.esperar(
  (select ie_ok from (select inscricao_estadual = '123.456.789.000' and cep = '01234567' and logradouro = 'Rua A' as ie_ok
   from clientes where tiny_id = 7001) x),
  'cliente com IE e endereço');
select pg_temp.esperar(
  (select valor_frete || '|' || valor_desconto || '|' || transportadora || '|' || (dados_tiny -> 'naturezaOperacao' ->> 'nome')
   from pedidos_venda where tiny_id = 100) = '50.00|10.00|TRANSPORTES Y|Venda',
  'pedido guarda frete, desconto, transportadora e a cópia do Tiny');
select pg_temp.esperar(
  (select canal || '|' || e.nome from pedidos_venda p join etapas_pedido e on e.id = p.etapa_id where p.tiny_id = 101)
  = 'mercado_livre|Entregue',
  'pedido da loja entra com o canal');
select pg_temp.esperar(
  (select count(*) from integracao_fila where integracao_id = current_setting('teste.tiny')::uuid and pendente) = 0,
  'lidos saem da fila');
select pg_temp.esperar(
  (select access_token from integracoes_plataforma where id = current_setting('teste.tiny')::uuid) = 'acesso-2'
  and (select executando_ate is null and ultimo_erro is null and estado ? 'receber'
       from integracao_robo where integracao_id = current_setting('teste.tiny')::uuid),
  'acesso renovado, leitura liberada e estado guardado');

-- A fábrica avança o pedido aqui; o Tiny dizendo "aprovado" não faz voltar.
update pedidos_venda set etapa_id = (select id from etapas_pedido where nome = 'Preparando envio') where tiny_id = 100;
-- Recebimento lançado aqui não volta para aberto pelo Tiny.
update contas_receber set situacao = 'pago', data_recebimento = '2026-11-01', valor_recebido = 800,
  conta_bancaria_id = (select id from contas_bancarias where tiny_id = 501) where tiny_id = 2;

set role anon;
select robo_tiny_inicio(current_setting('teste.tiny')::uuid, current_setting('teste.chave'));
select robo_tiny_aplicar(current_setting('teste.tiny')::uuid, current_setting('teste.chave'), $${
  "listados": [{"tipo": "receber", "id": 2, "assinatura": "b"}, {"tipo": "pagar", "id": 10, "assinatura": "a"},
               {"tipo": "pagar", "id": 12, "assinatura": "a"}],
  "receber": [{"id": 2, "situacao": "aberto", "emissao": "2026-10-05", "vencimento": "2026-11-12", "valor": 800,
               "descricao": "Parcela 2", "contato": {"id": 7001}}],
  "pedidos": [{"id": 100, "numero": "301", "data": "2026-10-01", "situacao": 3, "cliente": {"id": 7001},
               "itens": [{"produto_id": 3001, "sku": "10001", "quantidade": 4, "valor_unitario": 8}]}],
  "falhas": [{"tipo": "pagar", "id": 12, "erro": "Tiny fora do ar"}],
  "removidos": [{"tipo": "pagar", "id": 11}]
}$$::jsonb);
reset role;

select pg_temp.esperar((select situacao from contas_receber where tiny_id = 2) = 'pago', 'recebimento daqui é mantido');
select pg_temp.esperar(
  (select e.nome from pedidos_venda p join etapas_pedido e on e.id = p.etapa_id where p.tiny_id = 100) = 'Preparando envio',
  'etapa marcada aqui não volta');
select pg_temp.esperar(
  (select sum(quantidade) from pedido_venda_itens pi join pedidos_venda p on p.id = pi.pedido_id where p.tiny_id = 100) = 4,
  'itens refeitos com a versão do Tiny');
select pg_temp.esperar((select situacao from contas_pagar where tiny_id = 11) = 'cancelado', 'apagado no Tiny é cancelado aqui');
select pg_temp.esperar(
  (select pendente and tentativas = 1 and erro = 'Tiny fora do ar' from integracao_fila
   where integracao_id = current_setting('teste.tiny')::uuid and tipo = 'pagar' and id_externo = 12),
  'falha fica pendente para tentar de novo');
select pg_temp.esperar(
  (select not pendente from integracao_fila where integracao_id = current_setting('teste.tiny')::uuid and tipo = 'pagar' and id_externo = 10),
  'listado sem mudança não volta para a fila');

-- Tela de integrações.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(
  (select (importados ->> 'pedidos')::integer = 2 and (pendentes ->> 'pagar')::integer = 1 and ler_pagar_ate = '2026-11-02'
   from situacao_tiny()),
  'situação mostra importados e pendentes');
select ajustar_robo_tiny(current_setting('teste.tiny')::uuid, null);
select pg_temp.esperar(
  (select jsonb_array_length(robo_tiny_inicio(current_setting('teste.tiny')::uuid, current_setting('teste.chave')) -> 'pendentes')) = 0,
  'sem ler contas a pagar, pendentes do pagar ficam de fora');
select pg_temp.esperar(chave_robo_tiny(current_setting('teste.tiny')::uuid) = current_setting('teste.chave'), 'botão Ler agora usa a chave');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar_erro($$select chave_robo_tiny(current_setting('teste.tiny')::uuid)$$, 'sem permissão', 'Compras não lê a chave');
select pg_temp.esperar_erro(
  $$select credenciais_tiny(current_setting('teste.industria')::uuid)$$, 'não pode ligar', 'Compras não lê o segredo');
reset role;
