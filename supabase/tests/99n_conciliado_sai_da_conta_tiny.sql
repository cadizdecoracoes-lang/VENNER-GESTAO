-- Testes da correção do título conciliado que voltou para "Tiny · conta não
-- informada": volta para a conta e a data da linha, e o desfazer devolve.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.tiny', id::text, false) from contas_bancarias
  where empresa_id = current_setting('teste.industria')::uuid and nome = 'Tiny · conta não informada';
insert into contas_bancarias (empresa_id, nome) values (current_setting('teste.industria')::uuid, 'Conta FWC');
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Conta FWC';

insert into contas_receber (empresa_id, descricao, valor, vencimento, situacao, data_recebimento, valor_recebido, conta_bancaria_id)
values (current_setting('teste.industria')::uuid, 'FWC recebimento', 175.65, '2026-10-14', 'pago', '2026-10-14', 175.65,
  current_setting('teste.tiny')::uuid);

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'fwc.ofx',
  '[{"data": "2026-10-15", "descricao": "PIX FWC", "valor": 175.65, "id_banco": "W1"}]'::jsonb);
select set_config('teste.linha', id::text, false) from extrato_lancamentos where chave = 'id:W1';
select conciliar_lancamento(current_setting('teste.linha')::uuid, '{}', array[(select id from contas_receber where descricao = 'FWC recebimento')]);
reset role;

-- Simula a leitura do Tiny de antes do #37 devolvendo o título para a conta do Tiny.
update contas_receber set conta_bancaria_id = current_setting('teste.tiny')::uuid, data_recebimento = '2026-10-14'
where descricao = 'FWC recebimento';
update extrato_conciliacoes set conta_anterior = null, data_anterior = null where lancamento_id = current_setting('teste.linha')::uuid;

select public.trazer_conciliados_da_conta_tiny();
select pg_temp.esperar(
  (select conta_bancaria_id = current_setting('teste.conta')::uuid and data_recebimento = '2026-10-15'
     and 'conta_bancaria_id' = any(editado_aqui)
   from contas_receber where descricao = 'FWC recebimento'),
  'título volta para a conta e a data da linha conciliada, protegido da leitura do Tiny');
select pg_temp.esperar(
  (select conta_anterior = current_setting('teste.tiny')::uuid and data_anterior = '2026-10-14'
   from extrato_conciliacoes where lancamento_id = current_setting('teste.linha')::uuid),
  'guarda a conta e a data de antes');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select desfazer_conciliacao(current_setting('teste.linha')::uuid);
reset role;
select pg_temp.esperar(
  (select conta_bancaria_id = current_setting('teste.tiny')::uuid and data_recebimento = '2026-10-14' and situacao = 'pago'
   from contas_receber where descricao = 'FWC recebimento'),
  'desfazer devolve o título para a conta do Tiny');
