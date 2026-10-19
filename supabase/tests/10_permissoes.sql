-- Testes das regras de acesso. Cada verificação falha com erro se a regra quebrar.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not condicao then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'diretoria@teste'),
  ('00000000-0000-0000-0000-00000000000b', 'pcp@teste');

select pg_temp.esperar((select count(*) from usuarios where not ativo) = 2, 'login novo vira usuário inativo');

-- Usuário sem perfil não vê nem cria nada.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar((select count(*) from perfis) = 0, 'sem perfil não vê perfis');
do $$ begin
  insert into itens (codigo, descricao, tipo, unidade) values ('X', 'x', 'materia_prima', 'UN');
  raise exception 'FALHOU: usuário sem perfil inseriu item';
exception when insufficient_privilege then raise notice 'ok: sem perfil não cria item';
end $$;
reset role;

update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Diretoria') where email = 'diretoria@teste';
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'PCP / Produção') where email = 'pcp@teste';

-- Diretoria
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into empresas (razao_social, cnpj, regime_tributario) values
  ('Indústria', '11111111000111', 'lucro_real'),
  ('Comércio', '22222222000122', 'simples_nacional');
insert into itens (codigo, descricao, tipo, unidade) values
  ('PA1', 'Produto', 'produto_acabado', 'UN'),
  ('MP1', 'Parafuso', 'materia_prima', 'PC');
insert into movimentos_estoque (item_id, local_id, tipo, quantidade, origem_tipo)
select id, (select id from locais_estoque limit 1), 'entrada', 10, 'teste' from itens where codigo = 'MP1';
select pg_temp.esperar((select count(*) from empresas) = 2, 'diretoria vê todas as empresas');
select pg_temp.esperar(
  (select saldo from saldos_estoque s join itens i on i.id = s.item_id where i.codigo = 'MP1') = 10,
  'saldo de estoque soma os movimentos');
with u as (update movimentos_estoque set quantidade = 99 returning 1)
select pg_temp.esperar((select count(*) from u) = 0, 'movimento de estoque não pode ser editado');
insert into fichas_tecnicas (item_id, versao) select id, 1 from itens where codigo = 'PA1';
do $$ begin
  insert into ficha_componentes (ficha_id, componente_id, quantidade) select f.id, f.item_id, 1 from fichas_tecnicas f;
  raise exception 'FALHOU: produto virou componente de si mesmo';
exception when raise_exception then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'ok: produto não é componente de si mesmo';
end $$;
reset role;

-- PCP: vê estoque e produção, não vê empresas não atribuídas, não exclui.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar((select count(*) from empresas) = 0, 'PCP não vê empresas não atribuídas');
select pg_temp.esperar((select count(*) from itens) = 2, 'PCP vê itens (estoque unificado)');
select pg_temp.esperar((select count(*) from perfis) = 0, 'PCP não vê perfis de acesso');
with d as (delete from itens where codigo = 'PA1' returning 1)
select pg_temp.esperar((select count(*) from d) = 0, 'PCP não exclui itens');
select pg_temp.esperar(not tem_permissao('estoque.itens', 'excluir'), 'tem_permissao respeita a ação');
reset role;

select pg_temp.esperar((select count(*) from auditoria where tabela = 'itens' and usuario_id is not null) = 2,
  'auditoria registra quem criou cada item');
