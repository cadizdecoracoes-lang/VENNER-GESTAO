-- =============================================================================
-- Venner Gestão · Tiny a cada minuto e ordens de compra do Tiny
--
-- Nova direção (16/11/2026): o sistema Venner é o reflexo do Tiny e das
-- plataformas. Este pacote:
-- - Chama o robô do Tiny a cada minuto (antes, a cada 5). Uma leitura não
--   começa enquanto a anterior está em andamento (executando_ate), e cada
--   leitura usa no máximo 40 das 60 chamadas por minuto que o Tiny permite.
-- - Lê as ordens de compra do Tiny e grava em pedidos_compra (tiny_id), com
--   itens e parcelas. A situação do Tiny vira a etapa: em aberto e em
--   andamento → Aprovado; atendida → Recebido; cancelada → Cancelado.
--   O pedido que vem do Tiny segue sempre o Tiny (só leitura aqui); os
--   pedidos lançados aqui continuam com as regras de antes.
-- =============================================================================

-- Fila do robô aceita ordens de compra.
alter table public.integracao_fila drop constraint integracao_fila_tipo_check;
alter table public.integracao_fila add constraint integracao_fila_tipo_check
  check (tipo in ('receber', 'pagar', 'pedido', 'produto', 'compra'));

-- Número e situação da ordem no Tiny, e quando foi lida pela última vez.
alter table public.pedidos_compra
  add column numero_tiny text,
  add column situacao_tiny smallint,
  add column integrado_em timestamptz;

-- O resumo usado pelas telas passa a mostrar o número e a situação do Tiny.
drop view public.pedidos_compra_resumo;
create view public.pedidos_compra_resumo
with (security_invoker = true)
as
select
  p.*,
  coalesce(f.nome_fantasia, f.nome) as fornecedor_nome,
  coalesce(i.quantidade_itens, 0)::integer as quantidade_itens,
  coalesce(i.valor_itens, 0) as valor_itens,
  coalesce(i.valor_ipi, 0) as valor_ipi,
  coalesce(i.valor_itens, 0) + coalesce(i.valor_ipi, 0) + p.valor_frete - p.valor_desconto as valor_total,
  coalesce(n.quantidade_notas, 0)::integer as quantidade_notas,
  coalesce(n.valor_notas, 0) as valor_notas
from public.pedidos_compra p
left join public.fornecedores f on f.id = p.fornecedor_id
left join lateral (
  select count(*) as quantidade_itens, sum(x.valor_total) as valor_itens,
    round(sum(x.valor_total * x.aliquota_ipi / 100), 2) as valor_ipi
  from public.pedido_compra_itens x where x.pedido_id = p.id
) i on true
left join lateral (
  select count(*) as quantidade_notas, sum(nf.valor_total) as valor_notas
  from public.notas_fornecedor nf where nf.pedido_compra_id = p.id
) n on true;
grant select on public.pedidos_compra_resumo to authenticated;

-- O pedido que vem do Tiny segue o Tiny: a leitura grava em qualquer etapa.
create or replace function public.validar_pedido_compra()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('venner.leitura_tiny', true) = 'sim' then
    if new.etapa is distinct from (case when tg_op = 'UPDATE' then old.etapa end) then
      new.etapa_desde := now();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.etapa <> 'criacao' then
      raise exception 'O pedido de compra nasce na etapa Criação';
    end if;
  elsif old.situacao_tiny is not null and current_setting('venner.mudando_etapa_compra', true) is distinct from 'sim' then
    raise exception 'Este pedido vem do Tiny: altere no Tiny e ele muda aqui sozinho';
  elsif (new.etapa, new.aprovado_por, new.aprovado_em) is distinct from (old.etapa, old.aprovado_por, old.aprovado_em)
        and current_setting('venner.mudando_etapa_compra', true) is distinct from 'sim' then
    raise exception 'A etapa do pedido de compra só muda pelos botões do pedido';
  elsif old.etapa not in ('criacao', 'orcamento')
        and (new.empresa_id, new.fornecedor_id, new.categoria_id, new.data_pedido, new.data_prevista, new.condicao_pagamento,
             new.frete_por_conta, new.transportador, new.valor_frete, new.valor_desconto, new.observacoes)
            is distinct from
            (old.empresa_id, old.fornecedor_id, old.categoria_id, old.data_pedido, old.data_prevista, old.condicao_pagamento,
             old.frete_por_conta, old.transportador, old.valor_frete, old.valor_desconto, old.observacoes) then
    raise exception 'Pedido em aprovação ou aprovado não muda: volte para Orçamento para alterar';
  elsif new.empresa_id <> old.empresa_id then
    raise exception 'A empresa do pedido não muda depois de criado';
  end if;

  if new.etapa is distinct from (case when tg_op = 'UPDATE' then old.etapa end) then
    new.etapa_desde := now();
  end if;
  if new.categoria_id is not null then
    if exists (select 1 from public.plano_contas c where c.id = new.categoria_id and c.tipo <> 'despesa') then
      raise exception 'Pedidos de compra usam categorias de despesa';
    end if;
    if exists (select 1 from public.plano_contas c where c.pai_id = new.categoria_id) then
      raise exception 'Escolha a categoria mais detalhada (sem subcategorias abaixo dela)';
    end if;
  end if;
  return new;
end;
$$;

-- Itens, parcelas e orçamentos: além das regras de antes, a leitura do Tiny
-- grava e o pedido que vem do Tiny não muda aqui.
create or replace function public.travar_filhos_pedido_compra()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pedido uuid := case when tg_op = 'DELETE' then old.pedido_id else new.pedido_id end;
begin
  if current_setting('venner.leitura_tiny', true) = 'sim' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Excluir o pedido inteiro (ainda em criação) leva os filhos junto.
  if tg_op = 'DELETE' and not exists (select 1 from public.pedidos_compra p where p.id = pedido) then
    return old;
  end if;
  if exists (select 1 from public.pedidos_compra p where p.id = pedido and p.situacao_tiny is not null) then
    raise exception 'Este pedido vem do Tiny: altere no Tiny e ele muda aqui sozinho';
  end if;
  if current_setting('venner.mudando_etapa_compra', true) is distinct from 'sim'
     and not public.pedido_compra_editavel(pedido) then
    raise exception 'Pedido em aprovação ou aprovado não muda: volte para Orçamento para alterar';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Grava as ordens de compra lidas do Tiny. Devolve quantas gravou.
create function public.tiny_aplicar_compras(integracao uuid, lote jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  empresa uuid := (select empresa_id from public.integracoes_plataforma where id = integracao);
  t jsonb;
  x jsonb;
  atual record;
  pedido uuid;
  nova public.etapa_pedido_compra;
  n integer := 0;
begin
  if empresa is null then
    return 0;
  end if;
  perform set_config('venner.leitura_tiny', 'sim', true);

  for t in select * from jsonb_array_elements(coalesce(lote -> 'compras', '[]')) loop
    nova := case (t ->> 'situacao')::integer when 1 then 'recebido' when 2 then 'cancelado' else 'aprovado' end;
    select p.id, p.etapa into atual from public.pedidos_compra p where p.tiny_id = (t ->> 'id')::bigint;
    if atual.id is null then
      insert into public.pedidos_compra (empresa_id, fornecedor_id, categoria_id, data_pedido, data_prevista,
        frete_por_conta, valor_frete, valor_desconto, observacoes, observacoes_internas, etapa,
        tiny_id, numero_tiny, situacao_tiny, integrado_em)
      values (empresa,
        case when jsonb_typeof(t -> 'fornecedor') = 'object' then public.tiny_pessoa('fornecedores', t -> 'fornecedor') end,
        public.tiny_categoria((t ->> 'categoria_id')::bigint, t ->> 'categoria_nome', 'despesa'),
        (t ->> 'data')::date, (t ->> 'data_prevista')::date, nullif(t ->> 'frete_por_conta', ''),
        greatest(0, coalesce((t ->> 'frete')::numeric, 0)), greatest(0, coalesce((t ->> 'desconto')::numeric, 0)),
        nullif(t ->> 'observacoes', ''), nullif(t ->> 'observacoes_internas', ''), nova,
        (t ->> 'id')::bigint, t ->> 'numero', (t ->> 'situacao')::smallint, now())
      returning id into pedido;
    else
      pedido := atual.id;
      update public.pedidos_compra set
        fornecedor_id = coalesce(case when jsonb_typeof(t -> 'fornecedor') = 'object'
                                      then public.tiny_pessoa('fornecedores', t -> 'fornecedor') end, fornecedor_id),
        categoria_id = coalesce(public.tiny_categoria((t ->> 'categoria_id')::bigint, t ->> 'categoria_nome', 'despesa'), categoria_id),
        data_pedido = (t ->> 'data')::date,
        data_prevista = (t ->> 'data_prevista')::date,
        frete_por_conta = nullif(t ->> 'frete_por_conta', ''),
        valor_frete = greatest(0, coalesce((t ->> 'frete')::numeric, 0)),
        valor_desconto = greatest(0, coalesce((t ->> 'desconto')::numeric, 0)),
        observacoes = nullif(t ->> 'observacoes', ''),
        observacoes_internas = nullif(t ->> 'observacoes_internas', ''),
        etapa = nova,
        numero_tiny = t ->> 'numero',
        situacao_tiny = (t ->> 'situacao')::smallint,
        integrado_em = now()
      where id = pedido;
      if atual.etapa is distinct from nova then
        insert into public.pedido_compra_historico (pedido_id, etapa, observacao) values (pedido, nova, 'Situação mudou no Tiny');
      end if;
    end if;

    delete from public.pedido_compra_itens where pedido_id = pedido;
    insert into public.pedido_compra_itens (pedido_id, item_id, quantidade, valor_unitario, aliquota_ipi)
    select pedido, i.item, sum(i.quantidade), round(sum(i.quantidade * i.valor) / sum(i.quantidade), 6), max(i.ipi)
    from (
      select public.tiny_item(jsonb_build_object('produto_id', it -> 'produto_id', 'sku', it ->> 'sku',
               'descricao', it ->> 'descricao', 'tipo_item', 'materia_prima')) as item,
        (it ->> 'quantidade')::numeric as quantidade,
        greatest(0, coalesce((it ->> 'valor_unitario')::numeric, 0)) as valor,
        greatest(0, coalesce((it ->> 'aliquota_ipi')::numeric, 0)) as ipi
      from jsonb_array_elements(coalesce(t -> 'itens', '[]')) it
      where (it ->> 'quantidade')::numeric > 0
    ) i
    group by i.item;

    delete from public.pedido_compra_parcelas where pedido_id = pedido;
    insert into public.pedido_compra_parcelas (pedido_id, dias, vencimento, valor, meio_pagamento, observacao)
    select pedido, greatest(0, coalesce((p ->> 'dias')::integer, 0)), (p ->> 'vencimento')::date, (p ->> 'valor')::numeric,
      case when p ->> 'meio_pagamento' in ('1', '2', '3', '4', '5', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '90', '99')
           then p ->> 'meio_pagamento' end,
      nullif(p ->> 'observacao', '')
    from jsonb_array_elements(coalesce(t -> 'parcelas', '[]')) p
    where (p ->> 'valor')::numeric > 0 and nullif(p ->> 'vencimento', '') is not null;

    update public.integracao_fila set pendente = false, tentativas = 0, erro = null
    where integracao_id = integracao and tipo = 'compra' and id_externo = (t ->> 'id')::bigint;
    n := n + 1;
  end loop;

  -- Ordem apagada no Tiny: o pedido daqui fica cancelado.
  for x in select * from jsonb_array_elements(coalesce(lote -> 'removidos', '[]')) loop
    if x ->> 'tipo' = 'compra' then
      update public.pedidos_compra set etapa = 'cancelado', situacao_tiny = 2, integrado_em = now()
      where tiny_id = (x ->> 'id')::bigint and etapa <> 'cancelado';
    end if;
  end loop;

  perform set_config('venner.leitura_tiny', '', true);
  return n;
end;
$$;
revoke execute on function public.tiny_aplicar_compras(uuid, jsonb) from public, anon, authenticated;

-- Robô: grava o lote de antes e, junto, as ordens de compra.
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
    saida := saida || jsonb_build_object('compras', public.tiny_aplicar_compras(integracao, lote));
    -- Fim de uma volta completa no contas a receber: relê o que não apareceu
    -- nela (e ainda importa: em aberto aqui ou de 2026) e o que está com
    -- situação diferente da Olist.
    if lote ? 'receber_ciclo_inicio' then
      update public.integracao_fila f set pendente = true, atualizado_em = now()
      where f.integracao_id = integracao and f.tipo = 'receber' and f.erro is null and not f.pendente
        and ((f.visto_em < (lote ->> 'receber_ciclo_inicio')::timestamptz
              and exists (select 1 from public.contas_receber r
                          where r.tiny_id = f.id_externo
                            and (r.situacao = 'aberto' or r.vencimento >= coalesce((lote ->> 'historico_desde')::date, date '2026-01-01'))))
             or f.id_externo in (select public.receber_difere_do_tiny(integracao)));
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

-- A cada minuto (antes a cada 5).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('robo-tiny', '* * * * *', 'select public.disparar_robo_tiny()');
  end if;
end;
$$;
