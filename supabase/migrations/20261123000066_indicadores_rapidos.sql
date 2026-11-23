-- =============================================================================
-- Indicadores abrindo rápido (Alexandre, 23/11/2026: a tela de Indicadores dava
-- "canceling statement due to statement timeout" logo depois da publicação).
--
-- Causa: indicadores_gestao e indicadores_ajuda_custo rodavam com as
-- permissões de quem chama (security invoker). Assim, as regras de acesso
-- (tem_permissao, pode_ver_empresa, pode_ver_pedido) eram conferidas em cada
-- linha de cada consulta: contas a pagar e a receber lidas 7 vezes, e o
-- histórico das etapas, consultado pedido a pedido, conferia de novo o
-- pedido em cada linha. Passava dos 8 segundos que o Supabase dá a cada
-- pedido das telas.
--
-- O que muda (o resultado é o mesmo, só mais rápido):
-- - As duas funções passam a security definer e conferem as permissões UMA
--   vez no começo, com as mesmas regras das políticas das tabelas:
--   contas a pagar/receber: financeiro.pagar/receber ver + empresas liberadas;
--   pedidos de venda e histórico: pode_ver_pedido da empresa;
--   pedidos de compra: pode_ver_pedido_compra da empresa;
--   notas do Tiny: mesma regra da política de notas_tiny;
--   nome de cliente/fornecedor só para quem pode ver esses cadastros.
-- - indicadores_titulos recebe a lista de empresas e as duas permissões e
--   deixa de ser chamada pelas telas (só por dentro).
-- =============================================================================

drop function public.indicadores_titulos(uuid);

-- Títulos (pagar e receber) sem os cancelados, só das empresas e tipos
-- liberados (a função que chama já conferiu as permissões).
create function public.indicadores_titulos(empresas uuid[], ver_pagar boolean, ver_receber boolean)
returns table (
  tipo text, empresa_id uuid, pessoa_id uuid, categoria_id uuid, canal text, pedido_id uuid,
  valor numeric, tarifas numeric, vencimento date, situacao text, data_baixa date, valor_baixa numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'pagar', p.empresa_id, p.fornecedor_id, p.categoria_id, null, null, p.valor, 0, p.vencimento, p.situacao::text,
         p.data_pagamento, coalesce(p.valor_pago, p.valor)
  from public.contas_pagar p
  where ver_pagar and p.situacao <> 'cancelado' and p.empresa_id = any(empresas)
  union all
  select 'receber', r.empresa_id, r.cliente_id, r.categoria_id, r.canal, r.pedido_id, r.valor, coalesce(r.tarifas, 0), r.vencimento,
         r.situacao::text, r.data_recebimento, coalesce(r.valor_recebido, r.valor_liquido, r.valor)
  from public.contas_receber r
  where ver_receber and r.situacao <> 'cancelado' and r.empresa_id = any(empresas);
$$;
revoke execute on function public.indicadores_titulos(uuid[], boolean, boolean) from public, anon, authenticated;

create or replace function public.indicadores_gestao(de date, ate date, empresa uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  saida jsonb := '{}';
  -- Permissões de quem chama, conferidas uma vez só (antes: linha a linha).
  ver_pagar boolean := public.tem_permissao('financeiro.pagar', 'ver');
  ver_receber boolean := public.tem_permissao('financeiro.receber', 'ver');
  ver_fornecedores boolean := public.tem_permissao('compras.fornecedores', 'ver') or public.tem_permissao('compras.pedidos', 'ver');
  ver_clientes boolean := public.tem_permissao('vendas.clientes', 'ver') or public.tem_permissao('vendas.pedidos', 'ver');
  ver_notas boolean := public.tem_permissao('config.conferencia_tiny', 'ver') or public.tem_permissao('financeiro.pagar', 'ver')
                       or public.tem_permissao('vendas.pedidos', 'ver');
  emp_fin uuid[];
  emp_ped uuid[];
  emp_comp uuid[];
begin
  if not public.tem_permissao('estrategico.indicadores', 'ver') then
    raise exception 'Seu perfil não tem acesso aos indicadores.';
  end if;
  -- Empresas que quem chama pode ver em cada assunto (mesmas regras das
  -- políticas de RLS das tabelas), já filtradas pela empresa escolhida.
  emp_fin := array(select e.id from public.empresas e where (empresa is null or e.id = empresa) and public.pode_ver_empresa(e.id));
  emp_ped := array(select e.id from public.empresas e where (empresa is null or e.id = empresa) and public.pode_ver_pedido(e.id));
  emp_comp := array(select e.id from public.empresas e where (empresa is null or e.id = empresa) and public.pode_ver_pedido_compra(e.id));
  if de is null or ate is null or de > ate then
    raise exception 'Período inválido.';
  end if;

  -- Por mês e categoria: previsto (pelo vencimento) e realizado (pela baixa).
  saida := saida || jsonb_build_object('titulos_mes', (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.tipo, x.mes), '[]')
    from (
      select m.tipo, m.mes, m.categoria_id, sum(m.previsto) as previsto, sum(m.realizado) as realizado,
             sum(m.qtd)::integer as qtd, sum(m.tarifas) as tarifas
      from (
        select t.tipo, to_char(t.vencimento, 'YYYY-MM') as mes, t.categoria_id, t.valor as previsto, 0 as realizado, 1 as qtd,
               t.tarifas
        from public.indicadores_titulos(emp_fin, ver_pagar, ver_receber) t where t.vencimento between de and ate
        union all
        select t.tipo, to_char(t.data_baixa, 'YYYY-MM'), t.categoria_id, 0, t.valor_baixa, 0, 0
        from public.indicadores_titulos(emp_fin, ver_pagar, ver_receber) t where t.situacao = 'pago' and t.data_baixa between de and ate
      ) m
      group by m.tipo, m.mes, m.categoria_id
    ) x));

  -- Em aberto hoje, por faixa de vencimento (independe do período).
  saida := saida || jsonb_build_object('aberto', (
    select coalesce(jsonb_agg(to_jsonb(x)), '[]')
    from (
      select t.tipo,
             case when t.vencimento < hoje - 90 then 'vencido_91'
                  when t.vencimento < hoje - 30 then 'vencido_31_90'
                  when t.vencimento < hoje then 'vencido_1_30'
                  when t.vencimento <= hoje + 30 then 'vence_30'
                  when t.vencimento <= hoje + 60 then 'vence_31_60'
                  else 'vence_61' end as faixa,
             sum(t.valor - t.tarifas) as valor, count(*)::integer as qtd,
             -- Dias até o vencimento, ponderados pelo valor (só a vencer).
             sum((t.vencimento - hoje) * (t.valor - t.tarifas)) filter (where t.vencimento >= hoje) as dias_valor
      from public.indicadores_titulos(emp_fin, ver_pagar, ver_receber) t where t.situacao = 'aberto'
      group by 1, 2
    ) x));

  -- Pontualidade das baixas no período: pago/recebido em dia ou com atraso.
  saida := saida || jsonb_build_object('pontualidade', (
    select coalesce(jsonb_agg(to_jsonb(x)), '[]')
    from (
      select t.tipo, count(*)::integer as qtd, sum(t.valor_baixa) as valor,
             count(*) filter (where t.data_baixa <= t.vencimento)::integer as em_dia,
             sum(t.valor_baixa) filter (where t.data_baixa > t.vencimento) as valor_atrasado,
             sum((t.data_baixa - t.vencimento) * t.valor_baixa) filter (where t.data_baixa > t.vencimento) as dias_atraso_valor
      from public.indicadores_titulos(emp_fin, ver_pagar, ver_receber) t
      where t.situacao = 'pago' and t.data_baixa between de and ate
      group by 1
    ) x));

  -- Baixas dos últimos 90 dias (média diária para o prazo médio pelo saldo).
  saida := saida || jsonb_build_object('baixas_90d', (
    select coalesce(jsonb_object_agg(x.tipo, x.valor), '{}')
    from (
      select t.tipo, sum(t.valor_baixa) as valor from public.indicadores_titulos(emp_fin, ver_pagar, ver_receber) t
      where t.situacao = 'pago' and t.data_baixa > hoje - 90 and t.data_baixa <= hoje
      group by 1
    ) x));

  -- Principais clientes e fornecedores do período (pelo vencimento).
  saida := saida || jsonb_build_object('pessoas', (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.tipo, x.total desc), '[]')
    from (
      select y.*, row_number() over (partition by y.tipo order by y.total desc) as posicao
      from (
        select t.tipo, t.pessoa_id,
               coalesce(case when t.tipo = 'pagar' then coalesce(f.nome_fantasia, f.nome) else coalesce(c.nome_fantasia, c.nome) end,
                        'Sem cadastro') as nome,
               sum(t.valor) as total, count(*)::integer as qtd,
               sum(t.valor) filter (where t.situacao = 'aberto') as aberto,
               sum(t.valor) filter (where t.situacao = 'aberto' and t.vencimento < hoje) as vencido,
               count(*) filter (where t.situacao = 'pago')::integer as baixados,
               count(*) filter (where t.situacao = 'pago' and t.data_baixa <= t.vencimento)::integer as em_dia,
               avg(t.data_baixa - t.vencimento) filter (where t.situacao = 'pago') as atraso_medio,
               max(f.condicao_pagamento) as condicao_cadastro
        from public.indicadores_titulos(emp_fin, ver_pagar, ver_receber) t
        left join public.fornecedores f on ver_fornecedores and t.tipo = 'pagar' and f.id = t.pessoa_id
        left join public.clientes c on ver_clientes and t.tipo = 'receber' and c.id = t.pessoa_id
        where t.vencimento between de and ate
        group by t.tipo, t.pessoa_id, 3
      ) y
    ) x
    where x.posicao <= 20));

  -- Condições de pagamento dos pedidos (compra e venda) do período, somadas
  -- por pessoa e texto da condição; a tela converte "30/60/90" em dias.
  saida := saida || jsonb_build_object('condicoes', (
    select coalesce(jsonb_agg(to_jsonb(x)), '[]')
    from (
      select 'pagar' as tipo, c.fornecedor_id as pessoa_id, nullif(trim(c.condicao_pagamento), '') as condicao,
             (select round(sum(pp.dias * pp.valor) / nullif(sum(pp.valor), 0)) from public.pedido_compra_parcelas pp
              where pp.pedido_id = c.id and pp.dias is not null) as dias_parcelas,
             null::integer as dias_pedido,
             c.valor_total as valor
      from public.pedidos_compra_resumo c
      where c.etapa <> 'cancelado' and c.data_pedido between de and ate and c.empresa_id = any(emp_comp)
      union all
      select 'receber', v.cliente_id, nullif(trim(v.condicao_pagamento), ''), null, v.prazo_recebimento_dias, v.valor_total
      from public.pedidos_venda_resumo v
      where v.etapa_nome <> 'Cancelado' and v.data_pedido between de and ate and v.empresa_id = any(emp_ped)
    ) x));

  -- Pedidos de venda em andamento hoje, por etapa (situação do Tiny).
  saida := saida || jsonb_build_object('pedidos_etapa', (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.ordem), '[]')
    from (
      select e.id as etapa_id, e.nome, e.fase::text as fase, e.ordem,
             count(p.id)::integer as qtd, coalesce(sum(p.valor_total), 0) as valor,
             avg(hoje - (p.etapa_desde at time zone 'America/Sao_Paulo')::date) as dias_na_etapa,
             avg(hoje - p.data_pedido) as idade_media,
             max(hoje - p.data_pedido) as idade_maxima,
             count(p.id) filter (where p.prazo_entrega < hoje)::integer as atrasados,
             coalesce(sum(p.valor_total) filter (where p.prazo_entrega < hoje), 0) as valor_atrasado,
             avg(p.dias_atraso) filter (where p.prazo_entrega < hoje) as atraso_medio
      from public.etapas_pedido e
      join public.pedidos_venda_resumo p on p.etapa_id = e.id and p.empresa_id = any(emp_ped)
      where e.fase <> 'encerrado'
      group by e.id
    ) x));

  -- Pedidos por mês: entrada (data do pedido) e saída da fábrica (data de
  -- faturamento do Tiny ou, se não houver, a 1ª vez que foi visto passar para
  -- expedição/entregue aqui). Por canal, para separar B2B e e-commerce.
  saida := saida || jsonb_build_object('pedidos_mes', (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.mes), '[]')
    from (
      select m.mes, m.canal, sum(m.entrada_qtd)::integer as entrada_qtd, sum(m.entrada_valor) as entrada_valor,
             sum(m.saida_qtd)::integer as saida_qtd, sum(m.saida_valor) as saida_valor,
             sum(m.ciclo_dias) as ciclo_dias
      from (
        select to_char(p.data_pedido, 'YYYY-MM') as mes, p.canal, 1 as entrada_qtd, p.valor_total as entrada_valor,
               0 as saida_qtd, 0 as saida_valor, 0 as ciclo_dias
        from public.pedidos_venda_resumo p
        where p.etapa_nome <> 'Cancelado' and p.data_pedido between de and ate and p.empresa_id = any(emp_ped)
        union all
        select to_char(s.saiu, 'YYYY-MM'), s.canal, 0, 0, 1, s.valor_total, greatest(0, s.saiu - s.data_pedido)
        from (
          select p.canal, p.valor_total, p.data_pedido,
                 coalesce(
                   case when pv.dados_tiny ->> 'dataFaturamento' ~ '^\d{4}-\d{2}-\d{2}'
                        then left(pv.dados_tiny ->> 'dataFaturamento', 10)::date end,
                   (select min((h.em at time zone 'America/Sao_Paulo')::date)
                    from public.pedido_etapas_historico h
                    join public.etapas_pedido he on he.id = h.etapa_id
                    where h.pedido_id = p.id and he.fase in ('expedicao', 'encerrado') and he.nome <> 'Cancelado'
                      -- Só conta se o pedido foi visto antes numa etapa anterior
                      -- (quem já chegou entregue do Tiny não tem a data real).
                      and exists (select 1 from public.pedido_etapas_historico h0
                                  join public.etapas_pedido e0 on e0.id = h0.etapa_id
                                  where h0.pedido_id = p.id and h0.em < h.em and e0.fase in ('negociacao', 'producao')))
                 ) as saiu
          from public.pedidos_venda_resumo p
          join public.pedidos_venda pv on pv.id = p.id
          where p.etapa_nome <> 'Cancelado' and p.fase in ('expedicao', 'encerrado')
            and p.empresa_id = any(emp_ped)
        ) s
        where s.saiu between de and ate
      ) m
      group by m.mes, m.canal
    ) x));

  -- Notas fiscais do Tiny válidas (emitidas/autorizadas) por mês: S = venda
  -- faturada, E = entrada (compras).
  saida := saida || jsonb_build_object('notas_mes', (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.tipo, x.mes), '[]')
    from (
      select n.tipo, to_char(n.emissao, 'YYYY-MM') as mes, count(*)::integer as qtd, sum(n.valor) as valor
      from public.notas_tiny n
      where n.situacao in (2, 6, 7, 8) and n.emissao between de and ate and ver_notas and n.empresa_id = any(emp_fin)
      group by 1, 2
    ) x));

  -- Pedidos de compra por mês (sem os cancelados).
  saida := saida || jsonb_build_object('compras_mes', (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.mes), '[]')
    from (
      select to_char(c.data_pedido, 'YYYY-MM') as mes, count(*)::integer as qtd, sum(c.valor_total) as valor,
             count(*) filter (where c.etapa = 'recebido')::integer as recebidos
      from public.pedidos_compra_resumo c
      where c.etapa <> 'cancelado' and c.data_pedido between de and ate and c.empresa_id = any(emp_comp)
      group by 1
    ) x));

  -- Recebimentos por canal e mês (vendas das plataformas: bruto, tarifas, líquido).
  saida := saida || jsonb_build_object('canais_mes', (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.mes), '[]')
    from (
      select coalesce(t.canal, 'venda_direta') as canal, to_char(t.vencimento, 'YYYY-MM') as mes, count(*)::integer as qtd,
             sum(t.valor) as bruto, sum(t.tarifas) as tarifas
      from public.indicadores_titulos(emp_fin, ver_pagar, ver_receber) t
      where t.tipo = 'receber' and t.vencimento between de and ate
      group by 1, 2
    ) x));

  return saida || jsonb_build_object('hoje', hoje, 'de', de, 'ate', ate);
end;
$$;

revoke execute on function public.indicadores_gestao(date, date, uuid) from public, anon;
grant execute on function public.indicadores_gestao(date, date, uuid) to authenticated;

-- Ajuda de custo do contas a pagar: mesmas permissões das contas a pagar,
-- conferidas uma vez (as subconsultas rodam uma vez, não linha a linha).
create or replace function public.indicadores_ajuda_custo(de date, ate date, empresa uuid default null)
returns table (mes text, pessoa text, categoria_id uuid, categoria text, valor numeric, qtd integer)
language sql
stable
security definer
set search_path = ''
as $$
  select to_char(p.vencimento, 'YYYY-MM'), coalesce(f.nome_fantasia, f.nome, p.descricao), p.categoria_id, c.nome, sum(p.valor), count(*)::integer
  from public.contas_pagar p
  left join public.fornecedores f on f.id = p.fornecedor_id
  left join public.plano_contas c on c.id = p.categoria_id
  where p.situacao <> 'cancelado' and p.vencimento between de and ate
    and (select public.tem_permissao('estrategico.indicadores', 'ver') and public.tem_permissao('financeiro.pagar', 'ver'))
    and p.empresa_id = any(array(select e.id from public.empresas e
                                 where (empresa is null or e.id = empresa) and public.pode_ver_empresa(e.id)))
    and (p.descricao ilike '%ajuda%custo%' or c.nome ilike '%ajuda%custo%')
  group by 1, 2, 3, 4;
$$;
revoke execute on function public.indicadores_ajuda_custo(date, date, uuid) from public, anon;
grant execute on function public.indicadores_ajuda_custo(date, date, uuid) to authenticated;
