-- =============================================================================
-- Venner Gestão · Contas a receber iguais ao Tiny (Olist)
--
-- Pedido do Alexandre (10/11/2026): o contas a receber apareceu todo como
-- vencido. O que está liquidado no Tiny tem de ficar recebido aqui e o que
-- está em aberto, em aberto.
--
-- O que estava errado: a leitura das contas a receber listava o Tiny por
-- "data de alteração", filtro que a API do Tiny não tem para contas a
-- receber; e a outra volta só olhava os títulos em aberto. Um título que era
-- lido em aberto e depois era recebido no Tiny saía da lista dos abertos e
-- nunca mais era relido: ficava em aberto aqui e, passado o vencimento,
-- vencido.
--
-- - O robô agora dá voltas completas no contas a receber como já faz no
--   contas a pagar (em aberto e depois vencimentos de 2026). No fim de cada
--   volta (receber_ciclo_inicio), o título em aberto aqui ou de 2026 que não
--   apareceu nela é relido.
-- - Os títulos em aberto e já vencidos que vieram do Tiny são relidos agora.
-- - tiny_aplicar_planilha_receber: confere a planilha de contas a receber
--   exportada do Tiny com os títulos daqui (cliente, vencimento e valor) e
--   deixa a situação, a data e o valor do recebimento e a conta como no
--   Tiny. Primeiro mostra o que muda; só grava com aplicar = true.
--   Recebimento feito aqui por uma pessoa ou conciliado com o extrato
--   (editado_aqui) não muda.
-- =============================================================================

create or replace function public.robo_tiny_aplicar(integracao uuid, chave_robo text, lote jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saida jsonb;
  erro text := nullif(lote ->> 'erro', '');
begin
  perform public.robo_tiny_conferir(integracao, chave_robo);
  begin
    saida := public.tiny_aplicar(integracao, lote);
    -- Fim de uma volta completa no contas a receber: o que não apareceu nela
    -- (e ainda importa: em aberto aqui ou de 2026) é relido.
    if lote ? 'receber_ciclo_inicio' then
      update public.integracao_fila f set pendente = true, atualizado_em = now()
      where f.integracao_id = integracao and f.tipo = 'receber' and f.erro is null and not f.pendente
        and f.visto_em < (lote ->> 'receber_ciclo_inicio')::timestamptz
        and exists (select 1 from public.contas_receber r
                    where r.tiny_id = f.id_externo
                      and (r.situacao = 'aberto' or r.vencimento >= coalesce((lote ->> 'historico_desde')::date, date '2026-01-01')));
    end if;
  exception when others then
    erro := 'Erro ao gravar a leitura: ' || sqlerrm;
    saida := null;
  end;
  update public.integracao_robo set
    estado = case when saida is not null then coalesce(lote -> 'estado', estado) else estado end,
    executando_ate = null,
    ok_em = case when erro is null then now() else ok_em end,
    ultimo_erro = erro,
    resumo = coalesce(saida, public.integracao_robo.resumo)
  where integracao_id = integracao;
  update public.integracoes_plataforma set ultima_sincronizacao = now()
  where id = integracao and saida is not null and ultima_sincronizacao is distinct from now();
  return coalesce(saida, jsonb_build_object('erro', erro));
end;
$$;

-- Planilha de contas a receber do Tiny: cada linha é ligada a um título daqui
-- (mesmo cliente, vencimento e valor; primeiro os que vieram do Tiny) e a
-- situação, a data e o valor do recebimento e a conta ficam como na
-- planilha. Com aplicar = false só devolve o que mudaria.
create function public.tiny_aplicar_planilha_receber(empresa uuid, linhas jsonb, aplicar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l jsonb;
  alvo record;
  usados uuid[] := '{}';
  sit public.situacao_titulo;
  banco uuid;
  quando date;
  vrec numeric;
  obs text;
  conta_nome text;
  rotulo text;
  primeiro date;
  ultimo date;
  iguais integer := 0;
  corrigidos integer := 0;
  para_recebido integer := 0;
  para_aberto integer := 0;
  para_cancelado integer := 0;
  corrigir jsonb := '[]';
  mantidos jsonb := '[]';
  nao_achados jsonb := '[]';
  so_aqui jsonb := '[]';
  so_aqui_total integer := 0;
  rotulo_sit text;
begin
  if empresa is null or not public.tem_permissao('financeiro.receber', 'editar') or not public.pode_ver_empresa(empresa) then
    raise exception 'Sem permissão para corrigir as contas a receber desta empresa';
  end if;
  if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 20000 then
    raise exception 'Planilha inválida';
  end if;
  -- A correção vem do Tiny: não marca os campos como mudados aqui.
  perform set_config('venner.leitura_tiny', 'sim', true);

  for l in select * from jsonb_array_elements(linhas) loop
    sit := case l ->> 'situacao' when 'pago' then 'pago' when 'cancelado' then 'cancelado' else 'aberto' end;
    primeiro := least(primeiro, (l ->> 'vencimento')::date);
    ultimo := greatest(ultimo, (l ->> 'vencimento')::date);
    rotulo := coalesce(l ->> 'cliente', '') || ' · venc. ' || to_char((l ->> 'vencimento')::date, 'DD/MM/YYYY')
      || ' · R$ ' || replace(((l ->> 'valor')::numeric)::numeric(14, 2)::text, '.', ',');
    select r.id, r.situacao, r.vencimento, r.valor, r.data_recebimento, r.valor_recebido, r.conta_bancaria_id, r.editado_aqui,
      b.nome as banco_nome
    into alvo
    from public.contas_receber r
    join public.clientes c on c.id = r.cliente_id
    left join public.contas_bancarias b on b.id = r.conta_bancaria_id
    where r.empresa_id = empresa and r.id <> all(usados)
      and r.vencimento = (l ->> 'vencimento')::date and r.valor = (l ->> 'valor')::numeric
      and public.texto_comparavel(l ->> 'cliente') in (public.texto_comparavel(c.nome), public.texto_comparavel(c.nome_fantasia))
    order by (r.tiny_id is not null) desc, (r.situacao = sit) desc,
      (nullif(l ->> 'documento', '') is not null and r.descricao ilike '%' || ltrim(l ->> 'documento', '0') || '%') desc,
      r.criado_em
    limit 1;
    if alvo.id is null then
      if jsonb_array_length(nao_achados) < 300 then
        nao_achados := nao_achados || jsonb_build_array(rotulo || ' · ' || case sit when 'pago' then 'recebido' when 'cancelado' then 'cancelado' else 'em aberto' end || ' no Tiny');
      end if;
      continue;
    end if;
    usados := usados || alvo.id;

    banco := null;
    quando := null;
    vrec := null;
    conta_nome := null;
    obs := case when l ->> 'situacao' = 'parcial'
      then 'Recebido em parte no Tiny: R$ ' || coalesce((l ->> 'valor_recebido')::numeric, 0) end;
    if sit = 'pago' then
      select id, nome into banco, conta_nome from public.contas_bancarias
      where empresa_id = empresa and public.texto_comparavel(nome) = public.texto_comparavel(l ->> 'conta')
      order by ativa desc limit 1;
      if banco is null then
        banco := coalesce(case when alvo.situacao = 'pago' then alvo.conta_bancaria_id end, public.tiny_conta(empresa, null));
        conta_nome := coalesce(case when alvo.situacao = 'pago' then alvo.banco_nome end, 'Tiny · conta não informada');
      end if;
      quando := coalesce((l ->> 'recebimento')::date, case when alvo.situacao = 'pago' then alvo.data_recebimento end, alvo.vencimento);
      vrec := coalesce(nullif((l ->> 'valor_recebido')::numeric, 0), alvo.valor);
    end if;

    if alvo.situacao = sit and alvo.data_recebimento is not distinct from quando
       and alvo.valor_recebido is not distinct from vrec and alvo.conta_bancaria_id is not distinct from banco then
      iguais := iguais + 1;
      continue;
    end if;
    -- Recebido, cancelado ou conciliado aqui: fica como está.
    if coalesce(alvo.editado_aqui, '{}') && array['situacao', 'data_recebimento', 'valor_recebido', 'conta_bancaria_id']
       or exists (select 1 from public.extrato_conciliacoes x where x.conta_receber_id = alvo.id) then
      if jsonb_array_length(mantidos) < 300 then
        mantidos := mantidos || jsonb_build_array(rotulo);
      end if;
      continue;
    end if;

    corrigidos := corrigidos + 1;
    if alvo.situacao <> sit then
      if sit = 'pago' then para_recebido := para_recebido + 1;
      elsif sit = 'aberto' then para_aberto := para_aberto + 1;
      else para_cancelado := para_cancelado + 1;
      end if;
    end if;
    if jsonb_array_length(corrigir) < 3000 then
      rotulo_sit := case alvo.situacao
        when 'pago' then 'Recebido em ' || to_char(alvo.data_recebimento, 'DD/MM/YYYY') || coalesce(' · ' || alvo.banco_nome, '')
        when 'cancelado' then 'Cancelado'
        else case when alvo.vencimento < current_date then 'Vencido' else 'Em aberto' end end;
      corrigir := corrigir || jsonb_build_array(jsonb_build_object(
        'titulo', rotulo,
        'de', rotulo_sit,
        'para', case sit when 'pago' then 'Recebido em ' || to_char(quando, 'DD/MM/YYYY') || coalesce(' · ' || conta_nome, '')
                when 'cancelado' then 'Cancelado' else 'Em aberto' end
          || case when vrec is not null and vrec <> alvo.valor then ' · recebido R$ ' || replace(vrec::numeric(14, 2)::text, '.', ',') else '' end));
    end if;
    if aplicar then
      update public.contas_receber set situacao = sit, data_recebimento = quando, valor_recebido = vrec, conta_bancaria_id = banco,
        observacao = coalesce(obs, observacao)
      where id = alvo.id;
    end if;
  end loop;

  -- Em aberto aqui, no mesmo período da planilha, sem linha no Tiny (lançado
  -- aqui, pela nota ou pelo pedido, ou repetido): só para conferir.
  if primeiro is not null then
    select count(*), coalesce(jsonb_agg(x.rotulo order by x.vencimento) filter (where x.n <= 300), '[]')
    into so_aqui_total, so_aqui
    from (
      select r.vencimento, row_number() over (order by r.vencimento, r.valor) as n,
        coalesce(c.nome, r.descricao) || ' · venc. ' || to_char(r.vencimento, 'DD/MM/YYYY')
          || ' · R$ ' || replace(r.valor::numeric(14, 2)::text, '.', ',') || ' · ' || r.descricao as rotulo
      from public.contas_receber r
      left join public.clientes c on c.id = r.cliente_id
      where r.empresa_id = empresa and r.situacao = 'aberto' and r.id <> all(usados)
        and r.vencimento between primeiro and ultimo
    ) x;
  end if;

  perform set_config('venner.leitura_tiny', '', true);
  return jsonb_build_object(
    'linhas', jsonb_array_length(linhas),
    'iguais', iguais,
    'corrigidos', corrigidos,
    'para_recebido', para_recebido,
    'para_aberto', para_aberto,
    'para_cancelado', para_cancelado,
    'aplicado', aplicar,
    'corrigir', corrigir,
    'mantidos', mantidos,
    'nao_achados', nao_achados,
    'so_aqui', so_aqui,
    'so_aqui_total', so_aqui_total);
end;
$$;
revoke execute on function public.tiny_aplicar_planilha_receber(uuid, jsonb, boolean) from public, anon;
grant execute on function public.tiny_aplicar_planilha_receber(uuid, jsonb, boolean) to authenticated;

-- Os títulos do Tiny em aberto e já vencidos aqui são relidos agora (o robô
-- faz aos poucos, a cada 5 minutos, dentro do limite de leituras do Tiny).
update public.integracao_fila f set pendente = true, tentativas = 0, erro = null, atualizado_em = now()
where f.tipo = 'receber' and f.erro is distinct from 'Não existe mais no Tiny'
  and exists (select 1 from public.contas_receber r
              where r.tiny_id = f.id_externo and r.situacao = 'aberto' and r.vencimento < current_date);
