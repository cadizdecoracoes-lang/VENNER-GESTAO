-- Testes da migração 20261123000080: títulos só pelo Tiny. O que é lançado só
-- aqui sai (e a linha do extrato volta para pendente) e, pelo site, título não
-- se cria, edita nem exclui; a leitura do Tiny e a conciliação continuam.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

create function pg_temp.esperar_erro(comando text, trecho text, mensagem text) returns void language plpgsql as $$
begin
  begin
    execute comando;
  exception when others then
    if sqlerrm ilike '%' || trecho || '%' then
      raise notice 'ok: %', mensagem;
      return;
    end if;
    raise exception 'FALHOU: % (erro diferente: %)', mensagem, sqlerrm;
  end;
  raise exception 'FALHOU: % (não deu erro)', mensagem;
end $$;

-- O site entra no banco pela sessão "authenticator" (PostgREST).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
end $$;
grant authenticated to authenticator;

select set_config('teste.emp', id::text, false) from empresas where cnpj = '11111111000111';
insert into contas_bancarias (empresa_id, nome, tiny_id) values (current_setting('teste.emp')::uuid, 'Banco ST', 7770001);
select set_config('teste.conta', id::text, false) from contas_bancarias where tiny_id = 7770001;

select importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'st.ofx', '[
  {"data": "2027-05-02", "descricao": "PIX ASHI ST", "valor": -90, "id_banco": "ST1"},
  {"data": "2027-05-03", "descricao": "PIX CLIENTE ST", "valor": 150, "id_banco": "ST2"},
  {"data": "2027-05-04", "descricao": "PIX FORNECEDOR ST", "valor": -40, "id_banco": "ST3"}
]'::jsonb);

-- Lançado só aqui (como o "Lançar transferência") e conciliado com ST1.
insert into contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id)
values (current_setting('teste.emp')::uuid, 'ST só aqui', (select id from plano_contas where codigo = '4.06'), 90, '2027-05-02', 'pago', '2027-05-02', 90, current_setting('teste.conta')::uuid);
-- Do Tiny, conciliados com ST2 e ST3.
insert into contas_receber (empresa_id, canal, descricao, valor, vencimento, situacao, data_recebimento, valor_recebido, conta_bancaria_id, tiny_id)
values (current_setting('teste.emp')::uuid, 'venda_direta', 'ST do Tiny', 150, '2027-05-03', 'pago', '2027-05-03', 150, current_setting('teste.conta')::uuid, 7779001);
insert into contas_pagar (empresa_id, descricao, valor, vencimento, situacao, data_pagamento, valor_pago, conta_bancaria_id, tiny_id)
values (current_setting('teste.emp')::uuid, 'ST pagar do Tiny', 40, '2027-05-04', 'pago', '2027-05-04', 40, current_setting('teste.conta')::uuid, 7779002);
insert into extrato_conciliacoes (lancamento_id, conta_pagar_id, conta_receber_id, valor, efeito)
select l.id,
  case l.chave when 'id:ST1' then (select id from contas_pagar where descricao = 'ST só aqui') end,
  case l.chave when 'id:ST2' then (select id from contas_receber where descricao = 'ST do Tiny') end,
  abs(l.valor), 'vinculou'
from extrato_lancamentos l where l.chave in ('id:ST1', 'id:ST2') and l.conta_bancaria_id = current_setting('teste.conta')::uuid;
update extrato_lancamentos set situacao = 'conciliado' where chave in ('id:ST1', 'id:ST2') and conta_bancaria_id = current_setting('teste.conta')::uuid;

-- Limpeza da migração.
select set_config('teste.r', excluir_titulos_so_aqui()::text, false);
select pg_temp.esperar(not exists (select 1 from contas_pagar where tiny_id is null) and not exists (select 1 from contas_receber where tiny_id is null),
  'nenhum título lançado só aqui sobra');
select pg_temp.esperar(
  (select situacao = 'pendente' and conciliado_em is null from extrato_lancamentos where chave = 'id:ST1' and conta_bancaria_id = current_setting('teste.conta')::uuid),
  'a linha do extrato do título excluído volta para pendente (para lançar no Tiny)');
select pg_temp.esperar(
  (select situacao = 'conciliado' from extrato_lancamentos where chave = 'id:ST2' and conta_bancaria_id = current_setting('teste.conta')::uuid)
  and exists (select 1 from contas_receber where tiny_id = 7779001 and situacao = 'pago'),
  'o que veio do Tiny e a conciliação dele não mudam');

-- Pelo site (sessão authenticator), com um usuário que pode tudo no financeiro.
set session authorization authenticator;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';

select pg_temp.esperar_erro(
  format($q$insert into public.contas_pagar (empresa_id, descricao, valor, vencimento) values (%L, 'ST novo', 10, '2027-05-10')$q$, current_setting('teste.emp')),
  'lançadas só no Tiny', 'o site não cria conta a pagar');
select pg_temp.esperar_erro(
  format($q$insert into public.contas_receber (empresa_id, canal, descricao, valor, vencimento) values (%L, 'venda_direta', 'ST novo', 10, '2027-05-10')$q$, current_setting('teste.emp')),
  'lançadas só no Tiny', 'o site não cria conta a receber');
select pg_temp.esperar_erro($q$update public.contas_receber set descricao = 'mudou' where tiny_id = 7779001$q$,
  'vem do Tiny', 'o site não edita título');
select pg_temp.esperar_erro($q$delete from public.contas_receber where tiny_id = 7779001$q$,
  'vem do Tiny', 'o site não exclui título');
select pg_temp.esperar_erro(
  format($q$select public.lancar_transferencia(%L)$q$, (select id from public.extrato_lancamentos where chave = 'id:ST1' and conta_bancaria_id = current_setting('teste.conta')::uuid)),
  'lançadas só no Tiny', '"Lançar transferência" não cria mais título');

-- A conciliação continua: liga a linha ST3 ao título do Tiny.
select conciliar_lancamento(
  (select id from public.extrato_lancamentos where chave = 'id:ST3' and conta_bancaria_id = current_setting('teste.conta')::uuid),
  array[(select id from public.contas_pagar where tiny_id = 7779002)], array[]::uuid[]);
select pg_temp.esperar(
  (select situacao = 'conciliado' from public.extrato_lancamentos where chave = 'id:ST3' and conta_bancaria_id = current_setting('teste.conta')::uuid),
  'a conciliação com título do Tiny continua funcionando pelo site');

-- A leitura do Tiny continua gravando.
select set_config('venner.leitura_tiny', 'sim', false);
update public.contas_pagar set descricao = 'ST pagar do Tiny (lido)' where tiny_id = 7779002;
select set_config('venner.leitura_tiny', '', false);
select pg_temp.esperar((select descricao = 'ST pagar do Tiny (lido)' from public.contas_pagar where tiny_id = 7779002),
  'a leitura do Tiny continua atualizando o título');

reset role;
reset session authorization;
