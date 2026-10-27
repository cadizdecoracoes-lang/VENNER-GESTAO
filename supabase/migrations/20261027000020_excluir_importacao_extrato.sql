-- Excluir uma importação de extrato da conciliação bancária.
--
-- Apaga a importação e as linhas dela. Antes, desfaz o que as linhas fizeram
-- nos títulos, do mesmo jeito que "desfazer" a conciliação de uma linha:
-- título baixado pela conciliação volta a ficar em aberto; título que já
-- estava pago só perde a ligação com o extrato.
-- Só quem tem "excluir" na conciliação (de fábrica, a Diretoria) e vê o CNPJ.

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
