-- Testes do Tiny → Venner sem desfazer o que foi mudado aqui: a leitura das
-- contas a pagar não para mais, o Tiny atualiza o que só mudou lá e não mexe
-- no que foi mudado aqui; título parecido com um lançado aqui entra com aviso.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.robo', (select integracao_id::text from integracao_robo limit 1), false);

-- A data para parar foi apagada: lê contas a pagar sempre.
update integracao_robo set ler_pagar_ate = null, executando_ate = null;
select pg_temp.esperar(
  (select (robo_tiny_inicio(integracao_id, chave) ->> 'ler_pagar')::boolean from integracao_robo limit 1),
  'sem data para parar, lê contas a pagar');
update integracao_robo set executando_ate = null;

-- Título novo no Tiny e depois o vencimento mudado lá: segue o Tiny.
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 30, "situacao": "aberto", "emissao": "2026-11-01", "vencimento": "2026-11-20", "valor": 3532.79,
             "descricao": "Cristiane serviço", "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb);
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 30, "situacao": "aberto", "emissao": "2026-11-01", "vencimento": "2026-12-03", "valor": 3532.79,
             "descricao": "Cristiane serviço", "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb);
select pg_temp.esperar(
  (select vencimento = '2026-12-03' and editado_aqui = '{}' from contas_pagar where tiny_id = 30),
  'vencimento mudado no Tiny chega aqui e não conta como mudança daqui');

-- Mudou o valor aqui; o Tiny muda vencimento e valor: fica o valor daqui.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update contas_pagar set valor = 3600 where tiny_id = 30;
reset role;
select pg_temp.esperar((select editado_aqui = '{valor}' from contas_pagar where tiny_id = 30), 'mudança feita aqui é marcada');
select set_config('teste.resumo', tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 30, "situacao": "aberto", "emissao": "2026-11-01", "vencimento": "2026-12-10", "valor": 3000,
             "descricao": "Cristiane serviço", "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb)::text, false);
select pg_temp.esperar(
  (select vencimento = '2026-12-10' and valor = 3600 from contas_pagar where tiny_id = 30),
  'o Tiny muda o vencimento, mas não o valor mudado aqui');
select pg_temp.esperar((current_setting('teste.resumo')::jsonb ->> 'mantidos')::integer = 1, 'resumo conta o título mantido');

-- Baixa feita aqui (teste 99e, título 20) já marcada: o Tiny pago em outra data não troca.
select pg_temp.esperar(
  (select editado_aqui @> '{situacao,data_pagamento}' from contas_pagar where tiny_id = 20), 'baixa feita aqui fica marcada');
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 20, "situacao": "pago", "emissao": "2026-10-20", "vencimento": "2026-11-10", "liquidacao": "2026-11-15",
             "valor": 120, "valor_pago": 120, "descricao": "Energia novembro", "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb);
select pg_temp.esperar((select data_pagamento = '2026-11-09' from contas_pagar where tiny_id = 20),
  'data do pagamento feita aqui vale mais que a do Tiny');

-- Título lançado aqui e outro parecido no Tiny (mesmo fornecedor e valor, outro vencimento).
insert into contas_pagar (empresa_id, fornecedor_id, descricao, valor, vencimento)
select current_setting('teste.industria')::uuid, fornecedor_id, 'Lançado aqui', 777, '2026-12-01'
from contas_pagar where tiny_id = 30;
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 31, "situacao": "aberto", "emissao": "2026-11-01", "vencimento": "2026-12-05", "valor": 777,
             "descricao": "Do Tiny", "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb);
select pg_temp.esperar(
  (select observacao = 'Conferir: parecido com título lançado aqui (venc. 01/12/2026)' from contas_pagar where tiny_id = 31),
  'título parecido entra com aviso para conferir');

-- Contas a receber: vencimento mudado aqui fica; valor mudado no Tiny chega.
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "receber": [{"id": 40, "situacao": "aberto", "emissao": "2026-11-01", "vencimento": "2026-11-25", "valor": 900,
               "descricao": "Venda 40", "contato": {"id": 9001, "nome": "CLIENTE QUARENTA"}}]
}$$::jsonb);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update contas_receber set vencimento = '2026-11-30' where tiny_id = 40;
reset role;
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "receber": [{"id": 40, "situacao": "aberto", "emissao": "2026-11-01", "vencimento": "2026-11-26", "valor": 950,
               "descricao": "Venda 40", "contato": {"id": 9001, "nome": "CLIENTE QUARENTA"}}]
}$$::jsonb);
select pg_temp.esperar(
  (select vencimento = '2026-11-30' and valor = 950 and editado_aqui = '{vencimento}' from contas_receber where tiny_id = 40),
  'receber: fica o vencimento daqui e chega o valor do Tiny');
