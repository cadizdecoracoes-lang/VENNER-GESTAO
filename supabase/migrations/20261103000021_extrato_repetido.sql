-- Lançamento repetido no extrato da conciliação.
--
-- O mesmo lançamento importado duas vezes (por exemplo, do PDF e do OFX do
-- mesmo mês, ou com a descrição escrita diferente) ganhava chaves diferentes e
-- entrava duas vezes. A pessoa conciliava uma cópia e a outra voltava como
-- "nenhum título com este valor".
--
-- Regra nova: na mesma conta, linhas com a mesma data e o mesmo valor vindas
-- de importações diferentes são o mesmo lançamento. Fica valendo a maior
-- quantidade que uma única importação trouxe naquele dia e valor (duas
-- tarifas iguais no mesmo dia continuam sendo duas). As sobras pendentes ficam
-- "ignoradas" com o motivo "Repetido de outra importação" (dá para desfazer na
-- tela). Fica a cópia já conciliada, ou a da importação mais antiga.
-- Roda ao importar, ao excluir uma importação (a cópia volta para a lista se a
-- outra saiu) e uma vez agora, para o que já entrou repetido.

create function public.motivo_repetido_extrato()
returns text
language sql
immutable
set search_path = ''
as $$ select 'Repetido de outra importação'::text $$;
grant execute on function public.motivo_repetido_extrato() to authenticated;

create function public.marcar_repetidos_extrato(conta_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  motivo text := public.motivo_repetido_extrato();
  marcadas integer;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.contas_bancarias b where b.id = marcar_repetidos_extrato.conta_id and public.pode_ver_empresa(b.empresa_id)
  ) then
    raise exception 'Conta bancária não encontrada';
  end if;

  with por_importacao as (
    select data, valor, importacao_id, count(*) as qtd
    from public.extrato_lancamentos
    where conta_bancaria_id = marcar_repetidos_extrato.conta_id
    group by data, valor, importacao_id
  ),
  maximo as (
    select data, valor, max(qtd) as qtd from por_importacao group by data, valor
  ),
  ordem as (
    select l.id, l.situacao, l.observacao, m.qtd,
      row_number() over (
        partition by l.data, l.valor
        -- Primeiro as que já foram resolvidas de verdade, depois a importação mais antiga.
        order by (l.situacao <> 'pendente' and l.observacao is distinct from motivo) desc,
          i.criado_em nulls first, l.criado_em, l.id
      ) as pos
    from public.extrato_lancamentos l
    join maximo m on m.data = l.data and m.valor = l.valor
    left join public.extrato_importacoes i on i.id = l.importacao_id
    where l.conta_bancaria_id = marcar_repetidos_extrato.conta_id
  ),
  mudar as (
    update public.extrato_lancamentos e
    set situacao = case when o.pos > o.qtd then 'ignorado'::public.situacao_extrato else 'pendente'::public.situacao_extrato end,
      observacao = case when o.pos > o.qtd then motivo end,
      conciliado_em = case when o.pos > o.qtd then now() end,
      conciliado_por = case when o.pos > o.qtd then auth.uid() end
    from ordem o
    where e.id = o.id
      and ((o.pos > o.qtd and o.situacao = 'pendente')
        or (o.pos <= o.qtd and o.situacao = 'ignorado' and o.observacao = motivo))
    returning 1
  )
  select count(*) into marcadas from mudar;
  return marcadas;
end;
$$;
revoke execute on function public.marcar_repetidos_extrato(uuid) from public, anon;
grant execute on function public.marcar_repetidos_extrato(uuid) to authenticated;

create or replace function public.importar_extrato(
  conta_bancaria uuid,
  origem public.origem_extrato,
  arquivo text,
  linhas jsonb,
  saldo_final numeric default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  empresa uuid;
  imp uuid;
  l jsonb;
  base text;
  ocorrencias jsonb := '{}';
  n integer;
  novas integer := 0;
  total integer := 0;
  inseridas integer;
begin
  select b.empresa_id into empresa from public.contas_bancarias b where b.id = conta_bancaria;
  if empresa is null then
    raise exception 'Conta bancária não encontrada';
  end if;
  if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) = 0 then
    raise exception 'O extrato não tem lançamentos';
  end if;

  insert into public.extrato_importacoes (empresa_id, conta_bancaria_id, origem, arquivo, saldo_final, periodo_de, periodo_ate)
  values (empresa, conta_bancaria, origem, arquivo, saldo_final,
    (select min((x ->> 'data')::date) from jsonb_array_elements(linhas) x),
    (select max((x ->> 'data')::date) from jsonb_array_elements(linhas) x))
  returning id into imp;

  for l in select * from jsonb_array_elements(linhas) loop
    if coalesce((l ->> 'valor')::numeric, 0) = 0 then
      continue;
    end if;
    total := total + 1;
    if nullif(l ->> 'id_banco', '') is not null then
      base := 'id:' || (l ->> 'id_banco');
    else
      -- Duas tarifas iguais no mesmo dia são lançamentos diferentes: conta a ocorrência.
      base := (l ->> 'data') || '|' || round((l ->> 'valor')::numeric, 2) || '|'
        || lower(regexp_replace(trim(l ->> 'descricao'), '\s+', ' ', 'g'));
      n := coalesce((ocorrencias ->> base)::integer, 0) + 1;
      ocorrencias := ocorrencias || jsonb_build_object(base, n);
      base := base || '|' || n;
    end if;
    insert into public.extrato_lancamentos (empresa_id, conta_bancaria_id, importacao_id, data, descricao, documento, valor, saldo, chave)
    values (empresa, conta_bancaria, imp, (l ->> 'data')::date, coalesce(nullif(trim(l ->> 'descricao'), ''), 'Sem descrição'),
      nullif(trim(l ->> 'documento'), ''), round((l ->> 'valor')::numeric, 2), round((l ->> 'saldo')::numeric, 2), base)
    on conflict (conta_bancaria_id, chave) do nothing;
    get diagnostics inseridas = row_count;
    novas := novas + inseridas;
  end loop;

  -- O mesmo lançamento que já veio em outra importação (outro formato ou
  -- descrição escrita diferente) fica de fora da lista de pendentes.
  perform public.marcar_repetidos_extrato(conta_bancaria);
  select count(*) into inseridas from public.extrato_lancamentos
  where importacao_id = imp and situacao = 'ignorado' and observacao = public.motivo_repetido_extrato();
  novas := novas - inseridas;

  update public.extrato_importacoes set importadas = novas, repetidas = total - novas where id = imp;
  return jsonb_build_object('importadas', novas, 'repetidas', total - novas, 'importacao', imp);
end;
$$;

create or replace function public.excluir_importacao_extrato(importacao uuid)
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
  -- Cópia que estava de fora por repetir uma linha desta importação volta para a lista.
  perform public.marcar_repetidos_extrato(imp.conta_bancaria_id);

  return jsonb_build_object(
    'linhas', linhas,
    'conciliadas', conciliadas,
    'reabertos', coalesce(array_length(pagar, 1), 0) + coalesce(array_length(receber, 1), 0));
end;
$$;

-- O que já entrou repetido.
select public.marcar_repetidos_extrato(id) from public.contas_bancarias;
