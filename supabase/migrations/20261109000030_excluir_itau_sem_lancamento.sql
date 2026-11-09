-- Conta Itaú cadastrada duas vezes (pedido do Alexandre em 09/11/2026: "a
-- conta bancária do Itaú que não tiver lançamento pode excluir").
--
-- Em cada empresa com mais de uma conta Itaú (nome com "Itaú"/"Itau" ou banco
-- 341), apaga as que não têm nenhum lançamento: nenhum título pago/recebido
-- nela, nenhuma linha ou importação de extrato, nenhuma conciliação que
-- aponte para ela. Sempre fica ao menos uma Itaú na empresa:
-- - se alguma tem lançamento, ficam todas as que têm;
-- - se nenhuma tem, fica a que veio do Tiny (ou a mais antiga).
-- O número do Tiny da conta apagada passa para a que fica (assim a leitura do
-- Tiny não recria a conta). Se a apagada e a que fica vieram as duas do Tiny,
-- nada é apagado (são duas contas lá também).

create function public.excluir_itau_sem_lancamento()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  e record;
  c record;
  fica uuid;
  apagadas integer := 0;
begin
  for e in
    select b.empresa_id
    from public.contas_bancarias b
    where translate(lower(b.nome), 'áàâãú', 'aaaau') like '%itau%' or b.banco_codigo = '341'
    group by b.empresa_id
    having count(*) > 1
  loop
    -- A que fica: a com mais lançamentos; empate, a do Tiny; depois a mais antiga.
    fica := null;
    for c in
      select b.id, b.tiny_id,
        (select count(*) from public.contas_pagar p where p.conta_bancaria_id = b.id)
        + (select count(*) from public.contas_receber r where r.conta_bancaria_id = b.id)
        + (select count(*) from public.extrato_lancamentos l where l.conta_bancaria_id = b.id)
        + (select count(*) from public.extrato_importacoes i where i.conta_bancaria_id = b.id)
        + (select count(*) from public.extrato_conciliacoes x where x.conta_anterior = b.id) as usos
      from public.contas_bancarias b
      where b.empresa_id = e.empresa_id
        and (translate(lower(b.nome), 'áàâãú', 'aaaau') like '%itau%' or b.banco_codigo = '341')
      order by usos desc, (b.tiny_id is not null) desc, b.criado_em, b.id
    loop
      if fica is null then
        fica := c.id;
        continue;
      end if;
      if c.usos > 0 then
        continue;
      end if;
      if c.tiny_id is not null then
        if (select tiny_id from public.contas_bancarias where id = fica) is not null then
          raise notice 'Itaú % não apagada: ela e a que fica vieram do Tiny', c.id;
          continue;
        end if;
        update public.contas_bancarias set tiny_id = null where id = c.id;
        update public.contas_bancarias set tiny_id = c.tiny_id where id = fica;
      end if;
      delete from public.contas_bancarias where id = c.id;
      apagadas := apagadas + 1;
      raise notice 'Itaú sem lançamento apagada: %', c.id;
    end loop;
  end loop;
  return apagadas;
end;
$$;
revoke execute on function public.excluir_itau_sem_lancamento() from public, anon, authenticated;

select public.excluir_itau_sem_lancamento();
