-- Testes da migração 20261123000066 (indicadores rápidos): as funções dos
-- indicadores agora rodam como security definer e conferem as permissões uma
-- vez só. Confere que continuam respeitando o que cada perfil pode ver:
-- sem financeiro.pagar não soma contas a pagar, e só as empresas liberadas.
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

select set_config('teste.rap_a', id::text, false) from empresas where cnpj = '11111111000111';
select set_config('teste.rap_b', id::text, false) from empresas where cnpj = '22222222000122';

-- Perfil que vê os indicadores e o contas a receber, mas não o contas a
-- pagar, e só a empresa A.
insert into perfis (nome, todas_empresas) values ('Indicadores sem pagar', false);
insert into perfil_permissoes (perfil_id, tela_codigo, acao)
select id, t, 'ver' from perfis, unnest(array['estrategico.indicadores', 'financeiro.receber']) t
where nome = 'Indicadores sem pagar';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'indicadores-rapidos@teste');
update usuarios set ativo = true, perfil_id = (select id from perfis where nome = 'Indicadores sem pagar')
where id = '00000000-0000-0000-0000-0000000000a9';
insert into usuario_empresas (usuario_id, empresa_id) values ('00000000-0000-0000-0000-0000000000a9', current_setting('teste.rap_a')::uuid);

-- Dados de 2031, só deste teste: a pagar (ajuda de custo) e a receber nas
-- duas empresas.
insert into contas_pagar (empresa_id, descricao, valor, vencimento, situacao)
values (current_setting('teste.rap_a')::uuid, 'Ajuda de custo rapido', 111, '2031-01-10', 'aberto'),
       (current_setting('teste.rap_b')::uuid, 'Ajuda de custo rapido', 222, '2031-01-10', 'aberto');
insert into contas_receber (empresa_id, descricao, valor, vencimento, situacao)
values (current_setting('teste.rap_a')::uuid, 'Rapido R1', 1000, '2031-01-10', 'aberto'),
       (current_setting('teste.rap_b')::uuid, 'Rapido R2', 2000, '2031-01-10', 'aberto');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a9';
select set_config('teste.rap', indicadores_gestao('2031-01-01', '2031-01-31')::text, false);
select set_config('teste.rap_ajuda', (select count(*) from indicadores_ajuda_custo('2031-01-01', '2031-01-31'))::text, false);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select set_config('teste.rap_dir', indicadores_gestao('2031-01-01', '2031-01-31')::text, false);
select set_config('teste.rap_dir_ajuda', (select coalesce(sum(valor), 0) from indicadores_ajuda_custo('2031-01-01', '2031-01-31'))::text, false);
reset role;

select pg_temp.esperar(
  not exists (select 1 from jsonb_array_elements(current_setting('teste.rap')::jsonb -> 'titulos_mes') x where x ->> 'tipo' = 'pagar'),
  'sem financeiro.pagar não soma contas a pagar');
select pg_temp.esperar(
  (select sum((x ->> 'previsto')::numeric) = 1000
   from jsonb_array_elements(current_setting('teste.rap')::jsonb -> 'titulos_mes') x where x ->> 'tipo' = 'receber'),
  'só a empresa liberada entra no contas a receber');
select pg_temp.esperar(current_setting('teste.rap_ajuda')::int = 0, 'sem financeiro.pagar não vê a ajuda de custo');
select pg_temp.esperar(
  (select sum((x ->> 'previsto')::numeric) = 333
   from jsonb_array_elements(current_setting('teste.rap_dir')::jsonb -> 'titulos_mes') x where x ->> 'tipo' = 'pagar'),
  'diretoria continua vendo o contas a pagar das duas empresas');
select pg_temp.esperar(current_setting('teste.rap_dir_ajuda')::numeric = 333, 'diretoria vê a ajuda de custo');

-- A função interna dos títulos não é chamada pelas telas.
set role authenticated;
select pg_temp.esperar_erro($$select * from indicadores_titulos(array[]::uuid[], true, true)$$, 'permission denied',
  'tela não chama indicadores_titulos direto');
reset role;

-- Limpa o que este teste criou.
delete from contas_pagar where descricao = 'Ajuda de custo rapido';
delete from contas_receber where descricao in ('Rapido R1', 'Rapido R2');
