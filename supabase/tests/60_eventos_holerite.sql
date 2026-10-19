-- Testes dos eventos do holerite.
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

-- financeiro@teste terminou 50_cadastros_financeiro.sql como Contabilidade.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar((select count(*) from eventos_folha) = 17, 'contabilidade consulta os eventos do holerite');
select pg_temp.esperar_erro(
  $$insert into eventos_folha (codigo, descricao, tipo) values ('900', 'x', 'provento')$$,
  'row-level security', 'contabilidade não cria evento');
reset role;

update usuarios set perfil_id = (select id from perfis where nome = 'RH') where email = 'financeiro@teste';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
insert into eventos_folha (codigo, descricao, tipo, forma_calculo, incide_inss, incide_fgts, incide_irrf)
values ('011', 'Insalubridade', 'provento', 'percentual', true, true, true);
select pg_temp.esperar((select count(*) from eventos_folha) = 18, 'RH cadastra evento');
select pg_temp.esperar_erro(
  $$insert into eventos_folha (codigo, descricao, tipo, incide_inss) values ('202', 'Base INSS', 'informativo', true)$$,
  'check', 'evento informativo não tem incidência');
select pg_temp.esperar_erro(
  $$insert into eventos_folha (codigo, descricao, tipo) values ('001', 'Repetido', 'provento')$$,
  'duplicate', 'código do evento não se repete');
reset role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar((select count(*) from eventos_folha) = 0, 'compras não vê eventos do holerite');
reset role;
