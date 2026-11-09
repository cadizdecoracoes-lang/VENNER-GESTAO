-- Teste das telas ao vivo: toda tabela que as telas podem ler está na
-- publicação do Realtime (senão a tela não percebe a mudança e fica velha), e
-- as tabelas guardadas (sem leitura direta) ficam de fora.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

select pg_temp.esperar(
  exists (select 1 from pg_publication where pubname = 'supabase_realtime'),
  'a publicação do Realtime existe');

select pg_temp.esperar(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      and has_table_privilege('authenticated', c.oid, 'select')
      and not exists (
        select 1 from pg_publication_tables p
        where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = c.relname)
  ),
  'toda tabela lida pelas telas avisa as telas abertas (falhou? inclua a tabela nova com alter publication supabase_realtime add table)');

select pg_temp.esperar(
  not exists (
    select 1 from pg_publication_tables p
    where p.pubname = 'supabase_realtime' and p.schemaname = 'public'
      and not has_table_privilege('authenticated', format('public.%I', p.tablename), 'select')),
  'tabelas guardadas (sem leitura pelas telas) não avisam ninguém');

select pg_temp.esperar(
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('contas_pagar', 'contas_receber', 'contas_bancarias', 'extrato_lancamentos', 'eventos_folha')) = 5,
  'contas a pagar, a receber, bancárias, extrato e eventos da folha estão ao vivo');

select pg_temp.esperar(
  not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'integracoes_plataforma'),
  'as chaves das integrações não avisam ninguém');
