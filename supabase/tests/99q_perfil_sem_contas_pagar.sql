-- Perfil copiado da Diretoria sem a tela Contas a pagar (caso do usuário das
-- integrações): o banco bloqueia os títulos a pagar e libera o resto.
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'integracao@teste');

-- A Diretoria cria o perfil pela tela Perfis: copia as permissões da Diretoria
-- e desmarca Contas a pagar (a tela grava pela definir_permissoes_perfil).
select set_config('request.jwt.claim.sub', u.id::text, false)
from usuarios u join perfis p on p.id = u.perfil_id
where u.ativo and p.nome = 'Diretoria' limit 1;
set role authenticated;
insert into perfis (nome, descricao) values ('Integração', 'Igual à Diretoria, sem contas a pagar');
select definir_permissoes_perfil(
  (select id from perfis where nome = 'Integração'),
  (select array_agg(pp.tela_codigo || ':' || pp.acao::text)
   from perfil_permissoes pp join perfis p on p.id = pp.perfil_id
   where p.nome = 'Diretoria' and pp.tela_codigo <> 'financeiro.pagar')
);
reset role;

update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Integração')
where email = 'integracao@teste';
insert into usuario_empresas (usuario_id, empresa_id)
select '00000000-0000-0000-0000-0000000000e1', id from empresas;

select pg_temp.esperar((select count(*) from contas_pagar) > 0, 'há títulos a pagar para o teste');
select pg_temp.esperar((select count(*) from contas_receber) > 0, 'há títulos a receber para o teste');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.esperar(not tem_permissao('financeiro.pagar', 'ver'), 'perfil novo não tem contas a pagar');
select pg_temp.esperar(tem_permissao('config.integracoes', 'editar'), 'perfil novo mantém Integrações');
select pg_temp.esperar((select count(*) from contas_pagar) = 0, 'não enxerga nenhum título a pagar');
select pg_temp.esperar((select count(*) from contas_pagar_historico) = 0, 'não enxerga o histórico do contas a pagar');
select pg_temp.esperar((select count(*) from contas_receber) > 0, 'continua enxergando o contas a receber');
select pg_temp.esperar((select count(*) from empresas) = (select count(*) from usuario_empresas
  where usuario_id = '00000000-0000-0000-0000-0000000000e1'), 'enxerga todos os CNPJs marcados');
select pg_temp.esperar_erro(
  $$insert into contas_pagar (empresa_id, descricao, valor, vencimento)
    values ((select id from empresas limit 1), 'Tentativa', 10, '2026-12-01')$$,
  'row-level security', 'não lança título a pagar');
with alterados as (update contas_pagar set descricao = descricao || ' (alterado)' returning id)
select pg_temp.esperar((select count(*) from alterados) = 0, 'não altera título a pagar');
with apagados as (delete from contas_pagar returning id)
select pg_temp.esperar((select count(*) from apagados) = 0, 'não apaga título a pagar');
reset role;
