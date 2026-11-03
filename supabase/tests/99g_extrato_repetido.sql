-- Testes do lançamento repetido no extrato: a mesma data e o mesmo valor vindos
-- de outra importação ficam de fora da lista de pendentes.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Itaú movimento';

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';

-- PDF do mês: um PIX e duas tarifas iguais no mesmo dia.
select set_config('teste.pdf', (importar_extrato(current_setting('teste.conta')::uuid, 'pdf', 'dezembro.pdf',
  '[{"data": "2026-12-05", "descricao": "Pix recebido de FWC SOLUCOES", "valor": 175.65},
    {"data": "2026-12-05", "descricao": "TARIFA PIX", "valor": -5},
    {"data": "2026-12-05", "descricao": "TARIFA PIX", "valor": -5}]'::jsonb) ->> 'importacao'), false);

-- O mesmo mês em OFX: descrição e documento diferentes, mais uma linha nova.
select set_config('teste.ofx', (importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'dezembro.ofx',
  '[{"data": "2026-12-05", "descricao": "PIX RECEBIDO FWC", "documento": "01a14198", "valor": 175.65, "id_banco": "A1"},
    {"data": "2026-12-05", "descricao": "TAR PIX", "valor": -5, "id_banco": "A2"},
    {"data": "2026-12-05", "descricao": "TAR PIX", "valor": -5, "id_banco": "A3"},
    {"data": "2026-12-06", "descricao": "PIX ENVIADO", "valor": -40, "id_banco": "A4"}]'::jsonb)::text), false);
select pg_temp.esperar(
  (current_setting('teste.ofx')::jsonb ->> 'importadas')::int = 1 and (current_setting('teste.ofx')::jsonb ->> 'repetidas')::int = 3,
  'segunda importação: 1 nova e 3 repetidas');
select pg_temp.esperar(
  (select count(*) from extrato_lancamentos
   where conta_bancaria_id = current_setting('teste.conta')::uuid and data between '2026-12-05' and '2026-12-06' and situacao = 'pendente') = 4,
  'pendentes: PIX, duas tarifas e a linha nova (sem cópias)');
select pg_temp.esperar(
  (select count(*) from extrato_lancamentos
   where importacao_id = (current_setting('teste.ofx')::jsonb ->> 'importacao')::uuid
     and situacao = 'ignorado' and observacao = 'Repetido de outra importação') = 3,
  'as cópias ficam ignoradas com o motivo');

-- Conciliada uma cópia, a outra não volta para a lista.
select desfazer_conciliacao(id) from extrato_lancamentos
where importacao_id = (current_setting('teste.ofx')::jsonb ->> 'importacao')::uuid and valor = 175.65;
select marcar_lancamento(id, 'transferencia', 'teste') from extrato_lancamentos
where importacao_id = (current_setting('teste.ofx')::jsonb ->> 'importacao')::uuid and valor = 175.65;
select marcar_repetidos_extrato(current_setting('teste.conta')::uuid);
select pg_temp.esperar(
  (select situacao = 'ignorado' from extrato_lancamentos where importacao_id = current_setting('teste.pdf')::uuid and valor = 175.65),
  'resolvida a cópia do OFX, a do PDF sai da lista');
reset role;

-- Excluída a importação do OFX, as cópias do PDF voltam para a lista.
insert into perfil_permissoes (perfil_id, tela_codigo, acao)
select id, 'financeiro.conciliacao', 'excluir' from perfis where nome = 'Financeiro';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select excluir_importacao_extrato((current_setting('teste.ofx')::jsonb ->> 'importacao')::uuid);
select pg_temp.esperar(
  (select count(*) filter (where situacao = 'pendente') = 3 from extrato_lancamentos where importacao_id = current_setting('teste.pdf')::uuid),
  'sem o OFX, as 3 linhas do PDF voltam a ficar pendentes');
reset role;
delete from perfil_permissoes
where tela_codigo = 'financeiro.conciliacao' and acao = 'excluir' and perfil_id = (select id from perfis where nome = 'Financeiro');
