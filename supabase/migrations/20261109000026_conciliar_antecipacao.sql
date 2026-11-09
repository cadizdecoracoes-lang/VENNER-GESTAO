-- Conciliação de antecipação (factoring): o banco credita o valor líquido.
--
-- Exemplo do Alexandre: título a receber da AKL de R$ 21.400,33 negociado com
-- a factoring; os juros da antecipação (R$ 1.573,43) viram uma conta a pagar;
-- no extrato entra R$ 19.826,90. Agora uma entrada pode ser conciliada com
-- títulos a receber MENOS títulos a pagar (e uma saída com títulos a pagar
-- menos a receber): a soma com sinal tem de bater com o extrato. Os títulos
-- do outro lado só descontam; continua obrigatório ao menos um título do
-- lado do lançamento. Baixa, vínculo e "desfazer" seguem iguais.

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
  -- Título do outro lado só desconta (ex.: juros da antecipação no crédito
  -- líquido da factoring); sozinho não serve.
  if l.valor < 0 and coalesce(cardinality(pagar), 0) = 0 then
    raise exception 'Saída do extrato se concilia com contas a pagar';
  end if;
  if l.valor > 0 and coalesce(cardinality(receber), 0) = 0 then
    raise exception 'Entrada do extrato se concilia com contas a receber';
  end if;
  alvo := abs(l.valor);

  for t in
    select p.id, p.empresa_id, p.situacao, p.valor, p.valor_pago as pago, p.conta_bancaria_id, p.descricao,
      case when l.valor < 0 then 1 else -1 end as sinal
    from public.contas_pagar p where p.id = any(pagar)
    union all
    select r.id, r.empresa_id, r.situacao, r.valor_liquido, r.valor_recebido, r.conta_bancaria_id, r.descricao,
      case when l.valor > 0 then 1 else -1 end
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
    soma := soma + t.sinal * case when t.situacao = 'pago' then t.pago when quantos = 1 then alvo else t.valor end;
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
