-- Telas ao vivo (pedido do Alexandre em 09/11/2026: "deixar o sistema online
-- automático ao vivo com todas as criações, edições ou exclusões nas telas").
--
-- Até aqui cada tela só buscava os dados de novo quando a própria pessoa
-- gravava algo ou mudava um filtro. O que outra pessoa, outra aba do navegador
-- ou o robô do Tiny mudava só aparecia depois de um F5, e uma tela velha podia
-- levar a pagar algo que já tinha sido excluído.
--
-- Agora as tabelas do sistema entram na publicação "supabase_realtime" do
-- Supabase: cada criação, edição ou exclusão avisa as telas abertas, que
-- buscam os dados de novo sozinhas (src/components/ao-vivo.tsx).
--
-- Só entram as tabelas que as telas já podem ler (GRANT select ao
-- authenticated). O Realtime confere a mesma permissão e as mesmas políticas
-- (RLS) de cada pessoa antes de mandar o aviso, então ninguém recebe aviso de
-- linha que não poderia ver. Tabelas guardadas (chaves das integrações) ficam
-- fora.
--
-- Tabela nova daqui em diante: incluir na publicação na mesma migração
-- (alter publication supabase_realtime add table ...). O teste
-- supabase/tests/99k_telas_ao_vivo.sql falha se alguma ficar de fora.

do $$
declare
  t record;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and has_table_privilege('authenticated', c.oid, 'select')
      and not exists (
        select 1 from pg_publication_tables p
        where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = c.relname
      )
    order by c.relname
  loop
    execute format('alter publication supabase_realtime add table public.%I', t.relname);
  end loop;
end $$;
