-- Testes da conciliação que não se perde quando o Tiny mexe no título:
-- estorno e nova baixa no Tiny mantêm a ligação; cancelamento no Tiny solta;
-- título lançado só aqui segue como antes; recuperação das ligações
-- desfeitas pela leitura do Tiny e das perdidas ao importar de novo; leitura
-- do contas a pagar sempre ligada e fila começando pelos títulos.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
insert into contas_bancarias (empresa_id, nome) values (current_setting('teste.industria')::uuid, 'Conta Perde');
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Conta Perde';

-- Títulos do Tiny já pagos nesta conta e um lançado só aqui.
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id, tiny_id)
select current_setting('teste.industria')::uuid, x.d, (select id from plano_contas where codigo = '4.06'), x.v, '2026-11-03', 'pago', '2026-11-03', x.v,
  current_setting('teste.conta')::uuid, x.t
from (values ('PERDE JAB', 1975, 880001), ('PERDE cancelado', 300, 880002), ('PERDE reimportado', 145, 880003),
             ('PERDE desfeito', 35, 880004)) as x(d, v, t);
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id)
values (current_setting('teste.industria')::uuid, 'PERDE manual', (select id from plano_contas where codigo = '4.06'), 50, '2026-11-03', 'pago', '2026-11-03', 50,
  current_setting('teste.conta')::uuid);

create function pg_temp.linha(chave_banco text) returns uuid language sql as $$
  select id from extrato_lancamentos where chave = 'id:' || chave_banco
$$;
create function pg_temp.pagar(d text) returns uuid language sql as $$
  select id from contas_pagar where descricao = d
$$;
-- O robô do Tiny grava sem usuário e com a marca da leitura.
create function pg_temp.tiny(comando text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('venner.leitura_tiny', 'sim', true);
  execute comando;
  perform set_config('venner.leitura_tiny', '', true);
end $$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'perde.ofx', '[
  {"data": "2026-11-03", "descricao": "BOLETO PAGO J A B", "valor": -1975, "id_banco": "P1"},
  {"data": "2026-11-03", "descricao": "BOLETO CANCELADO", "valor": -300, "id_banco": "P2"},
  {"data": "2026-11-03", "descricao": "PAGAMENTO MANUAL", "valor": -50, "id_banco": "P3"},
  {"data": "2026-11-03", "descricao": "PIX MORETI", "valor": -145, "id_banco": "P4"},
  {"data": "2026-11-03", "descricao": "PIX EVERTON", "valor": -35, "id_banco": "P5"}
]'::jsonb);
select conciliar_lancamento(pg_temp.linha('P1'), array[pg_temp.pagar('PERDE JAB')]);
select conciliar_lancamento(pg_temp.linha('P2'), array[pg_temp.pagar('PERDE cancelado')]);
select conciliar_lancamento(pg_temp.linha('P3'), array[pg_temp.pagar('PERDE manual')]);
select conciliar_lancamento(pg_temp.linha('P5'), array[pg_temp.pagar('PERDE desfeito')]);
reset role;
reset request.jwt.claim.sub;

-- O financeiro estorna e refaz a baixa no Tiny: a ligação fica.
select pg_temp.tiny($$update contas_pagar set situacao = 'aberto', data_pagamento = null, valor_pago = null, conta_bancaria_id = null
  where descricao = 'PERDE JAB'$$);
select pg_temp.esperar(
  (select situacao = 'conciliado' from extrato_lancamentos where id = pg_temp.linha('P1'))
  and exists (select 1 from extrato_conciliacoes where lancamento_id = pg_temp.linha('P1')),
  'título do Tiny reaberto: a linha continua conciliada e ligada');
select pg_temp.tiny($$update contas_pagar set situacao = 'pago', data_pagamento = '2026-11-03', valor_pago = 1975,
  conta_bancaria_id = current_setting('teste.conta')::uuid where descricao = 'PERDE JAB'$$);
select pg_temp.esperar(
  (select situacao = 'conciliado' from extrato_lancamentos where id = pg_temp.linha('P1')),
  'baixado de novo no Tiny: segue conciliada, sem refazer');

-- Apagado/cancelado no Tiny: a linha volta para pendente.
select pg_temp.tiny($$update contas_pagar set situacao = 'cancelado', data_pagamento = null, valor_pago = null, conta_bancaria_id = null
  where descricao = 'PERDE cancelado'$$);
select pg_temp.esperar(
  (select situacao = 'pendente' from extrato_lancamentos where id = pg_temp.linha('P2'))
  and not exists (select 1 from extrato_conciliacoes where lancamento_id = pg_temp.linha('P2')),
  'título cancelado no Tiny: a linha volta para pendente');

-- Título lançado só aqui estornado: como antes, a linha volta para pendente.
update contas_pagar set situacao = 'aberto', data_pagamento = null, valor_pago = null, conta_bancaria_id = null where descricao = 'PERDE manual';
select pg_temp.esperar(
  (select situacao = 'pendente' from extrato_lancamentos where id = pg_temp.linha('P3')),
  'título lançado aqui estornado: a linha volta para pendente');

-- Recuperação: simula a ligação desfeita pela leitura antiga (sem usuário)...
select pg_temp.tiny($$delete from extrato_conciliacoes where lancamento_id = pg_temp.linha('P1')$$);
update extrato_lancamentos set situacao = 'pendente', conciliado_por = null, conciliado_em = null where id = pg_temp.linha('P1');
-- ...a desfeita por uma pessoa (não volta)...
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select desfazer_conciliacao(pg_temp.linha('P5'));
-- ...e a perdida ao excluir a importação e importar de novo o mesmo extrato.
select conciliar_lancamento(pg_temp.linha('P4'), array[pg_temp.pagar('PERDE reimportado')]);
select excluir_importacao_extrato((select id from extrato_importacoes where arquivo = 'perde.ofx'));
select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'perde-de-novo.ofx', '[
  {"data": "2026-11-03", "descricao": "BOLETO PAGO J A B", "valor": -1975, "id_banco": "P1"},
  {"data": "2026-11-03", "descricao": "PIX MORETI", "valor": -145, "id_banco": "P4"},
  {"data": "2026-11-03", "descricao": "PIX EVERTON", "valor": -35, "id_banco": "P5"}
]'::jsonb);
reset role;
reset request.jwt.claim.sub;

select pg_temp.esperar(public.recuperar_conciliacoes_tiny(now() - interval '1 hour') = 2, 'duas conciliações recuperadas');
select pg_temp.esperar(
  (select situacao = 'conciliado' from extrato_lancamentos where id = pg_temp.linha('P4'))
  and (select conta_pagar_id = pg_temp.pagar('PERDE reimportado') and efeito = 'vinculou' and grupo = lancamento_id
       from extrato_conciliacoes where lancamento_id = pg_temp.linha('P4')),
  'extrato importado de novo: a mesma linha volta ligada ao título');
select pg_temp.esperar(
  (select situacao = 'conciliado' from extrato_lancamentos where id = pg_temp.linha('P1')),
  'excluída a importação, a ligação desfeita pela leitura também volta na linha nova');
select pg_temp.esperar(
  (select situacao = 'pendente' from extrato_lancamentos where id = pg_temp.linha('P5')),
  'desfeita por uma pessoa: fica pendente');
select pg_temp.esperar(public.recuperar_conciliacoes_tiny(now() - interval '1 hour') = 0, 'rodar de novo não repete');

-- Leitura do Tiny: contas a pagar sempre e a fila começa pelos títulos.
select set_config('teste.integ', coalesce((select id::text from integracoes_plataforma where canal = 'tiny' limit 1), ''), false);
create temp table chave_robo (chave text);
grant all on chave_robo to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into chave_robo select chave_robo_tiny(current_setting('teste.integ')::uuid) where current_setting('teste.integ') <> '';
reset role;
reset request.jwt.claim.sub;
do $$
declare
  integ uuid;
  r jsonb;
begin
  select id into integ from integracoes_plataforma where canal = 'tiny' limit 1;
  if integ is null then
    raise notice 'sem conta do Tiny nos testes: fila não conferida';
    return;
  end if;
  update integracao_robo set ler_pagar_ate = '2026-01-01', executando_ate = null where integracao_id = integ;
  insert into integracao_fila (integracao_id, tipo, id_externo, pendente, atualizado_em)
  values (integ, 'produto', 990001, true, now() - interval '1 day'), (integ, 'pagar', 990002, true, now())
  on conflict (integracao_id, tipo, id_externo) do update set pendente = true, atualizado_em = excluded.atualizado_em;
  r := public.robo_tiny_inicio(integ, (select chave from pg_temp.chave_robo), 40);
  perform pg_temp.esperar((r ->> 'ler_pagar')::boolean, 'contas a pagar sempre lidas');
  perform pg_temp.esperar(r -> 'pendentes' -> 0 ->> 'tipo' in ('pagar', 'receber'), 'fila começa pelos títulos');
end $$;
