-- =============================================================================
-- Venner Gestão · Títulos só pelo Tiny
--
-- Pedido do Alexandre (23/11/2026): contas a pagar e a receber se criam,
-- editam, baixam e excluem só no Tiny. O sistema Venner só reflete o que vem
-- de lá. A conciliação e a importação do extrato continuam: é por elas que se
-- descobre o que falta lançar no Tiny.
--
-- - Os títulos lançados só aqui (sem tiny_id), inclusive as transferências do
--   botão "Lançar transferência", são excluídos. As linhas do extrato ligadas
--   a eles voltam para pendente, para serem lançadas no Tiny e conciliadas com
--   o título que vier de lá. O conteúdo de cada título excluído fica na
--   auditoria (gatilho registrar_auditoria).
-- - bloquear_titulo_tiny passa a valer também na criação e para título sem
--   Tiny: o que chega pela API do site (sessão "authenticator") só grava
--   título se for a leitura do Tiny, o "Deixar igual ao Tiny" ou a junção de
--   contas bancárias. Editar e excluir título do Tiny segue barrado como antes
--   para qualquer sessão.
-- - lancar_transferencia, registrar_nota_fornecedor, gerar_receber_pedido e
--   importar_vendas_plataforma ficam no banco, mas pelo site caem nesse
--   bloqueio com a mensagem de lançar no Tiny. As telas não mostram mais
--   esses botões.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Excluir os títulos lançados só aqui
-- -----------------------------------------------------------------------------
-- Função (só para a migração e os testes) que devolve quantos saíram.
create function public.excluir_titulos_so_aqui()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  pagar uuid[];
  receber uuid[];
  linhas uuid[];
  r jsonb;
begin
  select coalesce(array_agg(id), '{}') into pagar from public.contas_pagar where tiny_id is null;
  select coalesce(array_agg(id), '{}') into receber from public.contas_receber where tiny_id is null;

  -- Linhas do extrato ligadas a eles (o grupo inteiro de uma conciliação de várias linhas).
  select coalesce(array_agg(distinct c2.lancamento_id), '{}') into linhas
  from public.extrato_conciliacoes c
  join public.extrato_conciliacoes c2 on c2.grupo = c.grupo or c2.lancamento_id = c.lancamento_id
  where c.conta_pagar_id = any(pagar) or c.conta_receber_id = any(receber);

  delete from public.extrato_conciliacoes where lancamento_id = any(linhas);
  update public.extrato_lancamentos
  set situacao = 'pendente', observacao = null, conciliado_por = null, conciliado_em = null
  where id = any(linhas) and situacao = 'conciliado';

  delete from public.contas_pagar where id = any(pagar);
  delete from public.contas_receber where id = any(receber);

  r := jsonb_build_object('pagar', cardinality(pagar), 'receber', cardinality(receber), 'linhas_pendentes', cardinality(linhas));
  raise notice 'Títulos lançados só aqui excluídos: %', r;
  return r;
end;
$$;
revoke execute on function public.excluir_titulos_so_aqui() from public, anon, authenticated;

select public.excluir_titulos_so_aqui();

-- -----------------------------------------------------------------------------
-- 2. Pelo site, título só muda pela leitura do Tiny
-- -----------------------------------------------------------------------------
create or replace function public.bloquear_titulo_tiny()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pilha text;
begin
  -- A leitura do Tiny liga este aviso enquanto grava.
  if coalesce(current_setting('venner.leitura_tiny', true), '') = 'sim' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Criar título e mexer em título sem Tiny: barrado quando vem do site
  -- (migrações e manutenção direta no banco passam).
  if (tg_op = 'INSERT' or old.tiny_id is null) and session_user <> 'authenticator' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  get diagnostics pilha = pg_context;
  -- Só a leitura do Tiny, o "Deixar igual ao Tiny" e a junção de contas
  -- bancárias repetidas (troca a conta pelo cadastro que fica).
  if pilha ~ '(tiny_aplicar|igualar_ao_tiny|juntar_contas_bancarias)' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Contas a pagar e a receber são lançadas só no Tiny: lance lá e o título aparece aqui sozinho';
  end if;
  raise exception 'Este título vem do Tiny: altere, baixe ou exclua no Tiny e ele muda aqui sozinho';
end;
$$;
revoke execute on function public.bloquear_titulo_tiny() from public, anon, authenticated;

drop trigger bloquear_titulo_tiny on public.contas_pagar;
drop trigger bloquear_titulo_tiny on public.contas_receber;
create trigger bloquear_titulo_tiny before insert or update or delete on public.contas_pagar
  for each row execute function public.bloquear_titulo_tiny();
create trigger bloquear_titulo_tiny before insert or update or delete on public.contas_receber
  for each row execute function public.bloquear_titulo_tiny();
