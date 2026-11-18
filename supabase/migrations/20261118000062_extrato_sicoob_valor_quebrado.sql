-- Lançamentos errados do extrato em PDF do Sicoob (pedido do Alexandre em
-- 17/11/2026: "alguns lançamentos estão no sistema como crédito, e na verdade
-- são débito").
--
-- No PDF do Sicoob, valor de 1.000,00 para cima quebra em duas linhas (o
-- número e o C/D) e o número sai um pouco acima da linha com a data. A leitura
-- antiga juntava esse número como complemento do lançamento de cima, perdia o
-- lançamento de baixo e o C/D dele trocava o sinal do de cima. Ficava assim:
-- "TARIFA COBRANÇA · 2.278,56 · 05/11 CRÉD.LIQ.COBRANÇA" com + R$ 1,10.
-- A leitura foi corrigida em src/lib/extrato-pdf.ts (lerSicoob).
--
-- Aqui apagamos as linhas que ficaram erradas, só elas:
-- - só linhas vindas de PDF;
-- - só as que têm um valor solto no meio do texto (" · 2.278,56 · "), a marca
--   desse erro (nenhum leitor de PDF põe valor no complemento);
-- - só pendentes ou ignoradas, e sem nenhuma conciliação ligada.
-- Linha errada que alguém já conciliou fica como está (aparece num aviso) para
-- ser desfeita na tela. Depois, importar o mesmo PDF de novo traz os
-- lançamentos certos; os que já estavam certos são reconhecidos como repetidos.
-- A contagem "importadas" da importação diminui das pendentes apagadas.

create function public.excluir_linhas_sicoob_valor_quebrado()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  apagadas integer;
  sobra integer;
  marca constant text := ' · [0-9]{1,3}(\.[0-9]{3})*,[0-9]{2} ?[CD*]?( · |$)';
begin
  with erradas as (
    select l.id, l.importacao_id, l.situacao
    from public.extrato_lancamentos l
    join public.extrato_importacoes i on i.id = l.importacao_id
    where i.origem = 'pdf' and l.descricao ~ marca
  ),
  apagar as (
    delete from public.extrato_lancamentos l
    using erradas e
    where l.id = e.id
      and e.situacao in ('pendente', 'ignorado')
      and not exists (select 1 from public.extrato_conciliacoes c where c.lancamento_id = l.id)
    returning e.importacao_id, e.situacao
  ),
  contagem as (
    update public.extrato_importacoes i
    set importadas = greatest(i.importadas - a.n, 0)
    from (select importacao_id, count(*) filter (where situacao = 'pendente') as n from apagar group by importacao_id) a
    where i.id = a.importacao_id
    returning i.id
  )
  select (select count(*) from apagar) into apagadas;

  select count(*) into sobra
  from public.extrato_lancamentos l
  join public.extrato_importacoes i on i.id = l.importacao_id
  where i.origem = 'pdf' and l.descricao ~ marca;
  if sobra > 0 then
    raise notice '% linha(s) errada(s) do PDF ficaram por estarem conciliadas ou como transferência', sobra;
  end if;
  raise notice '% linha(s) errada(s) do PDF apagadas', apagadas;
  return apagadas;
end;
$$;
revoke execute on function public.excluir_linhas_sicoob_valor_quebrado() from public, anon, authenticated;

select public.excluir_linhas_sicoob_valor_quebrado();
