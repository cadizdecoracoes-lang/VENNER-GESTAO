-- =============================================================================
-- Venner Gestão · Conferência com o Tiny e notas fiscais do Tiny
--
-- Pedido do Alexandre (16/11/2026): saber se a integração com o Tiny está
-- funcionando em contas a pagar, compras, notas fiscais e pedidos de venda,
-- achar as diferenças e deixar o sistema idêntico ao Tiny.
--
-- - notas_tiny: as notas fiscais (entrada e saída) da Venner no Tiny, lidas
--   pelo robô direto da listagem, em voltas completas desde 2026.
-- - conferencia_tiny(): compara o que o robô viu no Tiny (fila da leitura) com
--   o que está aqui, módulo por módulo, e devolve cada diferença com o motivo:
--   falta aqui, sobra aqui, diferente (situação, valor, vencimento) ou lançado
--   só aqui. Não chama o Tiny: usa o que o robô já leu (a cada minuto).
-- - conferencia_tiny_resumo(): quantidade e valor de cada lado, por módulo.
-- - igualar_ao_tiny(): o botão "Deixar igual ao Tiny" da conferência. Tira a
--   proteção de "alterado aqui" e de "excluído aqui" dos itens escolhidos e
--   manda o robô reler. Título conciliado nunca é mexido (a conciliação vem
--   sempre de um título).
-- - tiny_igualados: quem mandou igualar, quando e o quê (rastro).
-- =============================================================================

-- Tela nova (Configurações › Conferência com o Tiny), liberada para quem já
-- tem a tela de integrações.
insert into public.telas (codigo, titulo, grupo) values
  ('config.conferencia_tiny', 'Conferência com o Tiny', 'Configurações');
insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select perfil_id, 'config.conferencia_tiny', acao from public.perfil_permissoes
where tela_codigo = 'config.integracoes' and acao in ('ver', 'editar')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Notas fiscais do Tiny
-- -----------------------------------------------------------------------------
create table public.notas_tiny (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  tiny_id bigint not null unique,
  -- E entrada · S saída
  tipo text not null check (tipo in ('E', 'S')),
  numero text,
  serie text,
  chave text,
  -- 1 pendente, 2 emitida, 3 cancelada, 4 aguardando recibo, 5 rejeitada,
  -- 6 autorizada, 7 DANFE emitida, 8 registrada, 9 aguardando protocolo, 10 denegada
  situacao smallint not null,
  emissao date,
  contato_nome text,
  contato_documento text,
  valor numeric(14, 2) not null default 0,
  -- De onde a nota nasceu no Tiny: venda, pedido_compra, notafiscal...
  origem_tipo text,
  origem_id text,
  pedido_ecommerce text,
  lida_em timestamptz not null default now()
);
create index notas_tiny_empresa_idx on public.notas_tiny (empresa_id, tipo, emissao);
alter table public.notas_tiny enable row level security;
create policy ver on public.notas_tiny for select to authenticated
  using ((public.tem_permissao('config.conferencia_tiny', 'ver') or public.tem_permissao('financeiro.pagar', 'ver')
          or public.tem_permissao('vendas.pedidos', 'ver'))
         and public.pode_ver_empresa(empresa_id));
revoke all on public.notas_tiny from public, anon, authenticated;
grant select on public.notas_tiny to authenticated;
alter publication supabase_realtime add table public.notas_tiny;

-- Situação da nota no Tiny em palavras.
create function public.situacao_nota_tiny(s integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case s when 1 then 'Pendente' when 2 then 'Emitida' when 3 then 'Cancelada' when 4 then 'Aguardando recibo'
    when 5 then 'Rejeitada' when 6 then 'Autorizada' when 7 then 'DANFE emitida' when 8 then 'Registrada'
    when 9 then 'Aguardando protocolo' when 10 then 'Denegada' else 'Situação ' || s end;
$$;

-- Grava as notas da listagem. Devolve quantas gravou.
create function public.tiny_aplicar_notas(integracao uuid, lote jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  empresa uuid := (select empresa_id from public.integracoes_plataforma where id = integracao);
  n integer;
begin
  if empresa is null then
    return 0;
  end if;
  insert into public.notas_tiny as x (empresa_id, tiny_id, tipo, numero, serie, chave, situacao, emissao,
    contato_nome, contato_documento, valor, origem_tipo, origem_id, pedido_ecommerce, lida_em)
  select empresa, (t ->> 'id')::bigint, t ->> 'tipo', nullif(t ->> 'numero', ''), nullif(t ->> 'serie', ''),
    nullif(t ->> 'chave', ''), coalesce((t ->> 'situacao')::smallint, 0), (t ->> 'emissao')::date,
    nullif(t ->> 'contato_nome', ''), nullif(t ->> 'contato_documento', ''), coalesce((t ->> 'valor')::numeric, 0),
    nullif(t ->> 'origem_tipo', ''), nullif(t ->> 'origem_id', ''), nullif(t ->> 'pedido_ecommerce', ''), now()
  from jsonb_array_elements(coalesce(lote -> 'notas', '[]')) t
  where t ->> 'tipo' in ('E', 'S') and (t ->> 'id') is not null
  on conflict (tiny_id) do update set
    tipo = excluded.tipo, numero = excluded.numero, serie = excluded.serie, chave = excluded.chave,
    situacao = excluded.situacao, emissao = excluded.emissao, contato_nome = excluded.contato_nome,
    contato_documento = excluded.contato_documento, valor = excluded.valor, origem_tipo = excluded.origem_tipo,
    origem_id = excluded.origem_id, pedido_ecommerce = excluded.pedido_ecommerce, lida_em = excluded.lida_em
  -- Sem mudança, não regrava (não acorda as telas a cada minuto à toa).
  where (x.tipo, x.numero, x.serie, x.chave, x.situacao, x.emissao, x.contato_nome, x.contato_documento, x.valor,
         x.origem_tipo, x.origem_id, x.pedido_ecommerce)
        is distinct from
        (excluded.tipo, excluded.numero, excluded.serie, excluded.chave, excluded.situacao, excluded.emissao,
         excluded.contato_nome, excluded.contato_documento, excluded.valor, excluded.origem_tipo, excluded.origem_id,
         excluded.pedido_ecommerce);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.tiny_aplicar_notas(uuid, jsonb) from public, anon, authenticated;

-- Robô: o lote de antes (#56), as ordens de compra e agora as notas.
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
    saida := saida || jsonb_build_object('compras', public.tiny_aplicar_compras(integracao, lote),
                                         'notas', public.tiny_aplicar_notas(integracao, lote));
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

-- -----------------------------------------------------------------------------
-- Rastro do "Deixar igual ao Tiny"
-- -----------------------------------------------------------------------------
create table public.tiny_igualados (
  tipo text not null check (tipo in ('pagar', 'receber', 'pedido', 'compra')),
  tiny_id bigint not null,
  empresa_id uuid not null references public.empresas(id),
  igualado_em timestamptz not null default now(),
  usuario_id uuid default auth.uid() references public.usuarios(id) on delete set null,
  -- O que estava protegido aqui antes de igualar.
  antes jsonb not null default '{}',
  primary key (tipo, tiny_id)
);
alter table public.tiny_igualados enable row level security;
create policy ver on public.tiny_igualados for select to authenticated
  using (public.tem_permissao('config.conferencia_tiny', 'ver') and public.pode_ver_empresa(empresa_id));
revoke all on public.tiny_igualados from public, anon, authenticated;
grant select on public.tiny_igualados to authenticated;
alter publication supabase_realtime add table public.tiny_igualados;

-- A baixa feita aqui vale mais que o Tiny, salvo depois de "Deixar igual ao
-- Tiny" (o que foi mudado aqui antes disso deixa de valer). Conciliado
-- continua valendo sempre.
create or replace function public.pagar_baixado_aqui(conta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
      select h.origem <> 'tiny'
        and h.quando > coalesce((select g.igualado_em from public.tiny_igualados g
                                 join public.contas_pagar p on p.tiny_id = g.tiny_id
                                 where g.tipo = 'pagar' and p.id = conta), '-infinity')
      from public.contas_pagar_historico h
      where h.conta_id = conta and (h.evento = 'criada' or h.mudancas ? 'Situação')
      order by h.quando desc limit 1), false)
    or exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = conta);
$$;
revoke execute on function public.pagar_baixado_aqui(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Conferência
-- -----------------------------------------------------------------------------

-- Situação do título no Tiny (texto da listagem) no jeito daqui. Parcial
-- fica em aberto aqui (com o saldo na observação).
create function public.situacao_titulo_tiny(s text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(s, '')) like 'cancel%' then 'cancelado'
    when lower(coalesce(s, '')) in ('pago', 'paga', 'liquidado', 'liquidada', 'quitado', 'quitada') then 'pago'
    else 'aberto' end;
$$;

-- Parte da assinatura da fila como número ou data (vazio ou inválido = null).
create function public.parte_numero(assinatura text, n integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when split_part(assinatura, '|', n) ~ '^-?\d+(\.\d+)?$' then split_part(assinatura, '|', n)::numeric end;
$$;

create function public.parte_data(assinatura text, n integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when split_part(assinatura, '|', n) ~ '^\d{4}-\d{2}-\d{2}' then left(split_part(assinatura, '|', n), 10)::date
              when split_part(assinatura, '|', n) ~ '^\d{2}/\d{2}/\d{4}' then to_date(left(split_part(assinatura, '|', n), 10), 'DD/MM/YYYY') end;
$$;

-- Toda diferença entre o Tiny e o sistema, das empresas que a pessoa vê.
--   problema: falta_aqui · sobra_aqui · diferente · so_aqui
--   corrigivel: o botão "Deixar igual ao Tiny" resolve
create function public.conferencia_tiny()
returns table (
  empresa_id uuid, modulo text, problema text, campos text, motivo text, corrigivel boolean,
  tiny_id bigint, referencia text,
  tiny_situacao text, tiny_valor numeric, tiny_data date,
  venner_id uuid, venner_situacao text, venner_valor numeric, venner_data date
)
language sql
stable
security definer
set search_path = ''
as $$
  with integ as (
    select i.id, i.empresa_id from public.integracoes_plataforma i
    where i.canal = 'tiny' and public.tem_permissao('config.conferencia_tiny', 'ver') and public.pode_ver_empresa(i.empresa_id)
  ),
  fila as (
    select g.empresa_id, f.tipo, f.id_externo, f.assinatura, f.pendente, f.erro, f.visto_em,
      coalesce(f.erro = 'Não existe mais no Tiny', false) as apagado
    from public.integracao_fila f join integ g on g.id = f.integracao_id
  ),
  -- Títulos como o Tiny mostra na listagem (situação|valor|saldo|vencimento|alteração).
  -- Só o que a leitura considera: em aberto ou com vencimento de 2026 em diante.
  -- O que não aparece há 2 dias numa listagem é relido pelo robô; até lá,
  -- só conta como "em aberto no Tiny" se aparecer.
  tit as (
    select f.*, public.situacao_titulo_tiny(split_part(f.assinatura, '|', 1)) as sit,
      public.parte_numero(f.assinatura, 2) as valor, public.parte_data(f.assinatura, 4) as venc,
      f.visto_em > now() - interval '2 days' as recente
    from fila f where f.tipo in ('pagar', 'receber') and not f.apagado
  ),
  -- Os títulos daqui (pagar e receber juntos).
  loc as (
    select 'pagar' as tipo, p.id, p.empresa_id, p.tiny_id, p.situacao::text as situacao, p.valor, p.vencimento,
      p.descricao, p.editado_aqui, public.pagar_baixado_aqui(p.id) and p.situacao = 'pago' as baixado_aqui,
      exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = p.id) as conciliado
    from public.contas_pagar p where p.empresa_id in (select empresa_id from integ)
    union all
    select 'receber', r.id, r.empresa_id, r.tiny_id, r.situacao::text, r.valor, r.vencimento,
      r.descricao, r.editado_aqui, false,
      exists (select 1 from public.extrato_conciliacoes c where c.conta_receber_id = r.id)
    from public.contas_receber r where r.empresa_id in (select empresa_id from integ)
  ),
  motivo_titulo as (
    select l.id,
      concat_ws(' · ',
        case when l.conciliado then 'Conciliado com o extrato (não muda)' end,
        case when l.baixado_aqui then 'Baixa feita aqui' end,
        case when cardinality(l.editado_aqui) > 0 then 'Alterado aqui: ' || array_to_string(array(
          select case e when 'fornecedor_id' then 'fornecedor' when 'cliente_id' then 'cliente' when 'descricao' then 'descrição'
            when 'categoria_id' then 'categoria' when 'vencimento' then 'vencimento' when 'situacao' then 'situação'
            when 'data_pagamento' then 'data do pagamento' when 'valor_pago' then 'valor pago'
            when 'data_recebimento' then 'data do recebimento' when 'valor_recebido' then 'valor recebido'
            when 'conta_bancaria_id' then 'conta' when 'observacao' then 'observação' else e end
          from unnest(l.editado_aqui) e), ', ') end) as texto
    from loc l
  )
  -- 1. Títulos do Tiny que não estão aqui.
  select t.empresa_id, t.tipo, 'falta_aqui', null::text,
    coalesce(
      (select 'Excluído aqui em ' || to_char(x.excluido_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
              || coalesce(' por ' || u.nome, '')
       from public.tiny_excluidos x left join public.usuarios u on u.id = x.usuario_id
       where x.tipo = t.tipo and x.tiny_id = t.id_externo),
      case when t.pendente then 'Aguardando a leitura do Tiny' end,
      case when t.erro is not null then 'Erro na leitura: ' || t.erro end,
      'Sem motivo conhecido'),
    not t.pendente,
    t.id_externo, null, t.sit, t.valor, t.venc, null::uuid, null, null, null
  from tit t
  where t.sit <> 'cancelado' and coalesce(t.valor, 0) > 0 and (t.sit = 'aberto' or t.venc >= date '2026-01-01')
    and not exists (select 1 from loc l where l.tipo = t.tipo and l.tiny_id = t.id_externo)

  union all
  -- 2. Títulos daqui ligados ao Tiny que o Tiny não tem mais (ou não lista mais em aberto).
  select l.empresa_id, l.tipo, 'sobra_aqui', null,
    concat_ws(' · ',
      case when t.id_externo is null then 'O robô nunca viu este título no Tiny'
           when t.apagado then 'Apagado no Tiny'
           else 'Em aberto aqui, mas não aparece em aberto no Tiny' end,
      nullif(m.texto, '')),
    not l.conciliado,
    l.tiny_id, l.descricao, case when t.apagado then 'apagado' end, null, null, l.id, l.situacao, l.valor, l.vencimento
  from loc l
  join motivo_titulo m on m.id = l.id
  left join fila t on t.tipo = l.tipo and t.id_externo = l.tiny_id
  where l.tiny_id is not null and l.situacao <> 'cancelado'
    and (t.id_externo is null or t.apagado
         or (l.situacao = 'aberto' and t.visto_em < now() - interval '2 days' and not t.pendente))

  union all
  -- 3. Nos dois lados, com situação, valor ou vencimento diferentes.
  select l.empresa_id, l.tipo, 'diferente',
    concat_ws(', ',
      case when t.sit <> l.situacao then 'situação' end,
      case when t.valor is distinct from l.valor then 'valor' end,
      case when t.venc is distinct from l.vencimento then 'vencimento' end),
    coalesce(nullif(m.texto, ''), case when t.pendente then 'Aguardando a leitura do Tiny' end,
      case when t.erro is not null then 'Erro na leitura: ' || t.erro end, 'Sem motivo conhecido'),
    not l.conciliado,
    l.tiny_id, l.descricao, t.sit, t.valor, t.venc, l.id, l.situacao, l.valor, l.vencimento
  from loc l
  join motivo_titulo m on m.id = l.id
  join tit t on t.tipo = l.tipo and t.id_externo = l.tiny_id
  where t.recente
    and (t.sit <> l.situacao or t.valor is distinct from l.valor or t.venc is distinct from l.vencimento)

  union all
  -- 4. Lançados só aqui (sem número do Tiny), de 2026 em diante: para conferir repetidos.
  select l.empresa_id, l.tipo, 'so_aqui', null, 'Lançado só no sistema Venner', false,
    null, l.descricao, null, null, null, l.id, l.situacao, l.valor, l.vencimento
  from loc l
  where l.tiny_id is null and l.situacao <> 'cancelado' and l.vencimento >= date '2026-01-01'

  union all
  -- 5. Pedidos de venda (situação|valor|data prevista).
  select coalesce(p.empresa_id, f.empresa_id), 'pedidos',
    case when p.id is null then 'falta_aqui' when f.id_externo is null or f.apagado then 'sobra_aqui' else 'diferente' end,
    case when p.id is not null and f.id_externo is not null and not f.apagado then concat_ws(', ',
      case when public.tiny_etapa(public.parte_numero(f.assinatura, 1)::integer) is distinct from p.etapa_id then 'situação' end,
      case when public.parte_numero(f.assinatura, 2) not in (p.valor_total, p.valor_total + p.valor_frete - p.valor_desconto)
           then 'valor' end) end,
    case when p.id is null then coalesce(case when f.pendente then 'Aguardando a leitura do Tiny' end,
                                         'Erro na leitura: ' || f.erro, 'Sem motivo conhecido')
         when f.id_externo is null then 'O robô nunca viu este pedido no Tiny'
         when f.apagado then 'Apagado no Tiny'
         when f.pendente then 'Aguardando a leitura do Tiny'
         when public.tiny_etapa(public.parte_numero(f.assinatura, 1)::integer) is distinct from p.etapa_id
           then 'A etapa daqui só avança pelo Tiny: voltou ou foi mudada aqui'
         else 'Itens, frete ou desconto diferentes' end,
    f.id_externo is not null,
    coalesce(p.tiny_id, f.id_externo), coalesce(p.numero_externo, '#' || f.id_externo),
    (select e.nome from public.etapas_pedido e where e.id = public.tiny_etapa(public.parte_numero(f.assinatura, 1)::integer)),
    public.parte_numero(f.assinatura, 2), public.parte_data(f.assinatura, 3),
    p.id, p.etapa_nome, p.valor_total + p.valor_frete - p.valor_desconto, p.prazo_entrega
  from (select * from fila where tipo = 'pedido') f
  full join (select p.id, p.empresa_id, p.tiny_id, p.numero_externo, p.etapa_id, p.prazo_entrega, p.valor_frete, p.valor_desconto,
               e.nome as etapa_nome, e.nome = 'Cancelado' as cancelado,
               coalesce((select sum(i.valor_total) from public.pedido_venda_itens i where i.pedido_id = p.id), 0) as valor_total
             from public.pedidos_venda p join public.etapas_pedido e on e.id = p.etapa_id
             where p.tiny_id is not null and p.empresa_id in (select empresa_id from integ)) p on p.tiny_id = f.id_externo
  where (p.id is null and not f.apagado and public.parte_numero(f.assinatura, 1) is distinct from 2)
     or (p.id is not null and (f.id_externo is null or f.apagado) and not p.cancelado)
     or (p.id is not null and f.id_externo is not null and not f.apagado
         and (public.tiny_etapa(public.parte_numero(f.assinatura, 1)::integer) is distinct from p.etapa_id
              or public.parte_numero(f.assinatura, 2) not in (p.valor_total, p.valor_total + p.valor_frete - p.valor_desconto)))

  union all
  -- 6. Ordens de compra (situação|data|data prevista|total|número).
  select coalesce(c.empresa_id, f.empresa_id), 'compras',
    case when c.id is null then 'falta_aqui' when f.id_externo is null or f.apagado then 'sobra_aqui' else 'diferente' end,
    case when c.id is not null and f.id_externo is not null and not f.apagado then concat_ws(', ',
      case when public.parte_numero(f.assinatura, 1) is distinct from c.situacao_tiny then 'situação' end,
      case when public.parte_numero(f.assinatura, 4) not in (c.valor_total, c.valor_itens + c.valor_frete - c.valor_desconto)
           then 'valor' end) end,
    case when c.id is null then coalesce(case when f.pendente then 'Aguardando a leitura do Tiny' end,
                                         'Erro na leitura: ' || f.erro, 'Sem motivo conhecido')
         when f.id_externo is null then 'O robô nunca viu esta ordem no Tiny'
         when f.apagado then 'Apagada no Tiny'
         when f.pendente then 'Aguardando a leitura do Tiny'
         else 'Itens, frete ou desconto diferentes' end,
    f.id_externo is not null,
    coalesce(c.tiny_id, f.id_externo), coalesce(c.numero_tiny, nullif(split_part(f.assinatura, '|', 5), ''), '#' || f.id_externo),
    case public.parte_numero(f.assinatura, 1)::integer when 0 then 'Em aberto' when 1 then 'Atendida' when 2 then 'Cancelada'
      when 3 then 'Em andamento' end,
    public.parte_numero(f.assinatura, 4), public.parte_data(f.assinatura, 2),
    c.id, c.etapa::text, c.valor_total, c.data_pedido
  from (select * from fila where tipo = 'compra') f
  full join (select * from public.pedidos_compra_resumo where tiny_id is not null
               and empresa_id in (select empresa_id from integ)) c on c.tiny_id = f.id_externo
  where (c.id is null and not f.apagado)
     or (c.id is not null and (f.id_externo is null or f.apagado) and c.etapa <> 'cancelado')
     or (c.id is not null and f.id_externo is not null and not f.apagado
         and (public.parte_numero(f.assinatura, 1) is distinct from c.situacao_tiny
              or public.parte_numero(f.assinatura, 4) not in (c.valor_total, c.valor_itens + c.valor_frete - c.valor_desconto)))

  union all
  -- 7. Notas de saída válidas no Tiny sem pedido aqui com esse número de nota,
  --    e notas canceladas no Tiny que ainda estão num pedido daqui.
  select n.empresa_id, 'notas_saida',
    case when n.situacao = 3 then 'diferente' else 'falta_aqui' end,
    case when n.situacao = 3 then 'situação' end,
    case when n.situacao = 3 then 'Cancelada no Tiny, mas o pedido daqui ainda tem esta nota'
         when n.origem_tipo = 'venda' then 'O pedido desta nota não está aqui'
         else 'Nota emitida no Tiny sem pedido de venda' end,
    false, n.tiny_id, concat_ws(' · ', 'NF ' || n.numero, n.contato_nome),
    public.situacao_nota_tiny(n.situacao), n.valor, n.emissao, p.id, p.numero_externo, null, null
  from public.notas_tiny n
  left join lateral (
    select p.id, p.numero_externo from public.pedidos_venda p
    where p.empresa_id = n.empresa_id and p.nota_fiscal = n.numero limit 1
  ) p on true
  where n.tipo = 'S' and n.empresa_id in (select empresa_id from integ)
    and ((n.situacao in (2, 6, 7, 8) and p.id is null
          and not exists (select 1 from public.notas_venda v where v.tiny_id = n.tiny_id))
         or (n.situacao = 3 and p.id is not null))

  union all
  -- 8. Notas de entrada válidas no Tiny que não estão em Notas de fornecedor.
  select n.empresa_id, 'notas_entrada', 'falta_aqui', null,
    case when n.origem_tipo = 'pedido_compra' then 'Nota de uma ordem de compra do Tiny, ainda não lançada aqui'
         else 'Nota de entrada só no Tiny' end,
    false, n.tiny_id, concat_ws(' · ', 'NF ' || n.numero, n.contato_nome),
    public.situacao_nota_tiny(n.situacao), n.valor, n.emissao, null, null, null, null
  from public.notas_tiny n
  where n.tipo = 'E' and n.situacao in (2, 6, 7, 8) and n.empresa_id in (select empresa_id from integ)
    and not exists (
      select 1 from public.notas_fornecedor nf
      where nf.empresa_id = n.empresa_id
        and (nf.chave = n.chave or (n.chave is null and ltrim(nf.numero, '0') = n.numero and nf.valor_total = n.valor)));
$$;
revoke execute on function public.conferencia_tiny() from public, anon;
grant execute on function public.conferencia_tiny() to authenticated;

-- Quantidade e valor de cada lado, por módulo (o que o robô viu no Tiny x o
-- que está aqui ligado ao Tiny), e quando a leitura de cada módulo rodou.
create function public.conferencia_tiny_resumo()
returns table (empresa_id uuid, modulo text, tiny_qtd integer, tiny_valor numeric, venner_qtd integer, venner_valor numeric,
  so_aqui_qtd integer, lido_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with integ as (
    select i.id, i.empresa_id from public.integracoes_plataforma i
    where i.canal = 'tiny' and public.tem_permissao('config.conferencia_tiny', 'ver') and public.pode_ver_empresa(i.empresa_id)
  ),
  fila as (
    select g.empresa_id, f.* from public.integracao_fila f join integ g on g.id = f.integracao_id
    where f.erro is distinct from 'Não existe mais no Tiny'
  )
  select g.empresa_id, m.modulo,
    case m.modulo
      when 'pagar' then (select count(*) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'pagar'
                           and public.situacao_titulo_tiny(split_part(f.assinatura, '|', 1)) = 'aberto' and f.visto_em > now() - interval '2 days')
      when 'receber' then (select count(*) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'receber'
                           and public.situacao_titulo_tiny(split_part(f.assinatura, '|', 1)) = 'aberto' and f.visto_em > now() - interval '2 days')
      when 'pedidos' then (select count(*) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'pedido')
      when 'compras' then (select count(*) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'compra')
      when 'notas_saida' then (select count(*) from public.notas_tiny n where n.empresa_id = g.empresa_id and n.tipo = 'S' and n.situacao in (2, 6, 7, 8))
      when 'notas_entrada' then (select count(*) from public.notas_tiny n where n.empresa_id = g.empresa_id and n.tipo = 'E' and n.situacao in (2, 6, 7, 8))
    end::integer,
    case m.modulo
      when 'pagar' then (select sum(public.parte_numero(f.assinatura, 3)) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'pagar'
                           and public.situacao_titulo_tiny(split_part(f.assinatura, '|', 1)) = 'aberto' and f.visto_em > now() - interval '2 days')
      when 'receber' then (select sum(public.parte_numero(f.assinatura, 3)) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'receber'
                           and public.situacao_titulo_tiny(split_part(f.assinatura, '|', 1)) = 'aberto' and f.visto_em > now() - interval '2 days')
      when 'pedidos' then (select sum(public.parte_numero(f.assinatura, 2)) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'pedido'
                           and public.parte_numero(f.assinatura, 1) is distinct from 2)
      when 'compras' then (select sum(public.parte_numero(f.assinatura, 4)) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'compra'
                           and public.parte_numero(f.assinatura, 1) is distinct from 2)
      when 'notas_saida' then (select sum(n.valor) from public.notas_tiny n where n.empresa_id = g.empresa_id and n.tipo = 'S' and n.situacao in (2, 6, 7, 8))
      when 'notas_entrada' then (select sum(n.valor) from public.notas_tiny n where n.empresa_id = g.empresa_id and n.tipo = 'E' and n.situacao in (2, 6, 7, 8))
    end,
    case m.modulo
      when 'pagar' then (select count(*) from public.contas_pagar p where p.empresa_id = g.empresa_id and p.tiny_id is not null and p.situacao = 'aberto')
      when 'receber' then (select count(*) from public.contas_receber r where r.empresa_id = g.empresa_id and r.tiny_id is not null and r.situacao = 'aberto')
      when 'pedidos' then (select count(*) from public.pedidos_venda p where p.empresa_id = g.empresa_id and p.tiny_id is not null)
      when 'compras' then (select count(*) from public.pedidos_compra c where c.empresa_id = g.empresa_id and c.tiny_id is not null)
      when 'notas_saida' then (select count(distinct p.nota_fiscal) from public.pedidos_venda p where p.empresa_id = g.empresa_id and p.tiny_id is not null and p.nota_fiscal is not null)
      when 'notas_entrada' then (select count(*) from public.notas_fornecedor nf where nf.empresa_id = g.empresa_id and nf.data_emissao >= date '2026-01-01')
    end::integer,
    case m.modulo
      when 'pagar' then (select sum(p.valor) from public.contas_pagar p where p.empresa_id = g.empresa_id and p.tiny_id is not null and p.situacao = 'aberto')
      when 'receber' then (select sum(r.valor) from public.contas_receber r where r.empresa_id = g.empresa_id and r.tiny_id is not null and r.situacao = 'aberto')
      when 'pedidos' then (select sum(coalesce((select sum(i.valor_total) from public.pedido_venda_itens i where i.pedido_id = p.id), 0)
                                      + p.valor_frete - p.valor_desconto)
                           from public.pedidos_venda p join public.etapas_pedido e on e.id = p.etapa_id
                           where p.empresa_id = g.empresa_id and p.tiny_id is not null and e.nome <> 'Cancelado')
      when 'compras' then (select sum(c.valor_total) from public.pedidos_compra_resumo c where c.empresa_id = g.empresa_id and c.tiny_id is not null and c.etapa <> 'cancelado')
      when 'notas_saida' then null
      when 'notas_entrada' then (select sum(nf.valor_total) from public.notas_fornecedor nf where nf.empresa_id = g.empresa_id and nf.data_emissao >= date '2026-01-01')
    end,
    case m.modulo
      when 'pagar' then (select count(*) from public.contas_pagar p where p.empresa_id = g.empresa_id and p.tiny_id is null
                           and p.situacao = 'aberto')
      when 'receber' then (select count(*) from public.contas_receber r where r.empresa_id = g.empresa_id and r.tiny_id is null
                           and r.situacao = 'aberto')
      when 'pedidos' then (select count(*) from public.pedidos_venda p where p.empresa_id = g.empresa_id and p.tiny_id is null)
      when 'compras' then (select count(*) from public.pedidos_compra c where c.empresa_id = g.empresa_id and c.tiny_id is null and c.etapa <> 'cancelado')
      else 0
    end::integer,
    case m.modulo
      when 'pagar' then (select max(f.visto_em) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'pagar')
      when 'receber' then (select max(f.visto_em) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'receber')
      when 'pedidos' then (select max(f.visto_em) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'pedido')
      when 'compras' then (select max(f.visto_em) from fila f where f.empresa_id = g.empresa_id and f.tipo = 'compra')
      else (select max(n.lida_em) from public.notas_tiny n where n.empresa_id = g.empresa_id)
    end
  from integ g
  cross join (values (1, 'pagar'), (2, 'compras'), (3, 'notas_entrada'), (4, 'pedidos'), (5, 'notas_saida'), (6, 'receber')) m(ordem, modulo)
  order by g.empresa_id, m.ordem;
$$;
revoke execute on function public.conferencia_tiny_resumo() from public, anon;
grant execute on function public.conferencia_tiny_resumo() to authenticated;

-- -----------------------------------------------------------------------------
-- "Deixar igual ao Tiny": para os números do Tiny escolhidos de um módulo,
-- tira a proteção daqui e manda o robô reler. Conciliado não muda.
-- Devolve quantos foram mandados igualar e quantos ficaram (conciliados).
-- -----------------------------------------------------------------------------
create function public.igualar_ao_tiny(modulo text, numeros bigint[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tipo_fila text := case modulo when 'pagar' then 'pagar' when 'receber' then 'receber' when 'pedidos' then 'pedido'
                                 when 'compras' then 'compra' end;
  n bigint;
  integ uuid;
  empresa uuid;
  feitos integer := 0;
  conciliados integer := 0;
  t record;
begin
  if tipo_fila is null then
    raise exception 'Módulo sem correção automática: %', modulo;
  end if;
  if not public.tem_permissao('config.conferencia_tiny', 'editar') then
    raise exception 'Sem permissão para corrigir pela conferência do Tiny';
  end if;
  perform set_config('venner.leitura_tiny', 'sim', true);

  foreach n in array coalesce(numeros, '{}') loop
    -- A conta do Tiny que viu este número (ou, sem fila, a da empresa do registro).
    select f.integracao_id, i.empresa_id into integ, empresa
    from public.integracao_fila f join public.integracoes_plataforma i on i.id = f.integracao_id
    where f.tipo = tipo_fila and f.id_externo = n limit 1;
    if integ is null then
      select i.id, i.empresa_id into integ, empresa from public.integracoes_plataforma i
      where i.canal = 'tiny' and i.empresa_id = coalesce(
        (select p.empresa_id from public.contas_pagar p where tipo_fila = 'pagar' and p.tiny_id = n),
        (select r.empresa_id from public.contas_receber r where tipo_fila = 'receber' and r.tiny_id = n),
        (select p.empresa_id from public.pedidos_venda p where tipo_fila = 'pedido' and p.tiny_id = n),
        (select c.empresa_id from public.pedidos_compra c where tipo_fila = 'compra' and c.tiny_id = n))
      limit 1;
    end if;
    if integ is null or not public.pode_ver_empresa(empresa) then
      continue;
    end if;

    if tipo_fila in ('pagar', 'receber') then
      if tipo_fila = 'pagar' then
        select p.id, p.situacao::text as situacao, p.editado_aqui,
          exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = p.id) as conciliado
        into t from public.contas_pagar p where p.tiny_id = n;
      else
        select r.id, r.situacao::text as situacao, r.editado_aqui,
          exists (select 1 from public.extrato_conciliacoes c where c.conta_receber_id = r.id) as conciliado
        into t from public.contas_receber r where r.tiny_id = n;
      end if;
      if t.id is not null and t.conciliado then
        conciliados := conciliados + 1;
        continue;
      end if;
      insert into public.tiny_igualados as g (tipo, tiny_id, empresa_id, antes)
      values (tipo_fila, n, empresa, jsonb_build_object(
        'editado_aqui', to_jsonb(coalesce(t.editado_aqui, '{}')),
        'excluido_aqui', exists (select 1 from public.tiny_excluidos x where x.tipo = tipo_fila and x.tiny_id = n)))
      on conflict (tipo, tiny_id) do update set igualado_em = now(), usuario_id = auth.uid(), antes = excluded.antes;
      delete from public.tiny_excluidos x where x.tipo = tipo_fila and x.tiny_id = n;
      if tipo_fila = 'pagar' then
        update public.contas_pagar set editado_aqui = '{}' where tiny_id = n and editado_aqui <> '{}';
        -- Apagado no Tiny: aqui também deixa de valer.
        update public.contas_pagar set situacao = 'cancelado', observacao = 'Apagado no Tiny',
          data_pagamento = null, valor_pago = null, conta_bancaria_id = null
        where tiny_id = n and situacao <> 'cancelado'
          and exists (select 1 from public.integracao_fila f where f.tipo = 'pagar' and f.id_externo = n and f.erro = 'Não existe mais no Tiny');
      else
        update public.contas_receber set editado_aqui = '{}' where tiny_id = n and editado_aqui <> '{}';
        update public.contas_receber set situacao = 'cancelado', observacao = 'Apagado no Tiny',
          data_recebimento = null, valor_recebido = null, conta_bancaria_id = null
        where tiny_id = n and situacao <> 'cancelado'
          and exists (select 1 from public.integracao_fila f where f.tipo = 'receber' and f.id_externo = n and f.erro = 'Não existe mais no Tiny');
      end if;
    elsif tipo_fila = 'pedido' then
      insert into public.tiny_igualados as g (tipo, tiny_id, empresa_id, antes)
      select 'pedido', n, empresa, jsonb_build_object('etapa', e.nome)
      from public.pedidos_venda p join public.etapas_pedido e on e.id = p.etapa_id where p.tiny_id = n
      on conflict (tipo, tiny_id) do update set igualado_em = now(), usuario_id = auth.uid(), antes = excluded.antes;
      -- A etapa volta a ser a do Tiny, mesmo que seja anterior à daqui.
      update public.pedidos_venda p set etapa_id = public.tiny_etapa(public.parte_numero(f.assinatura, 1)::integer)
      from public.integracao_fila f
      where p.tiny_id = n and f.tipo = 'pedido' and f.id_externo = n and f.erro is null
        and public.parte_numero(f.assinatura, 1) is not null
        and p.etapa_id is distinct from public.tiny_etapa(public.parte_numero(f.assinatura, 1)::integer);
    else
      insert into public.tiny_igualados as g (tipo, tiny_id, empresa_id)
      values ('compra', n, empresa)
      on conflict (tipo, tiny_id) do update set igualado_em = now(), usuario_id = auth.uid();
    end if;

    -- O robô relê o detalhe na próxima leitura (em até 1 minuto).
    insert into public.integracao_fila as f (integracao_id, tipo, id_externo, pendente)
    values (integ, tipo_fila, n, true)
    on conflict (integracao_id, tipo, id_externo) do update
      set pendente = f.erro is distinct from 'Não existe mais no Tiny', tentativas = 0,
          erro = case when f.erro = 'Não existe mais no Tiny' then f.erro end, atualizado_em = now();
    feitos := feitos + 1;
  end loop;

  perform set_config('venner.leitura_tiny', '', true);
  return jsonb_build_object('igualados', feitos, 'conciliados', conciliados);
end;
$$;
revoke execute on function public.igualar_ao_tiny(text, bigint[]) from public, anon;
grant execute on function public.igualar_ao_tiny(text, bigint[]) to authenticated;

-- =============================================================================
-- Decisão do Alexandre (16/11/2026): o sistema Venner só reflete o Tiny.
-- Tudo que é feito no Tiny (criar, editar, excluir) vem para cá sozinho, e o
-- que veio do Tiny não se edita nem se exclui aqui. Única exceção: a
-- conciliação bancária (baixa pelo extrato), que continua valendo mais que o
-- Tiny. Substitui as regras do #37 (alterado aqui não é sobrescrito) e do
-- #47 (excluído aqui não volta).
-- =============================================================================

-- Título do Tiny não muda aqui por pessoa. Passam: a leitura do Tiny, a
-- conciliação bancária e suas rotinas, e o "Deixar igual ao Tiny".
create function public.bloquear_titulo_tiny()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pilha text;
begin
  if old.tiny_id is null or coalesce(current_setting('venner.leitura_tiny', true), '') = 'sim' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  get diagnostics pilha = pg_context;
  if pilha ~ '(tiny_aplicar|igualar_ao_tiny|conciliar_lancamento|desfazer_conciliacao|soltar_titulo_conciliado|trazer_conciliados_da_conta_tiny|devolver_conta_tiny|conta_tiny_sem_banco|juntar_contas_bancarias|excluir_importacao_extrato|marcar_lancamento|lancar_transferencia|cancelar_transferencia_reaberta)' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Este título vem do Tiny: altere ou exclua no Tiny e ele muda aqui sozinho';
end;
$$;
revoke execute on function public.bloquear_titulo_tiny() from public, anon, authenticated;
create trigger bloquear_titulo_tiny before update or delete on public.contas_pagar
  for each row execute function public.bloquear_titulo_tiny();
create trigger bloquear_titulo_tiny before update or delete on public.contas_receber
  for each row execute function public.bloquear_titulo_tiny();

-- Baixa daqui só vale mais que o Tiny quando conciliada com o extrato.
create or replace function public.pagar_baixado_aqui(conta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = conta);
$$;
revoke execute on function public.pagar_baixado_aqui(uuid) from public, anon, authenticated;

-- A etapa do pedido do Tiny é sempre a situação do Tiny (antes só avançava).
create function public.tiny_etapa_igual(lote jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pedidos_venda p set etapa_id = public.tiny_etapa((t ->> 'situacao')::integer)
  from jsonb_array_elements(coalesce(lote -> 'pedidos', '[]')) t
  where p.tiny_id = (t ->> 'id')::bigint and (t ->> 'situacao') ~ '^\d+$'
    and public.tiny_etapa((t ->> 'situacao')::integer) is not null
    and p.etapa_id is distinct from public.tiny_etapa((t ->> 'situacao')::integer);
$$;
revoke execute on function public.tiny_etapa_igual(jsonb) from public, anon, authenticated;

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
    perform set_config('venner.leitura_tiny', 'sim', true);
    perform public.tiny_etapa_igual(lote);
    perform set_config('venner.leitura_tiny', '', true);
    saida := saida || jsonb_build_object('compras', public.tiny_aplicar_compras(integracao, lote),
                                         'notas', public.tiny_aplicar_notas(integracao, lote));
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

-- -----------------------------------------------------------------------------
-- Uma vez agora: deixa tudo igual ao Tiny (autorizado pelo Alexandre em
-- 16/11/2026). O que estava protegido fica registrado em tiny_igualados.
-- Conciliado não muda.
-- -----------------------------------------------------------------------------
select set_config('venner.leitura_tiny', 'sim', true);

-- Títulos alterados aqui (sem conciliação) e excluídos aqui.
insert into public.tiny_igualados (tipo, tiny_id, empresa_id, usuario_id, antes)
select 'pagar', p.tiny_id, p.empresa_id, null::uuid, jsonb_build_object('editado_aqui', to_jsonb(p.editado_aqui))
from public.contas_pagar p
where p.tiny_id is not null and p.editado_aqui <> '{}'
  and not exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = p.id)
union all
select 'receber', r.tiny_id, r.empresa_id, null, jsonb_build_object('editado_aqui', to_jsonb(r.editado_aqui))
from public.contas_receber r
where r.tiny_id is not null and r.editado_aqui <> '{}'
  and not exists (select 1 from public.extrato_conciliacoes c where c.conta_receber_id = r.id)
union all
select x.tipo, x.tiny_id, x.empresa_id, null,
  jsonb_build_object('excluido_aqui', true, 'descricao', x.descricao, 'excluido_em', x.excluido_em)
from public.tiny_excluidos x
on conflict (tipo, tiny_id) do nothing;

update public.contas_pagar p set editado_aqui = '{}'
where p.tiny_id is not null and p.editado_aqui <> '{}'
  and not exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = p.id);
update public.contas_receber r set editado_aqui = '{}'
where r.tiny_id is not null and r.editado_aqui <> '{}'
  and not exists (select 1 from public.extrato_conciliacoes c where c.conta_receber_id = r.id);
delete from public.tiny_excluidos;

-- Apagados no Tiny que ainda valem aqui (pagos ou baixados aqui): cancelados.
update public.contas_pagar p set situacao = 'cancelado', observacao = 'Apagado no Tiny',
          data_pagamento = null, valor_pago = null, conta_bancaria_id = null
from public.integracao_fila f
where f.tipo = 'pagar' and f.id_externo = p.tiny_id and f.erro = 'Não existe mais no Tiny' and p.situacao <> 'cancelado'
  and not exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = p.id);
update public.contas_receber r set situacao = 'cancelado', observacao = 'Apagado no Tiny',
          data_recebimento = null, valor_recebido = null, conta_bancaria_id = null
from public.integracao_fila f
where f.tipo = 'receber' and f.id_externo = r.tiny_id and f.erro = 'Não existe mais no Tiny' and r.situacao <> 'cancelado'
  and not exists (select 1 from public.extrato_conciliacoes c where c.conta_receber_id = r.id);

-- Etapa dos pedidos igual à situação que o robô viu no Tiny.
update public.pedidos_venda p set etapa_id = public.tiny_etapa(public.parte_numero(f.assinatura, 1)::integer)
from public.integracao_fila f
where f.tipo = 'pedido' and f.id_externo = p.tiny_id and f.erro is null
  and public.parte_numero(f.assinatura, 1) is not null
  and public.tiny_etapa(public.parte_numero(f.assinatura, 1)::integer) is not null
  and p.etapa_id is distinct from public.tiny_etapa(public.parte_numero(f.assinatura, 1)::integer);

select set_config('venner.leitura_tiny', '', true);

-- O robô relê tudo do Tiny (títulos, pedidos e ordens de compra): leva
-- algumas horas, no limite de chamadas do Tiny.
update public.integracao_fila set pendente = true, tentativas = 0, erro = null, atualizado_em = now()
where tipo in ('pagar', 'receber', 'pedido', 'compra') and erro is distinct from 'Não existe mais no Tiny';
