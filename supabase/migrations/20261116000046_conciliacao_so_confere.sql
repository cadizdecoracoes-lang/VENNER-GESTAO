-- =============================================================================
-- Venner Gestão · Conciliação só confere; a baixa é sempre a do Tiny
--
-- Regra do Alexandre (16/11/2026, 14:30): o sistema Venner não lança nem
-- corrige nada. A conciliação serve para subir o extrato e achar diferenças e
-- erros de baixa feitos no Tiny; a correção é feita só no Tiny.
--
-- - conciliar_lancamento só liga a linha do extrato aos títulos do Tiny: não
--   dá baixa, não troca conta nem data. Título lançado só aqui (sem Tiny)
--   segue como antes (baixado pela conciliação).
-- - desfazer a conciliação e excluir a importação só desligam. Título lançado
--   só aqui (transferência) continua como antes.
-- - O Tiny vale também sobre título conciliado: a baixa daqui que o Tiny não
--   tem é desfeita na releitura, e a linha do extrato volta para pendente
--   (gatilho soltar_conciliado), mostrando o erro a corrigir no Tiny.
-- - O gatilho bloquear_titulo_tiny não abre mais exceção para a conciliação.
-- - Conferência com o Tiny ganha "Conciliação": linha conciliada com título
--   que no Tiny está em aberto ou baixado em outra conta (data e valor só
--   quando é um título para uma linha: na conciliação de várias linhas, cada
--   ligação tem só uma parte do valor).
-- =============================================================================

create or replace function public.bloquear_titulo_tiny()
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
  -- Só a leitura do Tiny, o "Deixar igual ao Tiny" e a junção de contas
  -- bancárias repetidas (troca a conta pelo cadastro que fica).
  if pilha ~ '(tiny_aplicar|igualar_ao_tiny|juntar_contas_bancarias)' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Este título vem do Tiny: altere ou exclua no Tiny e ele muda aqui sozinho';
end;
$$;

-- Nada feito aqui vale mais que o Tiny.
create or replace function public.pagar_baixado_aqui(conta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

create or replace function public.receber_difere_do_tiny(integracao uuid)
returns setof bigint
language sql
stable
set search_path = ''
as $$
  select f.id_externo
  from public.integracao_fila f
  join public.contas_receber r on r.tiny_id = f.id_externo
  where f.integracao_id = integracao and f.tipo = 'receber' and f.erro is null
    and nullif(split_part(f.assinatura, '|', 1), '') is not null
    and (case split_part(f.assinatura, '|', 1) when 'pago' then 'pago' when 'cancelada' then 'cancelado' else 'aberto' end)
        <> r.situacao::text;
$$;

-- Conta e data de antes só eram guardadas para títulos que a conciliação mudava.
create or replace function public.devolver_conta_tiny(linhas uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.contas_pagar p set conta_bancaria_id = c.conta_anterior, data_pagamento = c.data_anterior
  from public.extrato_conciliacoes c
  where c.lancamento_id = any(linhas) and c.conta_pagar_id = p.id and c.conta_anterior is not null and p.situacao = 'pago'
    and p.tiny_id is null;
  update public.contas_receber r set conta_bancaria_id = c.conta_anterior, data_recebimento = c.data_anterior
  from public.extrato_conciliacoes c
  where c.lancamento_id = any(linhas) and c.conta_receber_id = r.id and c.conta_anterior is not null and r.situacao = 'pago'
    and r.tiny_id is null;
end;
$$;

-- Concilia: só liga a linha do extrato aos títulos (as mesmas conferências
-- de antes: empresa, cancelado, conta da baixa e soma).
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
      raise exception 'O título "%" foi baixado em outra conta bancária. Corrija a baixa no Tiny ou concilie na conta certa', t.descricao;
    end if;
    soma := soma + t.sinal * case when t.situacao = 'pago' then t.pago when quantos = 1 then alvo else t.valor end;
  end loop;
  if (select count(*) from public.contas_pagar where id = any(pagar)) + (select count(*) from public.contas_receber where id = any(receber)) <> quantos then
    raise exception 'Algum título não foi encontrado ou seu perfil não o enxerga';
  end if;
  if abs(soma - alvo) > 0.009 then
    raise exception 'Os títulos somam % e o extrato mostra %. Ajuste a escolha', to_char(soma, 'FM999G999G990D00'), to_char(alvo, 'FM999G999G990D00');
  end if;

  -- Título do Tiny: só o vínculo. Título lançado só aqui (sem Tiny) em
  -- aberto: baixado nesta conta e data, como antes.
  insert into public.extrato_conciliacoes (lancamento_id, conta_pagar_id, valor, efeito)
  select lancamento, p.id, case when p.situacao = 'pago' then p.valor_pago when quantos = 1 then alvo else p.valor end,
    case when p.situacao <> 'pago' and p.tiny_id is null then 'baixou' else 'vinculou' end
  from public.contas_pagar p where p.id = any(pagar);
  insert into public.extrato_conciliacoes (lancamento_id, conta_receber_id, valor, efeito)
  select lancamento, r.id, case when r.situacao = 'pago' then r.valor_recebido when quantos = 1 then alvo else r.valor_liquido end,
    case when r.situacao <> 'pago' and r.tiny_id is null then 'baixou' else 'vinculou' end
  from public.contas_receber r where r.id = any(receber);

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

-- Desfazer só desliga. O título lançado só aqui (transferência) que tinha
-- sido baixado pela conciliação volta para aberto, como antes.
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
  where id = any(coalesce(pagar, '{}')) and tiny_id is null;
  update public.contas_receber set situacao = 'aberto', data_recebimento = null, valor_recebido = null, conta_bancaria_id = null
  where id = any(coalesce(receber, '{}')) and tiny_id is null;

  update public.extrato_lancamentos
  set situacao = 'pendente', observacao = null, conciliado_por = null, conciliado_em = null
  where id = lancamento;
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
  where id = any(coalesce(pagar, '{}')) and tiny_id is null;
  update public.contas_receber set situacao = 'aberto', data_recebimento = null, valor_recebido = null, conta_bancaria_id = null
  where id = any(coalesce(receber, '{}')) and tiny_id is null;

  delete from public.extrato_importacoes where id = importacao;
  perform public.marcar_repetidos_extrato(imp.conta_bancaria_id);

  return jsonb_build_object(
    'linhas', linhas,
    'conciliadas', conciliadas,
    'reabertos', (select count(*) from public.contas_pagar where id = any(coalesce(pagar, '{}')) and tiny_id is null)
                 + (select count(*) from public.contas_receber where id = any(coalesce(receber, '{}')) and tiny_id is null));
end;
$$;

create or replace function public.conferencia_tiny()
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
      p.descricao, p.editado_aqui, false as baixado_aqui,
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
        case when l.conciliado then 'Conciliado com o extrato' end,
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
    true,
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
    true,
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
        and (nf.chave = n.chave or (n.chave is null and ltrim(nf.numero, '0') = n.numero and nf.valor_total = n.valor)))
  union all
  -- 9. Conciliação: linha do extrato conciliada com título do Tiny que, no
  --    Tiny, está em aberto ou baixado em outra conta (data e valor só quando
  --    é um título para uma linha; na conciliação de várias linhas cada
  --    ligação tem só parte do valor). É erro de baixa a corrigir no Tiny.
  select l.empresa_id, 'conciliacao', 'diferente',
    concat_ws(', ',
      case when x.situacao <> 'pago' then 'situação' end,
      case when x.situacao = 'pago' and x.data_baixa is distinct from l.data and x.unico then 'data' end,
      case when x.situacao = 'pago' and x.conta_bancaria_id is distinct from l.conta_bancaria_id then 'conta' end,
      case when x.situacao = 'pago' and x.valor_baixa is distinct from c.valor and x.unico then 'valor' end),
    case when x.situacao <> 'pago'
           then 'Movimentou no banco em ' || to_char(l.data, 'DD/MM/YYYY') || ', mas no Tiny está em aberto: dar a baixa no Tiny'
         else 'A baixa no Tiny não bate com o extrato: corrigir a baixa no Tiny' end,
    false, x.tiny_id, x.descricao,
    x.situacao || coalesce(' · ' || b.nome, ''), x.valor_baixa, x.data_baixa,
    x.id, 'Extrato · ' || coalesce(bl.nome, ''), c.valor, l.data
  from public.extrato_conciliacoes c
  join public.extrato_lancamentos l on l.id = c.lancamento_id
  join lateral (
    select p.id, p.tiny_id, p.descricao, p.situacao::text as situacao, p.data_pagamento as data_baixa,
      p.valor_pago as valor_baixa, p.conta_bancaria_id,
      (select count(*) from public.extrato_conciliacoes c2 where c2.lancamento_id = c.lancamento_id) = 1
        and (select count(*) from public.extrato_conciliacoes c3 where c3.conta_pagar_id = p.id) = 1 as unico
    from public.contas_pagar p where p.id = c.conta_pagar_id and p.tiny_id is not null
    union all
    select r.id, r.tiny_id, r.descricao, r.situacao::text, r.data_recebimento, r.valor_recebido, r.conta_bancaria_id,
      (select count(*) from public.extrato_conciliacoes c2 where c2.lancamento_id = c.lancamento_id) = 1
        and (select count(*) from public.extrato_conciliacoes c3 where c3.conta_receber_id = r.id) = 1
    from public.contas_receber r where r.id = c.conta_receber_id and r.tiny_id is not null
  ) x on true
  left join public.contas_bancarias b on b.id = x.conta_bancaria_id
  left join public.contas_bancarias bl on bl.id = l.conta_bancaria_id
  where l.empresa_id in (select empresa_id from integ)
    and (x.situacao <> 'pago' or (x.data_baixa is distinct from l.data and x.unico) or x.conta_bancaria_id is distinct from l.conta_bancaria_id
         or (x.valor_baixa is distinct from c.valor and x.unico));
$$;

create or replace function public.conferencia_tiny_resumo()
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
      when 'conciliacao' then (select count(*) from public.extrato_conciliacoes c join public.extrato_lancamentos l on l.id = c.lancamento_id
                               left join public.contas_pagar p on p.id = c.conta_pagar_id left join public.contas_receber r on r.id = c.conta_receber_id
                               where l.empresa_id = g.empresa_id and coalesce(p.tiny_id, r.tiny_id) is not null and coalesce(p.situacao, r.situacao) = 'pago')
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
  cross join (values (1, 'pagar'), (2, 'compras'), (3, 'notas_entrada'), (4, 'pedidos'), (5, 'notas_saida'), (6, 'receber'), (7, 'conciliacao')) m(ordem, modulo)
  order by g.empresa_id, m.ordem;
$$;

create or replace function public.igualar_ao_tiny(modulo text, numeros bigint[])
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

-- -----------------------------------------------------------------------------
-- Uma vez agora: o que a conciliação tinha mudado nos títulos do Tiny deixa de
-- valer; o robô relê todos os títulos e eles ficam como no Tiny.
-- -----------------------------------------------------------------------------
select set_config('venner.leitura_tiny', 'sim', true);
insert into public.tiny_igualados as g (tipo, tiny_id, empresa_id, usuario_id, antes)
select 'pagar', p.tiny_id, p.empresa_id, null::uuid, jsonb_build_object('editado_aqui', to_jsonb(p.editado_aqui), 'conciliado', true)
from public.contas_pagar p where p.tiny_id is not null and p.editado_aqui <> '{}'
union all
select 'receber', r.tiny_id, r.empresa_id, null::uuid, jsonb_build_object('editado_aqui', to_jsonb(r.editado_aqui), 'conciliado', true)
from public.contas_receber r where r.tiny_id is not null and r.editado_aqui <> '{}'
on conflict (tipo, tiny_id) do update set igualado_em = now(), antes = g.antes || excluded.antes;
update public.contas_pagar set editado_aqui = '{}' where tiny_id is not null and editado_aqui <> '{}';
update public.contas_receber set editado_aqui = '{}' where tiny_id is not null and editado_aqui <> '{}';
select set_config('venner.leitura_tiny', '', true);

update public.integracao_fila set pendente = true, tentativas = 0, erro = null, atualizado_em = now()
where tipo in ('pagar', 'receber') and erro is distinct from 'Não existe mais no Tiny';
