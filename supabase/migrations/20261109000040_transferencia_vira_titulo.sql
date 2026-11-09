-- Transferência entre contas vira título (pedido do Alexandre em 09/11/2026:
-- "tudo o que acontece na tela de conciliação precisa vir obrigatoriamente de
-- contas a pagar ou contas a receber", escolhendo que toda transferência,
-- mesmo entre contas do mesmo CNPJ, tenha título).
--
-- - Categorias "Transferência entre contas" (uma de despesa e uma de
--   receita), criadas na raiz do plano se ainda não existirem.
-- - lancar_transferencia(lancamento): para a linha do extrato (pendente ou já
--   marcada como transferência antes desta regra), cria o título já baixado
--   nesta conta na data do extrato (saída = contas a pagar, entrada = contas a
--   receber) e concilia a linha com ele.
-- - marcar_lancamento não aceita mais "transferencia" (só "ignorado").
-- - Título de transferência que volta para em aberto (desfazer a conciliação
--   ou excluir a importação) é cancelado: ele só existe por causa da linha.

-- -----------------------------------------------------------------------------
-- Categorias
-- -----------------------------------------------------------------------------
do $$
declare
  proximo integer;
  t public.tipo_plano_conta;
begin
  foreach t in array array['despesa', 'receita']::public.tipo_plano_conta[] loop
    if not exists (
      select 1 from public.plano_contas c
      where c.tipo = t and c.nome = 'Transferência entre contas'
        and not exists (select 1 from public.plano_contas f where f.pai_id = c.id)
    ) then
      select coalesce(max(codigo::integer), 0) + 1 into proximo from public.plano_contas where codigo ~ '^\d+$';
      insert into public.plano_contas (codigo, nome, tipo) values (proximo::text, 'Transferência entre contas', t);
    end if;
  end loop;
end $$;

create function public.categoria_transferencia(tipo public.tipo_plano_conta)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id from public.plano_contas c
  where c.tipo = categoria_transferencia.tipo and c.nome = 'Transferência entre contas'
    and not exists (select 1 from public.plano_contas f where f.pai_id = c.id)
  order by c.ativa desc, c.criado_em
  limit 1;
$$;
revoke execute on function public.categoria_transferencia(public.tipo_plano_conta) from public, anon;
grant execute on function public.categoria_transferencia(public.tipo_plano_conta) to authenticated;

-- -----------------------------------------------------------------------------
-- Lançar a transferência como título
-- -----------------------------------------------------------------------------
create function public.lancar_transferencia(lancamento uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.extrato_lancamentos;
  conta_nome text;
  novo uuid;
  descricao text;
begin
  if not public.tem_permissao('financeiro.conciliacao', 'editar') then
    raise exception 'Seu perfil não pode conciliar o extrato';
  end if;
  select * into l from public.extrato_lancamentos where id = lancamento for update;
  if l.id is null or not public.pode_ver_empresa(l.empresa_id) then
    raise exception 'Lançamento do extrato não encontrado';
  end if;
  if l.situacao not in ('pendente', 'transferencia') then
    raise exception 'Este lançamento já foi conciliado';
  end if;
  -- Linha marcada como transferência antes desta regra: volta a pendente para conciliar.
  update public.extrato_lancamentos set situacao = 'pendente', observacao = null where id = lancamento;

  select nome into conta_nome from public.contas_bancarias where id = l.conta_bancaria_id;
  descricao := left('Transferência entre contas · ' || l.descricao, 300);
  if l.valor < 0 then
    insert into public.contas_pagar (empresa_id, descricao, categoria_id, valor, vencimento, observacao)
    values (l.empresa_id, descricao, public.categoria_transferencia('despesa'), abs(l.valor), l.data,
      'Transferência lançada pela conciliação (' || coalesce(conta_nome, 'conta') || ')')
    returning id into novo;
    perform public.conciliar_lancamento(lancamento, array[novo], array[]::uuid[]);
  else
    insert into public.contas_receber (empresa_id, canal, descricao, categoria_id, valor, vencimento, observacao)
    values (l.empresa_id, 'outro', descricao, public.categoria_transferencia('receita'), l.valor, l.data,
      'Transferência lançada pela conciliação (' || coalesce(conta_nome, 'conta') || ')')
    returning id into novo;
    perform public.conciliar_lancamento(lancamento, array[]::uuid[], array[novo]);
  end if;
  return novo;
end;
$$;
revoke execute on function public.lancar_transferencia(uuid) from public, anon;
grant execute on function public.lancar_transferencia(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Marcar como transferência sem título deixa de existir
-- -----------------------------------------------------------------------------
create or replace function public.marcar_lancamento(lancamento uuid, situacao public.situacao_extrato, observacao text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.tem_permissao('financeiro.conciliacao', 'editar') then
    raise exception 'Seu perfil não pode conciliar o extrato';
  end if;
  if marcar_lancamento.situacao = 'transferencia' then
    raise exception 'Transferência agora vira título: use "Lançar transferência"';
  end if;
  if marcar_lancamento.situacao <> 'ignorado' then
    raise exception 'Use a conciliação com títulos para conciliar';
  end if;
  if nullif(trim(marcar_lancamento.observacao), '') is null then
    raise exception 'Escreva o motivo para ignorar o lançamento';
  end if;
  update public.extrato_lancamentos e
  set situacao = marcar_lancamento.situacao, observacao = nullif(trim(marcar_lancamento.observacao), ''),
    conciliado_por = auth.uid(), conciliado_em = now()
  where e.id = lancamento and e.situacao = 'pendente';
  if not found then
    raise exception 'Este lançamento já foi resolvido ou não foi encontrado';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Título de transferência que perde a baixa é cancelado
-- -----------------------------------------------------------------------------
create function public.cancelar_transferencia_reaberta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.situacao = 'pago' and new.situacao = 'aberto' and new.observacao like 'Transferência lançada pela conciliação%' then
    new.situacao := 'cancelado';
  end if;
  return new;
end;
$$;

create trigger cancelar_transferencia_reaberta
  before update of situacao on public.contas_pagar
  for each row execute function public.cancelar_transferencia_reaberta();
create trigger cancelar_transferencia_reaberta
  before update of situacao on public.contas_receber
  for each row execute function public.cancelar_transferencia_reaberta();
