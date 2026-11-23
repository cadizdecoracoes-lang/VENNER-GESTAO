-- =============================================================================
-- Origem dos números dos indicadores (pedido do Alexandre em 23/11/2026:
-- "abre a rastreabilidade dos lançamentos nos indicadores, mostre a
-- composição do valor, qual a origem para chegar nesses valores").
--
-- O que muda:
-- - Função indicadores_origem(de, ate, empresa, filtro): devolve os
--   lançamentos que formam um número da tela de Indicadores, com o total e a
--   quantidade, para o painel "Origem do valor". Fontes:
--     titulos  contas a pagar/receber (pelo vencimento, pela baixa ou em
--              aberto hoje), por categorias, cliente/fornecedor, faixa de
--              vencimento, canal ou ajuda de custo;
--     pedidos  pedidos de venda que entraram (data do pedido), que saíram da
--              fábrica (mesma regra de indicadores_gestao) ou que estão hoje
--              numa situação do Tiny;
--     compras  ordens de compra (sem canceladas);
--     notas    notas fiscais válidas do Tiny (S = saída, E = entrada).
-- - Mesmas regras de acesso de indicadores_gestao (migração 66): security
--   definer, permissões conferidas uma vez no começo.
-- - Só leitura e nenhuma tabela nova: as tabelas de origem já estão no
--   Realtime, então o painel aberto se refaz sozinho a cada mudança.
-- =============================================================================

create function public.indicadores_origem(de date, ate date, empresa uuid default null, filtro jsonb default '{}')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  fonte text := coalesce(filtro ->> 'fonte', 'titulos');
  ver_pagar boolean := public.tem_permissao('financeiro.pagar', 'ver');
  ver_receber boolean := public.tem_permissao('financeiro.receber', 'ver');
  ver_fornecedores boolean := public.tem_permissao('compras.fornecedores', 'ver') or public.tem_permissao('compras.pedidos', 'ver');
  ver_clientes boolean := public.tem_permissao('vendas.clientes', 'ver') or public.tem_permissao('vendas.pedidos', 'ver');
  ver_notas boolean := public.tem_permissao('config.conferencia_tiny', 'ver') or public.tem_permissao('financeiro.pagar', 'ver')
                       or public.tem_permissao('vendas.pedidos', 'ver');
  emp_fin uuid[];
  emp_ped uuid[];
  emp_comp uuid[];
  categorias uuid[];
  excluir uuid[];
  linhas jsonb;
begin
  if not public.tem_permissao('estrategico.indicadores', 'ver') then
    raise exception 'Seu perfil não tem acesso aos indicadores.';
  end if;
  if de is null or ate is null or de > ate then
    raise exception 'Período inválido.';
  end if;
  emp_fin := array(select e.id from public.empresas e where (empresa is null or e.id = empresa) and public.pode_ver_empresa(e.id));
  emp_ped := array(select e.id from public.empresas e where (empresa is null or e.id = empresa) and public.pode_ver_pedido(e.id));
  emp_comp := array(select e.id from public.empresas e where (empresa is null or e.id = empresa) and public.pode_ver_pedido_compra(e.id));
  if filtro ? 'categorias' then
    categorias := array(select x::uuid from jsonb_array_elements_text(filtro -> 'categorias') x);
  end if;
  excluir := array(select x::uuid from jsonb_array_elements_text(coalesce(filtro -> 'excluir_categorias', '[]')) x);

  if fonte = 'titulos' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc, x.data), '[]') into linhas
    from (
      select t.id, t.tipo, t.descricao, t.parcela,
             coalesce(t.pessoa_nome, case when t.pessoa_id is null then null else 'Sem acesso ao cadastro' end) as pessoa,
             t.pessoa_id, t.categoria_id, c.nome as categoria, t.vencimento, t.data_baixa, t.situacao, t.canal,
             case when filtro ->> 'base' = 'baixa' then t.data_baixa else t.vencimento end as data,
             case when filtro ->> 'base' = 'baixa' then t.valor_baixa
                  when filtro ->> 'base' = 'aberto' then t.valor - t.tarifas
                  else t.valor end as valor
      from (
        select p.id, 'pagar'::text as tipo, p.descricao, p.parcela, p.fornecedor_id as pessoa_id,
               case when ver_fornecedores then coalesce(f.nome_fantasia, f.nome) end as pessoa_nome,
               p.categoria_id, null::text as canal, p.valor, 0::numeric as tarifas, p.vencimento, p.situacao::text as situacao,
               p.data_pagamento as data_baixa, coalesce(p.valor_pago, p.valor) as valor_baixa
        from public.contas_pagar p
        left join public.fornecedores f on f.id = p.fornecedor_id
        where ver_pagar and p.empresa_id = any(emp_fin) and p.situacao <> 'cancelado'
        union all
        select r.id, 'receber', r.descricao, r.parcela, r.cliente_id,
               case when ver_clientes then coalesce(cl.nome_fantasia, cl.nome) end,
               r.categoria_id, r.canal, r.valor, coalesce(r.tarifas, 0), r.vencimento, r.situacao::text,
               r.data_recebimento, coalesce(r.valor_recebido, r.valor_liquido, r.valor)
        from public.contas_receber r
        left join public.clientes cl on cl.id = r.cliente_id
        where ver_receber and r.empresa_id = any(emp_fin) and r.situacao <> 'cancelado'
      ) t
      left join public.plano_contas c on c.id = t.categoria_id
      where (filtro ->> 'tipo' is null or t.tipo = filtro ->> 'tipo')
        and case filtro ->> 'base'
              when 'baixa' then t.situacao = 'pago' and t.data_baixa between de and ate
              when 'aberto' then t.situacao = 'aberto'
              else t.vencimento between de and ate
            end
        and (categorias is null or t.categoria_id = any(categorias)
             or (t.categoria_id is null and coalesce((filtro ->> 'sem_categoria')::boolean, false)))
        and (t.categoria_id is null or not t.categoria_id = any(excluir))
        and (filtro ->> 'pessoa' is null
             or (filtro ->> 'pessoa' = 'sem' and t.pessoa_id is null)
             or t.pessoa_id::text = filtro ->> 'pessoa')
        and (filtro ->> 'canal' is null or coalesce(t.canal, 'venda_direta') = filtro ->> 'canal')
        and (not coalesce((filtro ->> 'ajuda')::boolean, false) or t.descricao ilike '%ajuda%custo%' or c.nome ilike '%ajuda%custo%')
        and (filtro ->> 'faixa' is null or filtro ->> 'faixa' =
              case when t.vencimento < hoje - 90 then 'vencido_91'
                   when t.vencimento < hoje - 30 then 'vencido_31_90'
                   when t.vencimento < hoje then 'vencido_1_30'
                   when t.vencimento <= hoje + 30 then 'vence_30'
                   when t.vencimento <= hoje + 60 then 'vence_31_60'
                   else 'vence_61' end)
    ) x;

  elsif fonte = 'pedidos' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc, x.data), '[]') into linhas
    from (
      select s.id, s.numero, s.numero_externo, s.cliente, s.canal, s.etapa, s.fase, s.data_pedido, s.prazo_entrega, s.saiu,
             case filtro ->> 'modo' when 'saida' then s.saiu when 'etapa' then s.data_pedido else s.data_pedido end as data,
             s.valor_total as valor,
             case when s.prazo_entrega < hoje and s.fase <> 'encerrado' then hoje - s.prazo_entrega end as dias_atraso
      from (
        select p.id, p.numero, p.numero_externo, p.canal, p.etapa_id, p.etapa_nome as etapa, p.fase::text as fase,
               p.data_pedido, p.prazo_entrega, p.valor_total,
               case when ver_clientes then coalesce(cl.nome_fantasia, cl.nome) end as cliente,
               -- Saída da fábrica: mesma regra de indicadores_gestao.
               case when p.fase in ('expedicao', 'encerrado') then coalesce(
                 case when pv.dados_tiny ->> 'dataFaturamento' ~ '^\d{4}-\d{2}-\d{2}'
                      then left(pv.dados_tiny ->> 'dataFaturamento', 10)::date end,
                 (select min((h.em at time zone 'America/Sao_Paulo')::date)
                  from public.pedido_etapas_historico h
                  join public.etapas_pedido he on he.id = h.etapa_id
                  where h.pedido_id = p.id and he.fase in ('expedicao', 'encerrado') and he.nome <> 'Cancelado'
                    and exists (select 1 from public.pedido_etapas_historico h0
                                join public.etapas_pedido e0 on e0.id = h0.etapa_id
                                where h0.pedido_id = p.id and h0.em < h.em and e0.fase in ('negociacao', 'producao')))
               ) end as saiu
        from public.pedidos_venda_resumo p
        join public.pedidos_venda pv on pv.id = p.id
        left join public.clientes cl on cl.id = p.cliente_id
        where p.empresa_id = any(emp_ped) and p.etapa_nome <> 'Cancelado'
      ) s
      where (filtro ->> 'canal' is null or s.canal = filtro ->> 'canal')
        and case filtro ->> 'modo'
              when 'saida' then s.saiu between de and ate
              when 'etapa' then s.fase <> 'encerrado'
                                and (filtro ->> 'etapa' is null or s.etapa_id::text = filtro ->> 'etapa')
                                and (filtro ->> 'fase' is null or s.fase = filtro ->> 'fase')
                                and (not coalesce((filtro ->> 'atrasados')::boolean, false) or s.prazo_entrega < hoje)
              else s.data_pedido between de and ate
            end
    ) x;

  elsif fonte = 'compras' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc, x.data), '[]') into linhas
    from (
      select c.id, c.numero, c.tiny_id, case when ver_fornecedores then c.fornecedor_nome end as pessoa,
             c.data_pedido as data, c.etapa::text as etapa, c.condicao_pagamento, c.valor_total as valor
      from public.pedidos_compra_resumo c
      where c.empresa_id = any(emp_comp) and c.etapa <> 'cancelado' and c.data_pedido between de and ate
    ) x;

  elsif fonte = 'notas' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc, x.data), '[]') into linhas
    from (
      select n.id, n.tipo, n.numero, n.serie, n.contato_nome as pessoa, n.emissao as data, n.situacao, n.valor
      from public.notas_tiny n
      where ver_notas and n.empresa_id = any(emp_fin) and n.situacao in (2, 6, 7, 8) and n.emissao between de and ate
        and (filtro ->> 'tipo_nota' is null or n.tipo = filtro ->> 'tipo_nota')
    ) x;

  else
    raise exception 'Origem desconhecida: %', fonte;
  end if;

  -- Total e quantidade de tudo; as linhas vão até 2.000 (as maiores primeiro).
  return jsonb_build_object(
    'qtd', jsonb_array_length(linhas),
    'total', (select coalesce(sum((l ->> 'valor')::numeric), 0) from jsonb_array_elements(linhas) l),
    'linhas', (select coalesce(jsonb_agg(a.l order by a.i), '[]') from jsonb_array_elements(linhas) with ordinality a(l, i) where a.i <= 2000)
  );
end;
$$;

revoke execute on function public.indicadores_origem(date, date, uuid, jsonb) from public, anon;
grant execute on function public.indicadores_origem(date, date, uuid, jsonb) to authenticated;
