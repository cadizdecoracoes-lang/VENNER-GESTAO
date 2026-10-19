-- Testes da ficha técnica (versões, aprovação, ciclos), do histórico de regime
-- e das permissões do usuário logado. Usa os usuários criados em 10_permissoes.sql.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not condicao then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

-- Executa um comando que precisa falhar com a mensagem indicada.
create function pg_temp.esperar_erro(comando text, trecho text, mensagem text) returns void language plpgsql as $$
begin
  execute comando;
  raise exception 'FALHOU: %', mensagem;
exception when others then
  if sqlerrm like 'FALHOU%' or sqlerrm not like '%' || trecho || '%' then raise; end if;
  raise notice 'ok: %', mensagem;
end $$;

-- Permissões do usuário logado
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(
  exists (select 1 from minhas_permissoes() where tela_codigo = 'producao.ficha_tecnica' and acao = 'editar'),
  'PCP recebe a permissão de editar ficha técnica');
select pg_temp.esperar(
  not exists (select 1 from minhas_permissoes() where acao in ('excluir', 'aprovar')),
  'PCP não recebe excluir nem aprovar');
select pg_temp.esperar(
  not exists (select 1 from minhas_permissoes() where tela_codigo like 'financeiro.%'),
  'PCP não recebe telas do financeiro');
reset role;

-- Regime tributário: cadastro e troca ficam no histórico
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.esperar(
  (select count(*) from empresas_regime_historico h join empresas e on e.id = h.empresa_id where e.cnpj = '22222222000122') = 1,
  'cadastro da empresa grava o regime no histórico');
update empresas set regime_tributario = 'lucro_presumido' where cnpj = '22222222000122';
select pg_temp.esperar(
  (select h.regime_tributario from empresas_regime_historico h join empresas e on e.id = h.empresa_id
   where e.cnpj = '22222222000122' and h.vigencia_inicio = current_date) = 'lucro_presumido',
  'troca de regime atualiza o histórico');
reset role;

-- Ficha técnica feita pelo PCP
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into itens (codigo, descricao, tipo, unidade) values ('SC1', 'Subconjunto', 'subconjunto', 'UN');

select pg_temp.esperar(
  nova_versao_ficha((select id from itens where codigo = 'PA1')) = (select f.id from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'PA1'),
  'nova versão devolve o rascunho que já existe');

insert into ficha_componentes (ficha_id, componente_id, quantidade)
select f.id, c.id, 2
from fichas_tecnicas f join itens p on p.id = f.item_id, itens c
where p.codigo = 'PA1' and c.codigo in ('MP1', 'SC1');

insert into ficha_operacoes (ficha_id, sequencia, descricao)
select f.id, 10, 'Montagem' from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'PA1';
with d as (delete from ficha_operacoes returning 1)
select pg_temp.esperar((select count(*) from d) = 1, 'PCP tira uma operação do rascunho');

select nova_versao_ficha((select id from itens where codigo = 'SC1'));
select pg_temp.esperar_erro(
  $$insert into ficha_componentes (ficha_id, componente_id, quantidade)
    select f.id, (select id from itens where codigo = 'PA1'), 1
    from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'SC1'$$,
  'Estrutura circular', 'estrutura circular em dois níveis é recusada');

select pg_temp.esperar_erro(
  $$select ativar_ficha((select f.id from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'PA1'))$$,
  'não pode aprovar', 'PCP não ativa ficha técnica');

select pg_temp.esperar_erro(
  $$update fichas_tecnicas set status = 'ativa' where versao = 1$$,
  'não pode aprovar', 'PCP não ativa ficha mudando o status direto');
reset role;

-- Diretoria aprova
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.esperar_erro(
  $$select ativar_ficha((select f.id from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'SC1'))$$,
  'ao menos um componente', 'ficha sem componentes não é ativada');

select ativar_ficha((select f.id from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'PA1'));
select pg_temp.esperar(
  (select f.status from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'PA1' and f.versao = 1) = 'ativa',
  'diretoria ativa a ficha');

select pg_temp.esperar_erro(
  $$update ficha_componentes set quantidade = 5$$,
  'Só o rascunho', 'componente de ficha ativa não muda');
select pg_temp.esperar_erro(
  $$delete from fichas_tecnicas f using itens i where i.id = f.item_id and i.codigo = 'PA1'$$,
  'não podem ser apagadas', 'ficha ativa não é apagada');

select nova_versao_ficha((select id from itens where codigo = 'PA1'));
select pg_temp.esperar(
  (select count(*) from ficha_componentes c join fichas_tecnicas f on f.id = c.ficha_id
   join itens i on i.id = f.item_id where i.codigo = 'PA1' and f.status = 'rascunho') = 2,
  'nova versão copia os componentes da ativa');
select pg_temp.esperar(
  (select versao from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'PA1' and f.status = 'rascunho') = 2,
  'nova versão recebe o número seguinte');

select ativar_ficha((select f.id from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'PA1' and f.versao = 2));
select pg_temp.esperar(
  (select string_agg(f.versao || ':' || f.status, ',' order by f.versao)
   from fichas_tecnicas f join itens i on i.id = f.item_id where i.codigo = 'PA1') = '1:substituida,2:ativa',
  'ativar a versão 2 substitui a versão 1');
reset role;
