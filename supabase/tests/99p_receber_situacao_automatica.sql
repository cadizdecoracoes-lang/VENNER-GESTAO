-- Testes do contas a receber igual à Olist sem planilha: no fim da volta o
-- robô relê o que está com situação diferente, e recebido que veio da Olist
-- volta para aberto; o recebido aqui fica.
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

-- 70 veio recebido da Olist; 71 em aberto; 72 em aberto e depois recebido aqui.
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "receber": [
    {"id": 70, "situacao": "pago", "emissao": "2026-09-20", "vencimento": "2026-10-01", "liquidacao": "2026-10-01",
     "valor": 910, "valor_pago": 910, "conta_id": 501, "descricao": "NF 700", "contato": {"id": 7201, "nome": "CLIENTE SETENTA"}},
    {"id": 71, "situacao": "aberto", "emissao": "2026-09-20", "vencimento": "2026-10-02", "valor": 920,
     "descricao": "NF 701", "contato": {"id": 7201, "nome": "CLIENTE SETENTA"}},
    {"id": 72, "situacao": "aberto", "emissao": "2026-09-20", "vencimento": "2026-10-03", "valor": 930,
     "descricao": "NF 702", "contato": {"id": 7201, "nome": "CLIENTE SETENTA"}}
  ]
}$$::jsonb);
update contas_receber set situacao = 'pago', data_recebimento = '2026-10-04', valor_recebido = 930,
  conta_bancaria_id = (select id from contas_bancarias where tiny_id = 501)
where tiny_id = 72;

-- A volta da Olist lista: 70 em aberto, 71 pago, 72 em aberto.
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), $${
  "listados": [{"tipo": "receber", "id": 70, "assinatura": "aberto|910|910|2026-10-01|"},
               {"tipo": "receber", "id": 71, "assinatura": "pago|920|0|2026-10-02|"},
               {"tipo": "receber", "id": 72, "assinatura": "aberto|930|930|2026-10-03|"}]
}$$::jsonb);
reset role;
-- A assinatura nova já marca os três; zera para ver só a comparação do fim da volta.
update integracao_fila set pendente = false where tipo = 'receber' and id_externo in (70, 71, 72);
set role anon;
select robo_tiny_aplicar(current_setting('teste.robo')::uuid, current_setting('teste.chave'), jsonb_build_object(
  'listados', '[{"tipo": "receber", "id": 70, "assinatura": "aberto|910|910|2026-10-01|"},
                {"tipo": "receber", "id": 71, "assinatura": "pago|920|0|2026-10-02|"},
                {"tipo": "receber", "id": 72, "assinatura": "aberto|930|930|2026-10-03|"}]'::jsonb,
  'receber_ciclo_inicio', (now() - interval '1 hour')::text));
reset role;
select pg_temp.esperar(
  (select string_agg(id_externo || '=' || pendente, ',' order by id_externo) from integracao_fila
   where tipo = 'receber' and id_externo in (70, 71, 72)) = '70=true,71=true,72=false',
  'fim da volta: situação diferente da Olist é relida; recebido aqui não');

-- Releitura: a Olist diz em aberto (70) e recebido (71).
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "receber": [
    {"id": 70, "situacao": "aberto", "emissao": "2026-09-20", "vencimento": "2026-10-01", "valor": 910,
     "descricao": "NF 700", "contato": {"id": 7201, "nome": "CLIENTE SETENTA"}},
    {"id": 71, "situacao": "pago", "emissao": "2026-09-20", "vencimento": "2026-10-02", "liquidacao": "2026-10-05",
     "valor": 920, "valor_pago": 920, "conta_id": 501, "descricao": "NF 701", "contato": {"id": 7201, "nome": "CLIENTE SETENTA"}},
    {"id": 72, "situacao": "aberto", "emissao": "2026-09-20", "vencimento": "2026-10-03", "valor": 930,
     "descricao": "NF 702", "contato": {"id": 7201, "nome": "CLIENTE SETENTA"}}
  ]
}$$::jsonb);
select pg_temp.esperar(
  (select situacao = 'aberto' and data_recebimento is null and conta_bancaria_id is null from contas_receber where tiny_id = 70),
  'recebido que veio da Olist volta para aberto');
select pg_temp.esperar(
  (select situacao = 'pago' and data_recebimento = '2026-10-05' from contas_receber where tiny_id = 71),
  'recebido na Olist fica recebido com a data');
select pg_temp.esperar(
  (select situacao = 'pago' and data_recebimento = '2026-10-04' from contas_receber where tiny_id = 72),
  'recebido aqui não volta para aberto');
select pg_temp.esperar(not exists (select 1 from receber_difere_do_tiny(current_setting('teste.robo')::uuid) x
                                   where x in (70, 71, 72)),
  'depois da releitura, nada mais diferente');
