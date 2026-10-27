-- Testes de excluir uma importação de extrato: só com permissão de excluir,
-- desfaz as baixas feitas pela conciliação e apaga as linhas.
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

select set_config('teste.importacao', id::text, false) from extrato_importacoes where arquivo = 'itau.ofx';
select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Itaú movimento';
-- Títulos que a conciliação baixou (teste 98) e os que só ligou.
create temp table baixados as
  select coalesce(c.conta_pagar_id, c.conta_receber_id) as id, c.efeito
  from extrato_conciliacoes c join extrato_lancamentos l on l.id = c.lancamento_id
  where l.importacao_id = current_setting('teste.importacao')::uuid;
grant select on baixados to authenticated;
select pg_temp.esperar((select count(*) from baixados where efeito = 'baixou') > 0, 'antes: há título baixado pela conciliação');

-- Financeiro (sem "excluir") não apaga.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar_erro(
  $$select excluir_importacao_extrato(current_setting('teste.importacao')::uuid)$$,
  'não pode excluir', 'financeiro não exclui importação');
reset role;

-- Com "excluir" liberado no perfil, apaga e as baixas feitas pela conciliação
-- voltam a ficar em aberto.
insert into perfil_permissoes (perfil_id, tela_codigo, acao)
select id, 'financeiro.conciliacao', 'excluir' from perfis where nome = 'Financeiro';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar(
  (excluir_importacao_extrato(current_setting('teste.importacao')::uuid) ->> 'linhas')::int = 6,
  'com permissão de excluir, apaga a importação (6 linhas)');
reset role;

select pg_temp.esperar(
  not exists (select 1 from extrato_importacoes where id = current_setting('teste.importacao')::uuid)
  and not exists (select 1 from extrato_lancamentos where importacao_id = current_setting('teste.importacao')::uuid),
  'importação e linhas apagadas');
select pg_temp.esperar(
  not exists (select 1 from extrato_conciliacoes c join baixados b on b.id in (c.conta_pagar_id, c.conta_receber_id)),
  'títulos sem ligação com o extrato');
select pg_temp.esperar(
  (select bool_and(coalesce(p.situacao::text, r.situacao::text) = 'aberto'
     and coalesce(p.data_pagamento, r.data_recebimento) is null)
   from baixados b left join contas_pagar p on p.id = b.id left join contas_receber r on r.id = b.id
   where b.efeito = 'baixou'),
  'títulos baixados pela conciliação voltam a ficar em aberto');
select pg_temp.esperar_erro(
  $$select excluir_importacao_extrato(current_setting('teste.importacao')::uuid)$$,
  'não encontrada', 'excluir de novo avisa que não existe');
delete from perfil_permissoes
where tela_codigo = 'financeiro.conciliacao' and acao = 'excluir' and perfil_id = (select id from perfis where nome = 'Financeiro');

-- Pago pelo Tiny sem a conta da baixa casa com o extrato de qualquer conta da
-- empresa: passa para a conta e a data do extrato e volta se desfizer.
select set_config('teste.semconta', tiny_conta(current_setting('teste.industria')::uuid, null)::text, false);
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id)
values (current_setting('teste.industria')::uuid, 'TINY pago sem conta', (select id from plano_contas where codigo = '4.06'), 777, '2026-11-10',
  'pago', '2026-11-10', 777, current_setting('teste.semconta')::uuid);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select importar_extrato(current_setting('teste.conta')::uuid, 'pdf', 'novembro.pdf',
  '[{"data": "2026-11-12", "descricao": "PIX ENVIADO", "valor": -777}]'::jsonb);
select conciliar_lancamento(
  (select id from extrato_lancamentos where descricao = 'PIX ENVIADO' and data = '2026-11-12'),
  array[(select id from contas_pagar where descricao = 'TINY pago sem conta')]);
select pg_temp.esperar(
  (select conta_bancaria_id = current_setting('teste.conta')::uuid and data_pagamento = '2026-11-12' and situacao = 'pago'
   from contas_pagar where descricao = 'TINY pago sem conta'),
  'pago do Tiny sem conta passa para a conta e a data do extrato');
select desfazer_conciliacao((select id from extrato_lancamentos where descricao = 'PIX ENVIADO' and data = '2026-11-12'));
select pg_temp.esperar(
  (select conta_bancaria_id = current_setting('teste.semconta')::uuid and data_pagamento = '2026-11-10' and situacao = 'pago'
   from contas_pagar where descricao = 'TINY pago sem conta'),
  'desfazer devolve a conta e a data de antes');
reset role;
