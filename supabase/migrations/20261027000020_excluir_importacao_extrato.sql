-- Excluir uma importação de extrato da conciliação bancária e conciliar os
-- pagos do Tiny que vieram sem a conta do banco.
--
-- 1. Título pago pelo Tiny sem a conta da baixa fica em "Tiny · conta não
--    informada". Agora ele também casa com o extrato de qualquer conta da
--    empresa: ao conciliar, passa para a conta e a data do extrato (a conta e
--    a data de antes ficam guardadas e voltam se a conciliação for desfeita).
--
-- 2. Excluir importação:
-- Apaga a importação e as linhas dela. Antes, desfaz o que as linhas fizeram
-- nos títulos, do mesmo jeito que "desfazer" a conciliação de uma linha:
-- título baixado pela conciliação volta a ficar em aberto; título que já
-- estava pago só perde a ligação com o extrato.
-- Só quem tem "excluir" na conciliação (de fábrica, a Diretoria) e vê o CNPJ.

alter table public.extrato_conciliacoes
  add column conta_anterior uuid references public.contas_bancarias(id),
  add column data_anterior date;

-- Conta criada pela leitura do Tiny para os pagos sem conta informada.
create function public.conta_tiny_sem_banco(conta_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.contas_bancarias where id = conta_tiny_sem_banco.conta_id and nome = 'Tiny · conta não informada');
$$;
grant execute on function public.conta_tiny_sem_banco(uuid) to authenticated;

-- Devolve a conta e a data de antes aos pagos do Tiny que a conciliação
-- dessas linhas tinha trazido para a conta do extrato.
create function public.devolver_conta_tiny(linhas uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.contas_pagar p set conta_bancaria_id = c.conta_anterior, data_pagamento = c.data_anterior
  from public.extrato_conciliacoes c
  where c.lancamento_id = any(linhas) and c.conta_pagar_id = p.id and c.conta_anterior is not null and p.situacao = 'pago';
  update public.contas_receber r set conta_bancaria_id = c.conta_anterior, data_recebimento = c.data_anterior
  from public.extrato_conciliacoes c
  where c.lancamento_id = any(linhas) and c.conta_receber_id = r.id and c.conta_anterior is not null and r.situacao = 'pago';
end;
$$;
revoke execute on function public.devolver_conta_tiny(uuid[]) from public, anon;
grant execute on function public.devolver_conta_tiny(uuid[]) to authenticated;

create or replace function public.conciliar_lancamento(lancamento uuid, pagar uuid[] default '{}', receber uuid[] default '{}')
returns void
language plpgsql
set search_path = ''
as $$
declare
  l public.extrato_lancamentos;
  t record;
  quantos integer := coalesce(cardinality(pagar), 0) + coalesce(cardinality(receber), 0);
  soma numeric := 0;
  alvo numeric;
begin
  if not public.tem_permissao('financeiro.conciliacao', 'editar') then
    raise exception 'Seu perfil não pode conciliar o extrato';
  end if;
  select * into l from public.extrato_lancamentos where id = lancamento for update;
  if l.id is null then
    raise exception 'Lançamento do extrato não encontrado';
  end if;
  if l.situacao <> 'pendente' then
    raise exception 'Este lançamento já foi resolvido. Desfaça antes de conciliar de novo';
  end if;
  if quantos = 0 then
    raise exception 'Escolha ao menos um título para conciliar';
  end if;
  if l.valor < 0 and coalesce(cardinality(receber), 0) > 0 then
    raise exception 'Saída do extrato se concilia com contas a pagar';
  end if;
  if l.valor > 0 and coalesce(cardinality(pagar), 0) > 0 then
    raise exception 'Entrada do extrato se concilia com contas a receber';
  end if;
  alvo := abs(l.valor);

  for t in
    select p.id, p.empresa_id, p.situacao, p.valor, p.valor_pago as pago, p.conta_bancaria_id, p.descricao
    from public.contas_pagar p where p.id = any(pagar)
    union all
    select r.id, r.empresa_id, r.situacao, r.valor_liquido, r.valor_recebido, r.conta_bancaria_id, r.descricao
    from public.contas_receber r where r.id = any(receber)
  loop
    if t.empresa_id <> l.empresa_id then
      raise exception 'O título "%" é de outra empresa', t.descricao;
    end if;
    if t.situacao = 'cancelado' then
      raise exception 'O título "%" está cancelado', t.descricao;
    end if;
    if t.situacao = 'pago' and t.conta_bancaria_id <> l.conta_bancaria_id and not public.conta_tiny_sem_banco(t.conta_bancaria_id) then
      raise exception 'O título "%" foi baixado em outra conta bancária. Estorne a baixa ou concilie na conta certa', t.descricao;
    end if;
    soma := soma + case when t.situacao = 'pago' then t.pago when quantos = 1 then alvo else t.valor end;
  end loop;
  if (select count(*) from public.contas_pagar where id = any(pagar)) + (select count(*) from public.contas_receber where id = any(receber)) <> quantos then
    raise exception 'Algum título não foi encontrado ou seu perfil não o enxerga';
  end if;
  if abs(soma - alvo) > 0.009 then
    raise exception 'Os títulos somam % e o extrato mostra %. Ajuste a escolha', to_char(soma, 'FM999G999G990D00'), to_char(alvo, 'FM999G999G990D00');
  end if;

  -- Vínculo e baixa. Pago do Tiny sem conta guarda a conta e a data de antes.
  insert into public.extrato_conciliacoes (lancamento_id, conta_pagar_id, valor, efeito, conta_anterior, data_anterior)
  select lancamento, p.id, case when p.situacao = 'pago' then p.valor_pago when quantos = 1 then alvo else p.valor end,
    case when p.situacao = 'pago' then 'vinculou' else 'baixou' end,
    case when p.situacao = 'pago' and p.conta_bancaria_id <> l.conta_bancaria_id then p.conta_bancaria_id end,
    case when p.situacao = 'pago' and p.conta_bancaria_id <> l.conta_bancaria_id then p.data_pagamento end
  from public.contas_pagar p where p.id = any(pagar);
  insert into public.extrato_conciliacoes (lancamento_id, conta_receber_id, valor, efeito, conta_anterior, data_anterior)
  select lancamento, r.id, case when r.situacao = 'pago' then r.valor_recebido when quantos = 1 then alvo else r.valor_liquido end,
    case when r.situacao = 'pago' then 'vinculou' else 'baixou' end,
    case when r.situacao = 'pago' and r.conta_bancaria_id <> l.conta_bancaria_id then r.conta_bancaria_id end,
    case when r.situacao = 'pago' and r.conta_bancaria_id <> l.conta_bancaria_id then r.data_recebimento end
  from public.contas_receber r where r.id = any(receber);

  -- Pago do Tiny sem conta: passa a ser desta conta, na data do extrato.
  update public.contas_pagar p set conta_bancaria_id = l.conta_bancaria_id, data_pagamento = l.data
  from public.extrato_conciliacoes c
  where c.lancamento_id = lancamento and c.conta_pagar_id = p.id and c.conta_anterior is not null;
  update public.contas_receber r set conta_bancaria_id = l.conta_bancaria_id, data_recebimento = l.data
  from public.extrato_conciliacoes c
  where c.lancamento_id = lancamento and c.conta_receber_id = r.id and c.conta_anterior is not null;

  update public.contas_pagar p set situacao = 'pago', data_pagamento = l.data, conta_bancaria_id = l.conta_bancaria_id,
    valor_pago = c.valor
  from public.extrato_conciliacoes c
  where c.lancamento_id = lancamento and c.conta_pagar_id = p.id and c.efeito = 'baixou';
  update public.contas_receber r set situacao = 'pago', data_recebimento = l.data, conta_bancaria_id = l.conta_bancaria_id,
    valor_recebido = c.valor
  from public.extrato_conciliacoes c
  where c.lancamento_id = lancamento and c.conta_receber_id = r.id and c.efeito = 'baixou';

  update public.extrato_lancamentos set situacao = 'conciliado', conciliado_por = auth.uid(), conciliado_em = now()
  where id = lancamento;
end;
$$;
create or replace function public.desfazer_conciliacao(lancamento uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  l public.extrato_lancamentos;
  pagar uuid[];
  receber uuid[];
begin
  if not public.tem_permissao('financeiro.conciliacao', 'editar') then
    raise exception 'Seu perfil não pode conciliar o extrato';
  end if;
  select * into l from public.extrato_lancamentos where id = lancamento for update;
  if l.id is null then
    raise exception 'Lançamento do extrato não encontrado';
  end if;

  select array_agg(conta_pagar_id) filter (where efeito = 'baixou'), array_agg(conta_receber_id) filter (where efeito = 'baixou')
  into pagar, receber
  from public.extrato_conciliacoes where lancamento_id = lancamento;
  perform public.devolver_conta_tiny(array[lancamento]);
  delete from public.extrato_conciliacoes where lancamento_id = lancamento;

  update public.contas_pagar set situacao = 'aberto', data_pagamento = null, valor_pago = null, conta_bancaria_id = null
  where id = any(coalesce(pagar, '{}'));
  update public.contas_receber set situacao = 'aberto', data_recebimento = null, valor_recebido = null, conta_bancaria_id = null
  where id = any(coalesce(receber, '{}'));

  update public.extrato_lancamentos
  set situacao = 'pendente', observacao = null, conciliado_por = null, conciliado_em = null
  where id = lancamento;
end;
$$;

create function public.excluir_importacao_extrato(importacao uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  imp public.extrato_importacoes;
  pagar uuid[];
  receber uuid[];
  linhas integer;
  conciliadas integer;
begin
  if not public.tem_permissao('financeiro.conciliacao', 'excluir') then
    raise exception 'Seu perfil não pode excluir extrato importado';
  end if;
  select * into imp from public.extrato_importacoes where id = importacao for update;
  if imp.id is null or not public.pode_ver_empresa(imp.empresa_id) then
    raise exception 'Importação não encontrada';
  end if;

  select count(*), count(*) filter (where situacao <> 'pendente')
  into linhas, conciliadas
  from public.extrato_lancamentos where importacao_id = importacao;

  select array_agg(c.conta_pagar_id) filter (where c.efeito = 'baixou'),
    array_agg(c.conta_receber_id) filter (where c.efeito = 'baixou')
  into pagar, receber
  from public.extrato_conciliacoes c
  join public.extrato_lancamentos l on l.id = c.lancamento_id
  where l.importacao_id = importacao;

  perform public.devolver_conta_tiny(array(select id from public.extrato_lancamentos where importacao_id = importacao));
  delete from public.extrato_conciliacoes c
  using public.extrato_lancamentos l
  where l.id = c.lancamento_id and l.importacao_id = importacao;

  update public.contas_pagar set situacao = 'aberto', data_pagamento = null, valor_pago = null, conta_bancaria_id = null
  where id = any(coalesce(pagar, '{}'));
  update public.contas_receber set situacao = 'aberto', data_recebimento = null, valor_recebido = null, conta_bancaria_id = null
  where id = any(coalesce(receber, '{}'));

  -- As linhas saem junto (on delete cascade).
  delete from public.extrato_importacoes where id = importacao;

  return jsonb_build_object(
    'linhas', linhas,
    'conciliadas', conciliadas,
    'reabertos', coalesce(array_length(pagar, 1), 0) + coalesce(array_length(receber, 1), 0));
end;
$$;
revoke execute on function public.excluir_importacao_extrato(uuid) from public, anon;
grant execute on function public.excluir_importacao_extrato(uuid) to authenticated;
