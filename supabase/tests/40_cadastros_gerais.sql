-- Testes dos cadastros gerais: fornecedores, clientes, locais de estoque e
-- edição de perfis de acesso. Ao final de 30_usuarios.sql, pcp@teste é da
-- diretoria; aqui entram um usuário de compras e um de PCP.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000c', 'compras@teste'),
  ('00000000-0000-0000-0000-00000000000d', 'producao@teste');
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Compras') where email = 'compras@teste';
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'PCP / Produção') where email = 'producao@teste';

-- Compras cadastra fornecedor, não vê clientes.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into fornecedores (tipo_pessoa, documento, nome, uf, prazo_entrega_dias)
values ('juridica', '33333333000133', 'Aço Forte', 'SP', 7);
select pg_temp.esperar((select count(*) from fornecedores) = 1, 'compras cadastra fornecedor');
select pg_temp.esperar_erro(
  $$insert into fornecedores (tipo_pessoa, documento, nome) values ('fisica', '33333333000133', 'Errado')$$,
  'check', 'CPF precisa ter 11 dígitos');
select pg_temp.esperar((select count(*) from clientes) = 0, 'compras não vê clientes');
with d as (delete from fornecedores returning 1)
select pg_temp.esperar((select count(*) from d) = 0, 'compras não exclui fornecedor');
reset role;

-- PCP cuida dos locais de estoque, não vê fornecedores nem perfis.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into locais_estoque (nome) values ('Expedição');
select pg_temp.esperar((select count(*) from locais_estoque) = 2, 'PCP cadastra local de estoque');
select pg_temp.esperar((select count(*) from fornecedores) = 0, 'PCP não vê fornecedores');
select pg_temp.esperar_erro(
  $$select definir_permissoes_perfil((select id from perfis limit 1), '{}')$$,
  'não pode alterar perfis', 'PCP não altera perfis');
reset role;

-- Diretoria
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(
  tem_permissao('estoque.locais', 'excluir'),
  'tela nova já entra liberada para a diretoria');
insert into clientes (tipo_pessoa, documento, nome, canal) values ('fisica', '12345678901', 'Maria', 'shopee');
select pg_temp.esperar((select count(*) from clientes) = 1, 'diretoria cadastra cliente');

select definir_permissoes_perfil(
  (select id from perfis where nome = 'Compras'),
  array['compras.fornecedores:ver', 'compras.sugestoes:ver']);
select pg_temp.esperar(
  (select string_agg(tela_codigo || ':' || acao, ',' order by tela_codigo, acao)
   from perfil_permissoes pp join perfis p on p.id = pp.perfil_id where p.nome = 'Compras')
  = 'compras.fornecedores:ver,compras.sugestoes:ver',
  'nova lista substitui as permissões do perfil');

select pg_temp.esperar_erro(
  $$select definir_permissoes_perfil((select id from perfis where nome = 'Diretoria'), '{}')$$,
  'sempre tem todas', 'permissões da diretoria não são retiradas pela função');
select pg_temp.esperar_erro(
  $$delete from perfil_permissoes where perfil_id = (select id from perfis where nome = 'Diretoria')$$,
  'sempre tem todas', 'permissões da diretoria não são apagadas direto');
select pg_temp.esperar_erro(
  $$update perfis set todas_empresas = false where nome = 'Diretoria'$$,
  'não muda depois', 'diretoria não perde o acesso a todas as empresas');

insert into perfis (nome, todas_empresas) values ('Sócios', true);
select pg_temp.esperar(
  (select count(*) from perfil_permissoes pp join perfis p on p.id = pp.perfil_id where p.nome = 'Sócios')
  = (select count(*) * 5 from telas),
  'perfil novo de acesso total nasce com todas as permissões');
reset role;

-- Compras perdeu o editar de fornecedores.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
with u as (update fornecedores set telefone = '1' returning 1)
select pg_temp.esperar((select count(*) from u) = 0, 'perfil sem editar não altera fornecedor');
reset role;
