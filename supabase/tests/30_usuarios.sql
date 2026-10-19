-- Testes da gestão de usuários. Usa os usuários criados em 10_permissoes.sql.
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

-- Diretoria libera um CNPJ para o PCP
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select definir_empresas_usuario(
  '00000000-0000-0000-0000-00000000000b',
  array[(select id from empresas where cnpj = '11111111000111')]);
reset role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar((select count(*) from empresas) = 1, 'PCP passa a ver só o CNPJ liberado');
select pg_temp.esperar_erro(
  $$select definir_empresas_usuario('00000000-0000-0000-0000-00000000000b', array[(select id from empresas limit 1)])$$,
  'não pode alterar usuários', 'PCP não libera CNPJs para si mesmo');
reset role;

-- Trocar a lista substitui a anterior
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select definir_empresas_usuario(
  '00000000-0000-0000-0000-00000000000b',
  array[(select id from empresas where cnpj = '22222222000122')]);
select pg_temp.esperar(
  (select string_agg(e.cnpj, ',') from usuario_empresas ue join empresas e on e.id = ue.empresa_id
   where ue.usuario_id = '00000000-0000-0000-0000-00000000000b') = '22222222000122',
  'nova lista de CNPJs substitui a anterior');

-- A última pessoa da diretoria não perde o acesso
select pg_temp.esperar_erro(
  $$update usuarios set ativo = false where email = 'diretoria@teste'$$,
  'ao menos um usuário ativo da diretoria', 'última diretoria não pode ser desativada');
select pg_temp.esperar_erro(
  $$update usuarios set perfil_id = (select id from perfis where nome = 'Financeiro') where email = 'diretoria@teste'$$,
  'ao menos um usuário ativo da diretoria', 'última diretoria não pode trocar de perfil');

-- Com uma segunda pessoa na diretoria, a primeira pode sair
update usuarios set perfil_id = (select id from perfis where nome = 'Diretoria') where email = 'pcp@teste';
update usuarios set ativo = false where email = 'diretoria@teste';
select pg_temp.esperar((select count(*) from usuarios where not ativo) = 1, 'com outra diretoria ativa, a primeira pode ser desativada');
reset role;
