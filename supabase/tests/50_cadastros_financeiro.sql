-- Testes dos cadastros do financeiro: contas bancárias por CNPJ, plano de
-- contas e centros de custo. Usuários vêm dos arquivos anteriores (pcp@teste
-- é da diretoria; compras@teste ficou com permissões reduzidas).
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'financeiro@teste');
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Financeiro') where email = 'financeiro@teste';
insert into usuario_empresas (usuario_id, empresa_id)
select '00000000-0000-0000-0000-00000000000e', id from empresas where cnpj = '11111111000111';
select set_config('teste.empresa_comercio', id::text, false) from empresas where cnpj = '22222222000122';

-- Diretoria cadastra uma conta em cada CNPJ.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into contas_bancarias (empresa_id, nome, banco_codigo, agencia, conta, saldo_inicial)
select id, 'Itaú movimento', '341', '0001', '12345-6', 1000 from empresas where cnpj = '11111111000111';
insert into contas_bancarias (empresa_id, nome, banco_codigo, agencia, conta)
select id, 'Inter', '077', '0001', '999-1' from empresas where cnpj = '22222222000122';
select pg_temp.esperar((select count(*) from contas_bancarias) = 2, 'diretoria vê as contas de todos os CNPJs');
select pg_temp.esperar((select count(*) from plano_contas) = 23, 'plano de contas inicial carregado');
reset role;

-- Financeiro só enxerga e cadastra contas do CNPJ liberado.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar(
  (select string_agg(nome, ',') from contas_bancarias) = 'Itaú movimento',
  'financeiro vê só a conta do CNPJ liberado');
select pg_temp.esperar_erro(
  $$insert into contas_bancarias (empresa_id, nome) values (current_setting('teste.empresa_comercio')::uuid, 'Caixa')$$,
  'row-level security', 'financeiro não cria conta em CNPJ não liberado');
select pg_temp.esperar_erro(
  $$insert into contas_bancarias (empresa_id, nome, banco_codigo, agencia, conta)
    select id, 'Repetida', '341', '0001', '12345-6' from empresas where cnpj = '11111111000111'$$,
  'contas_bancarias_numero_idx', 'mesma agência e conta não se repetem');

insert into plano_contas (codigo, nome, tipo, pai_id)
select '4.07', 'Viagens', 'despesa', id from plano_contas where codigo = '4';
select pg_temp.esperar_erro(
  $$insert into plano_contas (codigo, nome, tipo, pai_id) select '4.08', 'Errada', 'receita', id from plano_contas where codigo = '4'$$,
  'mesmo tipo', 'conta filha segue o tipo da mãe');
select pg_temp.esperar_erro(
  $$update plano_contas set pai_id = (select id from plano_contas where codigo = '4.07') where codigo = '4'$$,
  'abaixo dela mesma', 'plano de contas não aceita ciclo');
select pg_temp.esperar_erro(
  $$insert into plano_contas (codigo, nome, tipo) values ('4,9', 'x', 'despesa')$$,
  'check', 'código do plano de contas só com números e pontos');

insert into centros_custo (codigo, nome) values ('FAB', 'Fábrica');
select pg_temp.esperar((select count(*) from centros_custo) = 1, 'financeiro cadastra centro de custo');
with d as (delete from centros_custo returning 1)
select pg_temp.esperar((select count(*) from d) = 0, 'financeiro não exclui centro de custo');
reset role;

-- Contabilidade só consulta o plano de contas; Compras não vê nada do financeiro.
update usuarios set perfil_id = (select id from perfis where nome = 'Contabilidade') where email = 'financeiro@teste';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar((select count(*) from plano_contas) = 24, 'contabilidade consulta o plano de contas');
-- Desde o pacote 17 a contabilidade enxerga as contas do CNPJ liberado para consultar a conciliação.
select pg_temp.esperar((select count(*) from contas_bancarias) = 1, 'contabilidade vê só as contas do CNPJ liberado');
select pg_temp.esperar_erro(
  $$insert into contas_bancarias (empresa_id, nome) values ((select id from empresas where cnpj = '11111111000111'), 'Outra')$$,
  'row-level security', 'contabilidade não cadastra conta bancária');
reset role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar((select count(*) from plano_contas) + (select count(*) from centros_custo) = 0, 'compras não vê o financeiro');
reset role;
