-- Testes das contas a pagar iguais ao Tiny: situação e data/conta da baixa
-- seguem o Tiny, a baixa feita aqui é mantida e a planilha do Tiny corrige
-- os títulos (mostrando antes de aplicar).
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

-- O título 10 entrou pago pelo Tiny (teste 95) sem data nem conta da baixa:
-- ficou com o vencimento e "conta não informada".
select pg_temp.esperar(
  (select situacao = 'pago' and data_pagamento = '2026-09-10' and b.nome = 'Tiny · conta não informada'
   from contas_pagar p join contas_bancarias b on b.id = p.conta_bancaria_id where p.tiny_id = 10),
  'antes: pago no vencimento, sem a conta');
select pg_temp.esperar(not pagar_baixado_aqui((select id from contas_pagar where tiny_id = 10)),
  'pago que veio do Tiny não conta como baixa feita aqui');

-- No Tiny está em aberto: volta a ficar em aberto aqui.
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 10, "situacao": "aberto", "emissao": "2026-09-01", "vencimento": "2026-09-10", "valor": 4200,
             "descricao": "Aluguel setembro", "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb);
select pg_temp.esperar(
  (select situacao = 'aberto' and data_pagamento is null and valor_pago is null and conta_bancaria_id is null
   from contas_pagar where tiny_id = 10),
  'em aberto no Tiny: o pago que veio do Tiny é desfeito');
select pg_temp.esperar(
  (select h.origem = 'tiny' and h.mudancas -> 'Situação' = '["Pago", "Em aberto"]'::jsonb
   from contas_pagar p join contas_pagar_historico h on h.conta_id = p.id
   where p.tiny_id = 10 order by h.quando desc, h.id limit 1),
  'a correção fica no histórico com origem Tiny');

-- Pago no Tiny com a data e a conta da baixa.
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 10, "situacao": "pago", "emissao": "2026-09-01", "vencimento": "2026-09-10", "liquidacao": "2026-09-12",
             "conta_id": 501, "valor": 4200, "valor_pago": 4200, "descricao": "Aluguel setembro",
             "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb);
select pg_temp.esperar(
  (select situacao || '|' || data_pagamento || '|' || b.nome from contas_pagar p join contas_bancarias b on b.id = p.conta_bancaria_id
   where p.tiny_id = 10) = 'pago|2026-09-12|Venner C6 BANK',
  'pago com a data de banco e a conta do Tiny');

-- Uma leitura sem a data e a conta da baixa não estraga o que já estava certo.
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 10, "situacao": "pago", "emissao": "2026-09-01", "vencimento": "2026-09-10", "valor": 4200,
             "valor_pago": 4200, "descricao": "Aluguel setembro", "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb);
select pg_temp.esperar(
  (select data_pagamento || '|' || b.nome from contas_pagar p join contas_bancarias b on b.id = p.conta_bancaria_id
   where p.tiny_id = 10) = '2026-09-12|Venner C6 BANK',
  'sem data e conta no Tiny, ficam as que já estavam');

-- Baixa feita aqui pela Diretoria: o Tiny ainda em aberto não desfaz.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update contas_pagar set situacao = 'pago', data_pagamento = '2026-11-09', valor_pago = 120,
  conta_bancaria_id = (select id from contas_bancarias where tiny_id = 501)
where tiny_id = 20;
reset role;
select pg_temp.esperar(pagar_baixado_aqui((select id from contas_pagar where tiny_id = 20)), 'baixa feita aqui é reconhecida');
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 20, "situacao": "aberto", "emissao": "2026-10-20", "vencimento": "2026-11-10", "valor": 120,
             "descricao": "Energia novembro", "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb);
select pg_temp.esperar(
  (select situacao = 'pago' and data_pagamento = '2026-11-09' from contas_pagar where tiny_id = 20),
  'baixa feita aqui vale mais que o Tiny em aberto');

-- Planilha do Tiny: primeiro mostra, depois corrige.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select set_config('teste.planilha', $$[
  {"fornecedor": "Imobiliária  x", "vencimento": "2026-09-10", "valor": 4200, "situacao": "pago",
   "pagamento": "2026-09-15", "valor_pago": 4200, "conta": "VENNER C6 BANK"},
  {"fornecedor": "IMOBILIARIA X", "vencimento": "2026-11-10", "valor": 120, "situacao": "aberto"},
  {"fornecedor": "IMOBILIARIA X", "vencimento": "2026-11-10", "valor": 4200, "situacao": "parcial", "valor_pago": 1000},
  {"fornecedor": "Ninguém", "vencimento": "2026-09-10", "valor": 1, "situacao": "aberto"}
]$$, false);
select set_config('teste.previa',
  tiny_aplicar_planilha_pagar(current_setting('teste.industria')::uuid, current_setting('teste.planilha')::jsonb)::text, false);
select pg_temp.esperar(
  (select (p ->> 'corrigidos')::integer = 2 and jsonb_array_length(p -> 'mantidos') = 1 and jsonb_array_length(p -> 'nao_achados') = 1
     and p -> 'corrigir' -> 0 ->> 'de' = 'Pago em 12/09/2026 · Venner C6 BANK'
     and p -> 'corrigir' -> 0 ->> 'para' = 'Pago em 15/09/2026 · Venner C6 BANK'
     and p -> 'corrigir' -> 1 ->> 'para' = 'Em aberto'
   from (select current_setting('teste.previa')::jsonb p) x),
  'prévia: o que muda, o que fica (baixado aqui) e o que não foi achado');
select pg_temp.esperar((select data_pagamento = '2026-09-12' from contas_pagar where tiny_id = 10), 'prévia não grava nada');

select tiny_aplicar_planilha_pagar(current_setting('teste.industria')::uuid, current_setting('teste.planilha')::jsonb, true);
select pg_temp.esperar((select data_pagamento = '2026-09-15' and situacao = 'pago' from contas_pagar where tiny_id = 10),
  'planilha corrige a data do pagamento');
select pg_temp.esperar(
  (select situacao = 'aberto' and observacao like 'Pago em parte no Tiny: R$ 1000%' from contas_pagar where tiny_id = 11),
  'parcial na planilha fica em aberto com a anotação');
select pg_temp.esperar((select situacao = 'pago' from contas_pagar where tiny_id = 20), 'baixa feita aqui não muda pela planilha');
select pg_temp.esperar(
  (select h.origem = 'tiny' and h.mudancas ? 'Data do pagamento'
   from contas_pagar p join contas_pagar_historico h on h.conta_id = p.id
   where p.tiny_id = 10 order by h.quando desc, h.id limit 1),
  'correção pela planilha fica no histórico com origem Tiny');

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.esperar_erro(
  $$select tiny_aplicar_planilha_pagar(current_setting('teste.industria')::uuid, '[]'::jsonb, true)$$,
  'Sem permissão', 'sem editar contas a pagar não corrige pela planilha');
reset role;
