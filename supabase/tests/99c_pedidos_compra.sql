-- Testes dos pedidos de compra (etapas criação → orçamento → aprovação →
-- aprovado → recebido, travas e histórico) e da exigência de pedido aprovado
-- ou justificativa na nota do fornecedor. comprador@teste (Compras) vê só o
-- CNPJ 11111111000111; aprovador@teste é da Diretoria; financeiro@teste lança notas.
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

-- Perfil próprio do teste (o 40 mexe nas permissões do perfil Compras).
insert into perfis (nome, todas_empresas) values ('Comprador teste', false);
insert into perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'compras.pedidos', a.acao::acao_permissao
from perfis p cross join unnest(array['ver', 'criar', 'editar']) as a(acao)
where p.nome = 'Comprador teste';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000021', 'comprador@teste'),
  ('00000000-0000-0000-0000-000000000022', 'aprovador@teste');
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Comprador teste') where email = 'comprador@teste';
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Diretoria') where email = 'aprovador@teste';
insert into usuario_empresas (usuario_id, empresa_id)
select '00000000-0000-0000-0000-000000000021', id from empresas where cnpj = '11111111000111';
select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.comercio', id::text, false) from empresas where cnpj = '22222222000122';
select set_config('teste.mp1', id::text, false) from itens where codigo = 'MP1';
select set_config('teste.fornecedor', id::text, false) from fornecedores where documento = '44444444000144';
insert into fornecedores (tipo_pessoa, documento, nome) values ('juridica', '55555555000155', 'Aço Barato');
select set_config('teste.outro_fornecedor', id::text, false) from fornecedores where documento = '55555555000155';

create function pg_temp.pedido(empresa text) returns jsonb language sql as $$
  select jsonb_build_object(
    'empresa_id', empresa, 'condicao_pagamento', '30 dias', 'frete_por_conta', 'D', 'valor_frete', 20, 'valor_desconto', 5,
    'categoria_id', (select id from plano_contas where codigo = '3.01'),
    'itens', jsonb_build_array(
      jsonb_build_object('item_id', current_setting('teste.mp1'), 'quantidade', 100, 'valor_unitario', 2, 'aliquota_ipi', 10)),
    'parcelas', jsonb_build_array(jsonb_build_object('dias', 30, 'vencimento', '2026-12-01', 'valor', 235, 'meio_pagamento', '15')))
$$;

create function pg_temp.nota(numero text, extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'empresa_id', current_setting('teste.industria'), 'fornecedor_id', current_setting('teste.fornecedor'),
    'numero', numero, 'serie', '7', 'data_emissao', '2026-10-27', 'origem', 'manual', 'valor_total', 235,
    'parcelas', jsonb_build_array(jsonb_build_object('valor', 235, 'vencimento', '2026-12-01'))) || extra
$$;

-- Comprador cria o pedido no CNPJ liberado.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000021';
select set_config('teste.pedido', salvar_pedido_compra(pg_temp.pedido(current_setting('teste.industria')))::text, false);
select pg_temp.esperar(
  (select etapa || '|' || valor_itens || '|' || valor_ipi || '|' || valor_total from pedidos_compra_resumo where id = current_setting('teste.pedido')::uuid)
    = 'criacao|200.00|20.00|235.00',
  'pedido nasce em criação com total = itens + IPI + frete − desconto');
select pg_temp.esperar(
  (select count(*) from pedido_compra_parcelas where pedido_id = current_setting('teste.pedido')::uuid) = 1,
  'parcelas do pedido gravadas');
select pg_temp.esperar_erro(
  $$select salvar_pedido_compra(pg_temp.pedido(current_setting('teste.comercio')))$$,
  'não tem acesso', 'comprador não cria pedido em CNPJ não liberado');
select pg_temp.esperar_erro(
  $$select salvar_pedido_compra(pg_temp.pedido(current_setting('teste.industria')) - 'itens')$$,
  'pelo menos um produto', 'pedido sem produtos é recusado');
select pg_temp.esperar_erro(
  $$update pedidos_compra set etapa = 'aprovado'$$,
  'permission denied', 'etapa não muda direto na tabela');
select pg_temp.esperar_erro(
  $$select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'aprovado')$$,
  'não pode ir', 'não pula da criação para aprovado');

-- Orçamentos: pedir aprovação exige um orçamento escolhido.
select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'orcamento');
select pg_temp.esperar_erro(
  $$select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'aprovacao')$$,
  'escolha um', 'sem orçamento escolhido não vai para aprovação');
insert into pedido_compra_orcamentos (pedido_id, fornecedor_id, valor_total, prazo_entrega_dias, condicao_pagamento)
values (current_setting('teste.pedido')::uuid, current_setting('teste.outro_fornecedor')::uuid, 260, 10, '28 dias'),
       (current_setting('teste.pedido')::uuid, current_setting('teste.fornecedor')::uuid, 235, 7, '30/60 dias');
select escolher_orcamento_compra(id) from pedido_compra_orcamentos where valor_total = 235;
select pg_temp.esperar(
  (select fornecedor_id::text = current_setting('teste.fornecedor') and condicao_pagamento = '30/60 dias'
          and data_prevista = data_pedido + 7
   from pedidos_compra where id = current_setting('teste.pedido')::uuid),
  'orçamento escolhido define fornecedor, condição e data prevista');
select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'aprovacao');
select pg_temp.esperar_erro(
  $$select salvar_pedido_compra(pg_temp.pedido(current_setting('teste.industria')) || jsonb_build_object('id', current_setting('teste.pedido')))$$,
  'volte para Orçamento', 'pedido em aprovação não muda');
select pg_temp.esperar_erro(
  $$insert into pedido_compra_orcamentos (pedido_id, fornecedor_id, valor_total) values (current_setting('teste.pedido')::uuid, current_setting('teste.fornecedor')::uuid, 1)$$,
  'volte para Orçamento', 'orçamento não entra com pedido em aprovação');
select pg_temp.esperar_erro(
  $$select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'aprovado')$$,
  'não pode aprovar', 'comprador não aprova o próprio pedido');
reset role;

-- Financeiro tenta lançar a nota antes da aprovação.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar(
  (select count(*) from pedidos_compra where id = current_setting('teste.pedido')::uuid) = 1,
  'quem lança nota enxerga os pedidos de compra');
select pg_temp.esperar_erro(
  $$select registrar_nota_fornecedor(pg_temp.nota('5001', '{}'))$$,
  'justificativa', 'nota sem pedido e sem justificativa é recusada');
select pg_temp.esperar_erro(
  $$select registrar_nota_fornecedor(pg_temp.nota('5001', '{"justificativa_sem_pedido": "urgente"}'))$$,
  'justificativa', 'justificativa curta é recusada');
select pg_temp.esperar_erro(
  $$select registrar_nota_fornecedor(pg_temp.nota('5001', jsonb_build_object('pedido_compra_id', current_setting('teste.pedido'))))$$,
  'ainda não foi aprovado', 'nota com pedido não aprovado é recusada');
reset role;

-- Diretoria devolve com motivo, o comprador pede de novo e a diretoria aprova.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
select pg_temp.esperar_erro(
  $$select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'orcamento')$$,
  'motivo', 'devolver para orçamento exige motivo');
select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'orcamento', 'Negociar o frete');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000021';
select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'aprovacao');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'aprovado');
select pg_temp.esperar(
  (select etapa = 'aprovado' and aprovado_por = '00000000-0000-0000-0000-000000000022' and aprovado_em is not null
   from pedidos_compra where id = current_setting('teste.pedido')::uuid),
  'aprovação grava quem aprovou e quando');
reset role;

-- Nota ligada ao pedido aprovado marca o pedido como recebido.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar_erro(
  $$select registrar_nota_fornecedor(pg_temp.nota('5001', jsonb_build_object('pedido_compra_id', current_setting('teste.pedido'), 'fornecedor_id', current_setting('teste.outro_fornecedor'))))$$,
  'outro fornecedor', 'nota de outro fornecedor não liga ao pedido');
select set_config('teste.nota', registrar_nota_fornecedor(
  pg_temp.nota('5001', jsonb_build_object('pedido_compra_id', current_setting('teste.pedido'))))::text, false);
select pg_temp.esperar(
  (select etapa || '|' || quantidade_notas || '|' || valor_notas from pedidos_compra_resumo where id = current_setting('teste.pedido')::uuid)
    = 'recebido|1|235.00',
  'primeira nota marca o pedido como recebido');
select registrar_nota_fornecedor(pg_temp.nota('5002', '{"justificativa_sem_pedido": "Compra de balcão paga no ato, sem pedido"}'));
select pg_temp.esperar(
  (select count(*) from notas_fornecedor where numero = '5002' and pedido_compra_id is null and justificativa_sem_pedido like 'Compra de balcão%') = 1,
  'nota sem pedido entra com a justificativa');
reset role;

-- Diretoria não cancela pedido que já tem nota; histórico registra cada passo.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
select pg_temp.esperar_erro(
  $$select mudar_etapa_pedido_compra(current_setting('teste.pedido')::uuid, 'cancelado', 'Desistimos')$$,
  'não pode ir', 'pedido recebido não é cancelado');
select pg_temp.esperar(
  (select string_agg(etapa::text, ',' order by em) from historico_pedido_compra(current_setting('teste.pedido')::uuid))
    = 'criacao,orcamento,aprovacao,orcamento,aprovacao,aprovado,recebido',
  'histórico guarda todas as etapas');
select pg_temp.esperar(
  (select observacao from historico_pedido_compra(current_setting('teste.pedido')::uuid) where etapa = 'recebido') = 'NF 5001-7 lançada',
  'histórico diz qual nota recebeu o pedido');
reset role;

-- Comprador de outro CNPJ não vê o pedido.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000023', 'comprador2@teste');
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Comprador teste') where email = 'comprador2@teste';
insert into usuario_empresas (usuario_id, empresa_id)
select '00000000-0000-0000-0000-000000000023', id from empresas where cnpj = '22222222000122';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000023';
select pg_temp.esperar((select count(*) from pedidos_compra) = 0, 'pedido de outro CNPJ não aparece');
select pg_temp.esperar((select count(*) from pedido_compra_itens) = 0, 'itens de pedido de outro CNPJ não aparecem');
reset role;
