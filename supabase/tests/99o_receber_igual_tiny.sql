-- Testes das contas a receber iguais ao Tiny: a volta completa do robô relê
-- o que não apareceu, e a planilha do Tiny mostra e depois corrige a
-- situação (recebido / em aberto), mantendo o que foi recebido aqui.
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

-- Títulos lidos do Tiny em aberto (60, 61, 62) e um que veio pago (63).
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "listados": [{"tipo": "receber", "id": 60, "assinatura": "a"}, {"tipo": "receber", "id": 61, "assinatura": "a"},
               {"tipo": "receber", "id": 62, "assinatura": "a"}, {"tipo": "receber", "id": 63, "assinatura": "a"}],
  "receber": [
    {"id": 60, "situacao": "aberto", "emissao": "2026-09-20", "vencimento": "2026-10-01", "valor": 500,
     "descricao": "NF 500", "contato": {"id": 7101, "nome": "LOJA BOA LTDA"}},
    {"id": 61, "situacao": "aberto", "emissao": "2026-09-20", "vencimento": "2026-12-05", "valor": 600,
     "descricao": "NF 501", "contato": {"id": 7101, "nome": "LOJA BOA LTDA"}},
    {"id": 62, "situacao": "aberto", "emissao": "2026-09-20", "vencimento": "2026-10-07", "valor": 700,
     "descricao": "NF 502", "contato": {"id": 7101, "nome": "LOJA BOA LTDA"}},
    {"id": 63, "situacao": "pago", "emissao": "2026-09-20", "vencimento": "2026-10-09", "liquidacao": "2026-10-09",
     "valor": 800, "valor_pago": 800, "conta_id": 501, "descricao": "NF 503", "contato": {"id": 7101, "nome": "LOJA BOA LTDA"}}
  ]
}$$::jsonb);
update integracao_fila set pendente = false where tipo = 'receber' and id_externo between 60 and 63;

-- Lançado aqui (sem Tiny), em aberto e vencido.
insert into contas_receber (empresa_id, cliente_id, descricao, valor, vencimento)
values (current_setting('teste.industria')::uuid, (select id from clientes where nome = 'LOJA BOA LTDA'), 'Pedido nº 9', 77, '2026-10-02');

-- Volta completa do robô: o título em aberto que não apareceu nela é relido.
update integracao_fila set visto_em = now() - interval '1 day' where tipo = 'receber' and id_externo = 60;
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), jsonb_build_object(
  'listados', '[{"tipo": "receber", "id": 61, "assinatura": "a"}]'::jsonb,
  'receber_ciclo_inicio', (now() - interval '1 hour')::text));
reset role;
select pg_temp.esperar((select pendente from integracao_fila where tipo = 'receber' and id_externo = 60),
  'fim da volta: em aberto que não apareceu é relido');
select pg_temp.esperar((select not pendente from integracao_fila where tipo = 'receber' and id_externo = 61),
  'o que apareceu igual não é relido');

-- Recebido aqui pela Diretoria (fica como está).
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update contas_receber set situacao = 'pago', data_recebimento = '2026-10-08', valor_recebido = 700,
  conta_bancaria_id = (select id from contas_bancarias where tiny_id = 501)
where tiny_id = 62;

select set_config('teste.planilha', $$[
  {"cliente": "Loja  Boa Ltda", "vencimento": "2026-10-01", "valor": 500, "situacao": "pago",
   "recebimento": "2026-10-03", "valor_recebido": 500, "conta": "VENNER C6 BANK"},
  {"cliente": "LOJA BOA LTDA", "vencimento": "2026-12-05", "valor": 600, "situacao": "aberto"},
  {"cliente": "LOJA BOA LTDA", "vencimento": "2026-10-07", "valor": 700, "situacao": "aberto"},
  {"cliente": "LOJA BOA LTDA", "vencimento": "2026-10-09", "valor": 800, "situacao": "aberto"},
  {"cliente": "Ninguém", "vencimento": "2026-10-05", "valor": 1, "situacao": "pago"}
]$$, false);
select set_config('teste.previa',
  tiny_aplicar_planilha_receber(current_setting('teste.industria')::uuid, current_setting('teste.planilha')::jsonb)::text, false);
select pg_temp.esperar(
  (select (p ->> 'iguais')::integer = 1 and (p ->> 'corrigidos')::integer = 2
     and (p ->> 'para_recebido')::integer = 1 and (p ->> 'para_aberto')::integer = 1
     and jsonb_array_length(p -> 'mantidos') = 1 and jsonb_array_length(p -> 'nao_achados') = 1
     and p -> 'corrigir' -> 0 ->> 'de' = 'Vencido'
     and p -> 'corrigir' -> 0 ->> 'para' = 'Recebido em 03/10/2026 · Venner C6 BANK'
     and p -> 'corrigir' -> 1 ->> 'de' = 'Recebido em 09/10/2026 · Venner C6 BANK'
     and p -> 'corrigir' -> 1 ->> 'para' = 'Em aberto'
   from (select current_setting('teste.previa')::jsonb p) x),
  'prévia: quantos ficam recebidos, quantos voltam para aberto, mantidos e não achados');
select pg_temp.esperar(
  (select (p ->> 'so_aqui_total')::integer = jsonb_array_length(p -> 'so_aqui')
     and exists (select 1 from jsonb_array_elements_text(p -> 'so_aqui') s where s like 'LOJA BOA LTDA · venc. 02/10/2026 · R$ 77,00 · Pedido nº 9')
     and not exists (select 1 from jsonb_array_elements_text(p -> 'so_aqui') s where s like '%R$ 600,00%')
   from (select current_setting('teste.previa')::jsonb p) x),
  'em aberto aqui sem linha na planilha aparece para conferir');
select pg_temp.esperar((select situacao = 'aberto' from contas_receber where tiny_id = 60), 'prévia não grava nada');

select tiny_aplicar_planilha_receber(current_setting('teste.industria')::uuid, current_setting('teste.planilha')::jsonb, true);
reset role;
select pg_temp.esperar(
  (select situacao || '|' || data_recebimento || '|' || valor_recebido || '|' || b.nome
   from contas_receber r join contas_bancarias b on b.id = r.conta_bancaria_id where r.tiny_id = 60)
  = 'pago|2026-10-03|500.00|Venner C6 BANK',
  'recebido no Tiny fica recebido, com a data e a conta');
select pg_temp.esperar(
  (select situacao = 'aberto' and data_recebimento is null and conta_bancaria_id is null from contas_receber where tiny_id = 63),
  'em aberto no Tiny volta a ficar em aberto');
select pg_temp.esperar((select situacao = 'pago' and data_recebimento = '2026-10-08' from contas_receber where tiny_id = 62),
  'recebido aqui não muda pela planilha');
select pg_temp.esperar((select editado_aqui = '{}' from contas_receber where tiny_id = 60),
  'correção pela planilha não conta como mudança feita aqui');
select pg_temp.esperar((select situacao = 'aberto' from contas_receber where descricao = 'Pedido nº 9'),
  'lançado aqui sem par no Tiny não muda');

-- De novo: já está tudo igual.
set role authenticated;
select pg_temp.esperar(
  (tiny_aplicar_planilha_receber(current_setting('teste.industria')::uuid, current_setting('teste.planilha')::jsonb) ->> 'corrigidos')::integer = 0,
  'depois de corrigir, nada mais a corrigir');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.esperar_erro(
  $$select tiny_aplicar_planilha_receber(current_setting('teste.industria')::uuid, '[]'::jsonb, true)$$,
  'Sem permissão', 'sem editar contas a receber não corrige pela planilha');
reset role;
