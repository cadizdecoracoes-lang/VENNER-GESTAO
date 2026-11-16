-- Testes da conferência com o Tiny: diferenças com o motivo, "Deixar igual
-- ao Tiny" e as notas fiscais lidas do Tiny.
\set ON_ERROR_STOP 1

-- Volta o bloqueio de título do Tiny (desligado do 95 ao 99q).
alter table contas_pagar enable trigger bloquear_titulo_tiny;
alter table contas_receber enable trigger bloquear_titulo_tiny;

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

select set_config('teste.robo', (select integracao_id::text from integracao_robo limit 1), false);
select set_config('teste.chave', (select chave from integracao_robo limit 1), false);

-- O robô lista e lê dois títulos a pagar e uma nota de saída sem pedido aqui.
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), $${
  "listados": [{"tipo": "pagar", "id": 501, "assinatura": "aberto|100|100|2026-12-10|2026-11-16 10:00:00"},
               {"tipo": "pagar", "id": 502, "assinatura": "aberto|250.5|250.5|2026-12-15|2026-11-16 10:00:00"}],
  "pagar": [{"id": 501, "situacao": "aberto", "emissao": "2026-11-10", "vencimento": "2026-12-10", "valor": 100,
             "descricao": "Conferência 501", "contato": {"id": 8501, "nome": "FORNECEDOR CONFERENCIA"}},
            {"id": 502, "situacao": "aberto", "emissao": "2026-11-10", "vencimento": "2026-12-15", "valor": 250.5,
             "descricao": "Conferência 502", "contato": {"id": 8501, "nome": "FORNECEDOR CONFERENCIA"}}],
  "notas": [{"id": 7001, "tipo": "S", "numero": "123", "serie": "1", "chave": null, "situacao": 6, "emissao": "2026-11-12",
             "contato_nome": "CLIENTE DA NOTA", "contato_documento": null, "valor": 999.9, "origem_tipo": "venda",
             "origem_id": "1", "pedido_ecommerce": null},
            {"id": 7002, "tipo": "E", "numero": "55", "serie": "1", "chave": null, "situacao": 6, "emissao": "2026-11-12",
             "contato_nome": "FORNECEDOR DA NOTA", "contato_documento": null, "valor": 300, "origem_tipo": "pedido_compra",
             "origem_id": "900", "pedido_ecommerce": null}]
}$$::jsonb);
reset role;
select pg_temp.esperar(
  (select ultimo_erro is null from integracao_robo where integracao_id = current_setting('teste.robo')::uuid),
  'robô grava títulos e notas sem erro');
select pg_temp.esperar((select count(*) = 2 from notas_tiny where tiny_id in (7001, 7002)), 'notas do Tiny gravadas');

-- Mesmo lote de novo não regrava a nota (não acorda as telas à toa).
select set_config('teste.lida', (select lida_em::text from notas_tiny where tiny_id = 7001), false);
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), $${
  "notas": [{"id": 7001, "tipo": "S", "numero": "123", "serie": "1", "chave": null, "situacao": 6, "emissao": "2026-11-12",
             "contato_nome": "CLIENTE DA NOTA", "contato_documento": null, "valor": 999.9, "origem_tipo": "venda",
             "origem_id": "1", "pedido_ecommerce": null}]
}$$::jsonb);
reset role;
select pg_temp.esperar(
  (select lida_em::text = current_setting('teste.lida') from notas_tiny where tiny_id = 7001),
  'nota sem mudança não é regravada');

-- Título do Tiny não se edita nem se exclui aqui.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar_erro($$update contas_pagar set valor = 90 where tiny_id = 501$$, 'vem do Tiny', 'título do Tiny não muda aqui');
select pg_temp.esperar_erro($$delete from contas_pagar where tiny_id = 502$$, 'vem do Tiny', 'título do Tiny não é excluído aqui');
reset role;

-- Como ficou de antes desse bloqueio: o valor do 501 mudado e o 502 excluído aqui.
alter table contas_pagar disable trigger bloquear_titulo_tiny;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update contas_pagar set valor = 90 where tiny_id = 501;
delete from contas_pagar where tiny_id = 502;
reset role;
alter table contas_pagar enable trigger bloquear_titulo_tiny;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';

select pg_temp.esperar(
  (select problema = 'diferente' and campos = 'valor' and motivo like 'Alterado aqui: valor%' and corrigivel
     and tiny_valor = 100 and venner_valor = 90
   from conferencia_tiny() where modulo = 'pagar' and tiny_id = 501),
  'valor mudado aqui aparece como diferente, com o motivo');
select pg_temp.esperar(
  (select problema = 'falta_aqui' and motivo like 'Excluído aqui em%' and corrigivel
   from conferencia_tiny() where modulo = 'pagar' and tiny_id = 502),
  'excluído aqui aparece como faltando, com quem excluiu');
select pg_temp.esperar(
  (select problema = 'falta_aqui' and referencia like 'NF 123%' from conferencia_tiny() where modulo = 'notas_saida' and tiny_id = 7001),
  'nota de saída sem pedido aqui aparece');
select pg_temp.esperar(
  (select problema = 'falta_aqui' from conferencia_tiny() where modulo = 'notas_entrada' and tiny_id = 7002),
  'nota de entrada sem nota de fornecedor aqui aparece');
select pg_temp.esperar(
  (select count(*) = 6 from conferencia_tiny_resumo()),
  'resumo traz os seis módulos da conta do Tiny');
select pg_temp.esperar(
  (select tiny_qtd >= 2 and tiny_valor >= 350.5 from conferencia_tiny_resumo() where modulo = 'pagar'),
  'resumo soma o que está em aberto no Tiny');

select pg_temp.esperar_erro($$select igualar_ao_tiny('notas_saida', '{7001}')$$, 'sem correção', 'nota não tem correção automática');

-- Deixar igual ao Tiny.
select pg_temp.esperar(
  (select (igualar_ao_tiny('pagar', '{501,502}') ->> 'igualados')::integer = 2),
  'dois títulos mandados igualar');
reset role;
select pg_temp.esperar(
  (select editado_aqui = '{}' from contas_pagar where tiny_id = 501),
  'proteção de alterado aqui sai');
select pg_temp.esperar(
  not exists (select 1 from tiny_excluidos where tipo = 'pagar' and tiny_id = 502),
  'proteção de excluído aqui sai');
select pg_temp.esperar(
  (select count(*) = 2 from integracao_fila where tipo = 'pagar' and id_externo in (501, 502) and pendente),
  'robô vai reler os dois');
select pg_temp.esperar(
  (select count(*) = 2 and bool_and(usuario_id is not null) from tiny_igualados where tipo = 'pagar' and tiny_id in (501, 502)),
  'fica o rastro de quem igualou');

-- O robô relê: os dois ficam iguais ao Tiny e saem da conferência.
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), $${
  "pagar": [{"id": 501, "situacao": "aberto", "emissao": "2026-11-10", "vencimento": "2026-12-10", "valor": 100,
             "descricao": "Conferência 501", "contato": {"id": 8501, "nome": "FORNECEDOR CONFERENCIA"}},
            {"id": 502, "situacao": "aberto", "emissao": "2026-11-10", "vencimento": "2026-12-15", "valor": 250.5,
             "descricao": "Conferência 502", "contato": {"id": 8501, "nome": "FORNECEDOR CONFERENCIA"}}]
}$$::jsonb);
reset role;
select pg_temp.esperar((select valor = 100 from contas_pagar where tiny_id = 501), 'valor volta ao do Tiny');
select pg_temp.esperar(exists (select 1 from contas_pagar where tiny_id = 502), 'título excluído aqui volta do Tiny');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(
  not exists (select 1 from conferencia_tiny() where modulo = 'pagar' and tiny_id in (501, 502)),
  'depois de igualar, nenhuma diferença nos dois');
reset role;

-- Baixa feita aqui antes do bloqueio fica até alguém mandar igualar.
alter table contas_pagar disable trigger bloquear_titulo_tiny;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update contas_pagar set situacao = 'pago', data_pagamento = '2026-11-16', valor_pago = 100,
  conta_bancaria_id = (select id from contas_bancarias where empresa_id = contas_pagar.empresa_id limit 1)
where tiny_id = 501;
reset role;
alter table contas_pagar enable trigger bloquear_titulo_tiny;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(
  (select problema = 'diferente' and campos = 'situação' and motivo like '%Alterado aqui: situação%'
   from conferencia_tiny() where modulo = 'pagar' and tiny_id = 501),
  'baixa feita aqui aparece como diferente');
select igualar_ao_tiny('pagar', '{501}');
reset role;
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), $${
  "pagar": [{"id": 501, "situacao": "aberto", "emissao": "2026-11-10", "vencimento": "2026-12-10", "valor": 100,
             "descricao": "Conferência 501", "contato": {"id": 8501, "nome": "FORNECEDOR CONFERENCIA"}}]
}$$::jsonb);
reset role;
select pg_temp.esperar((select situacao = 'aberto' from contas_pagar where tiny_id = 501), 'depois de igualar, a baixa daqui segue o Tiny');

-- Quem não tem a tela de integrações não vê nem corrige.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select pg_temp.esperar(not exists (select 1 from conferencia_tiny()), 'sem permissão não vê a conferência');
select pg_temp.esperar_erro($$select igualar_ao_tiny('pagar', '{501}')$$, 'Sem permissão', 'sem permissão não corrige');
reset role;

-- A conciliação continua baixando título do Tiny (o bloqueio não a impede),
-- e o conciliado fica fora do "Deixar igual ao Tiny".
select set_config('teste.empresa', (select empresa_id::text from contas_pagar where tiny_id = 501), false);
insert into contas_bancarias (empresa_id, nome) values (current_setting('teste.empresa')::uuid, 'Conta conferência');
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Conta conferência';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'conf.ofx',
  '[{"data": "2026-12-10", "descricao": "PAGTO FORNECEDOR", "valor": -100, "id_banco": "CF1"}]'::jsonb);
select conciliar_lancamento((select id from extrato_lancamentos where chave = 'id:CF1'),
  array[(select id from contas_pagar where tiny_id = 501)], '{}');
select pg_temp.esperar(
  (select situacao = 'pago' and conta_bancaria_id = current_setting('teste.conta')::uuid from contas_pagar where tiny_id = 501),
  'conciliação baixa o título do Tiny');
select pg_temp.esperar(
  (select (igualar_ao_tiny('pagar', '{501}') ->> 'conciliados')::integer = 1),
  'conciliado não é igualado');
select pg_temp.esperar(
  (select corrigivel = false from conferencia_tiny() where modulo = 'pagar' and tiny_id = 501),
  'diferença de título conciliado aparece sem correção');
reset role;
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), $${
  "pagar": [{"id": 501, "situacao": "aberto", "emissao": "2026-11-10", "vencimento": "2026-12-10", "valor": 100,
             "descricao": "Conferência 501", "contato": {"id": 8501, "nome": "FORNECEDOR CONFERENCIA"}}]
}$$::jsonb);
reset role;
select pg_temp.esperar((select situacao = 'pago' from contas_pagar where tiny_id = 501), 'Tiny em aberto não desfaz a conciliação');
