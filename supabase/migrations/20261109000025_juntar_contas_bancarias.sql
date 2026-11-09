-- Conta bancária cadastrada duas vezes (ex.: "Itaú" criada à mão e "Itau"
-- que veio da leitura do Tiny).
--
-- uso_contas_bancarias: quantos títulos pagos/recebidos, linhas de extrato e
-- importações cada conta tem, para a tela mostrar qual é a conta "de verdade".
--
-- juntar_contas_bancarias(origem, destino): passa tudo da conta errada para a
-- certa e apaga a errada. Só quem pode excluir conta bancária e vê o CNPJ; as
-- duas contas têm de ser da mesma empresa.
-- - Títulos (pagar e receber), importações e linhas do extrato mudam de conta.
--   A mudança entra no histórico do contas a pagar (origem "manual").
-- - Linha de extrato que a conta certa já tinha (mesma chave) fica com a
--   chave marcada e, sendo o mesmo dia e valor de outra importação, sai da
--   lista de pendentes pela regra de repetidos (marcar_repetidos_extrato).
-- - O número do Tiny passa para a conta certa: assim a leitura do Tiny não
--   recria a conta apagada. Se as duas vieram do Tiny, são duas contas lá
--   também e a junção é recusada (deixe uma inativa ou junte no Tiny).
-- - O saldo inicial que vale é o da conta certa.

create function public.uso_contas_bancarias(empresa uuid default null)
returns table (conta_bancaria_id uuid, titulos integer, extrato integer, importacoes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id,
    ((select count(*) from public.contas_pagar p where p.conta_bancaria_id = b.id)
      + (select count(*) from public.contas_receber r where r.conta_bancaria_id = b.id))::integer,
    (select count(*) from public.extrato_lancamentos l where l.conta_bancaria_id = b.id)::integer,
    (select count(*) from public.extrato_importacoes i where i.conta_bancaria_id = b.id)::integer
  from public.contas_bancarias b
  where public.tem_permissao('financeiro.contas_bancarias', 'ver')
    and public.pode_ver_empresa(b.empresa_id)
    and (uso_contas_bancarias.empresa is null or b.empresa_id = uso_contas_bancarias.empresa);
$$;
revoke execute on function public.uso_contas_bancarias(uuid) from public, anon;
grant execute on function public.uso_contas_bancarias(uuid) to authenticated;

create function public.juntar_contas_bancarias(origem uuid, destino uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.contas_bancarias;
  b public.contas_bancarias;
  pagar integer;
  receber integer;
  linhas integer;
  imps integer;
begin
  if not public.tem_permissao('financeiro.contas_bancarias', 'excluir') then
    raise exception 'Seu perfil não pode excluir conta bancária';
  end if;
  if juntar_contas_bancarias.origem = juntar_contas_bancarias.destino then
    raise exception 'Escolha outra conta para receber os lançamentos';
  end if;
  select * into a from public.contas_bancarias where id = juntar_contas_bancarias.origem for update;
  select * into b from public.contas_bancarias where id = juntar_contas_bancarias.destino for update;
  if a.id is null or b.id is null or not public.pode_ver_empresa(a.empresa_id) or not public.pode_ver_empresa(b.empresa_id) then
    raise exception 'Conta bancária não encontrada';
  end if;
  if a.empresa_id <> b.empresa_id then
    raise exception 'As duas contas precisam ser da mesma empresa (CNPJ)';
  end if;
  if a.tiny_id is not null and b.tiny_id is not null then
    raise exception 'As duas contas vieram do Tiny (são duas contas lá também). Deixe uma inativa ou junte no Tiny primeiro.';
  end if;

  update public.contas_pagar set conta_bancaria_id = juntar_contas_bancarias.destino where conta_bancaria_id = juntar_contas_bancarias.origem;
  get diagnostics pagar = row_count;
  update public.contas_receber set conta_bancaria_id = juntar_contas_bancarias.destino where conta_bancaria_id = juntar_contas_bancarias.origem;
  get diagnostics receber = row_count;
  update public.extrato_conciliacoes set conta_anterior = juntar_contas_bancarias.destino where conta_anterior = juntar_contas_bancarias.origem;

  -- Mesma chave nas duas contas: a da conta errada ganha um sufixo para caber.
  update public.extrato_lancamentos l set chave = l.chave || '|junta:' || juntar_contas_bancarias.origem
  where l.conta_bancaria_id = juntar_contas_bancarias.origem
    and exists (select 1 from public.extrato_lancamentos d where d.conta_bancaria_id = juntar_contas_bancarias.destino and d.chave = l.chave);
  update public.extrato_lancamentos set conta_bancaria_id = juntar_contas_bancarias.destino where conta_bancaria_id = juntar_contas_bancarias.origem;
  get diagnostics linhas = row_count;
  update public.extrato_importacoes set conta_bancaria_id = juntar_contas_bancarias.destino where conta_bancaria_id = juntar_contas_bancarias.origem;
  get diagnostics imps = row_count;

  if a.tiny_id is not null then
    update public.contas_bancarias set tiny_id = null where id = juntar_contas_bancarias.origem;
    update public.contas_bancarias set tiny_id = a.tiny_id where id = juntar_contas_bancarias.destino;
  end if;

  delete from public.contas_bancarias where id = juntar_contas_bancarias.origem;
  if linhas > 0 then
    perform public.marcar_repetidos_extrato(juntar_contas_bancarias.destino);
  end if;

  return jsonb_build_object('pagar', pagar, 'receber', receber, 'extrato', linhas, 'importacoes', imps);
end;
$$;
revoke execute on function public.juntar_contas_bancarias(uuid, uuid) from public, anon;
grant execute on function public.juntar_contas_bancarias(uuid, uuid) to authenticated;
