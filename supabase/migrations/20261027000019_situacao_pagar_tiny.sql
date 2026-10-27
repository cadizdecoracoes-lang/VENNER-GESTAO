-- =============================================================================
-- Venner Gestão · Contas a pagar iguais ao Tiny (situação e data da baixa)
--
-- Pedido do Alexandre: os títulos que vieram do Tiny precisam estar abertos
-- ou pagos como no Tiny e, os pagos, com a data em que saíram do banco e a
-- conta usada lá.
--
-- O que estava errado: a leitura não achava a data e a conta da baixa na
-- resposta do Tiny e caía no vencimento e em "Tiny · conta não informada";
-- e um título marcado como pago aqui nunca voltava a ficar em aberto, mesmo
-- quando o pago tinha vindo do próprio Tiny.
--
-- - pagar_baixado_aqui: a baixa foi feita aqui por uma pessoa (ou conciliada
--   com o extrato). Essa baixa vale mais que o Tiny e não é desfeita.
-- - tiny_aplicar: o resto segue o Tiny (aberto, pago, cancelado). Sem data
--   ou conta da baixa no Tiny, fica a que já estava aqui.
-- - tiny_aplicar_planilha_pagar: confere a planilha de contas a pagar
--   exportada do Tiny com os títulos daqui e corrige a situação, a data do
--   pagamento, o valor pago e a conta (primeiro mostra, depois aplica).
-- - Todos os títulos do Tiny voltam para a fila e são relidos pelo robô.
-- - As correções entram no histórico da conta com origem "Tiny" (o gatilho
--   de rastreio reconhece as duas funções pelo nome tiny_aplicar).
-- =============================================================================

-- A última mudança de situação foi feita aqui (pessoa ou rotina do banco),
-- ou o título está conciliado com uma linha do extrato.
create function public.pagar_baixado_aqui(conta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
      select h.origem <> 'tiny' from public.contas_pagar_historico h
      where h.conta_id = conta and (h.evento = 'criada' or h.mudancas ? 'Situação')
      order by h.quando desc limit 1), false)
    or exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = conta);
$$;
revoke execute on function public.pagar_baixado_aqui(uuid) from public, anon, authenticated;

-- Nome sem acento, caixa e espaços repetidos, para comparar com a planilha.
create function public.texto_comparavel(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(lower(translate(trim(t),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '\s+', ' ', 'g'), '');
$$;

create or replace function public.tiny_aplicar(integracao uuid, lote jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  empresa uuid := (select empresa_id from public.integracoes_plataforma where id = integracao);
  desde date := coalesce((lote ->> 'historico_desde')::date, date '2026-01-01');
  x jsonb;
  t jsonb;
  grupo uuid;
  atual record;
  pessoa uuid;
  categoria uuid;
  pedido uuid;
  etapa uuid;
  sit public.situacao_titulo;
  quando date;
  pago numeric;
  banco uuid;
  fixo boolean;
  obs text;
  num text;
  canal_ped text;
  r jsonb := '{"receber": 0, "pagar": 0, "pedidos": 0, "pulados": 0}';
begin
  if empresa is null then
    raise exception 'Integração não encontrada';
  end if;
  perform set_config('venner.leitura_tiny', 'sim', true);

  -- Contas financeiras do Tiny viram contas bancárias da empresa (pelo nome).
  for x in select * from jsonb_array_elements(coalesce(lote -> 'contas', '[]')) loop
    if not exists (select 1 from public.contas_bancarias where tiny_id = (x ->> 'id')::bigint) then
      update public.contas_bancarias set tiny_id = (x ->> 'id')::bigint
      where id = (select id from public.contas_bancarias
                  where empresa_id = empresa and tiny_id is null and lower(trim(nome)) = lower(trim(x ->> 'descricao')) limit 1);
      if not found then
        insert into public.contas_bancarias (empresa_id, nome, tipo, ativa, tiny_id)
        values (empresa, left(trim(x ->> 'descricao'), 120),
          case when x ->> 'descricao' ilike '%caixa%' and x ->> 'descricao' not ilike '%econ%' then 'caixa' else 'corrente' end::public.tipo_conta_bancaria,
          coalesce((x ->> 'ativa')::boolean, true), (x ->> 'id')::bigint)
        on conflict (empresa_id, nome) do update set tiny_id = coalesce(public.contas_bancarias.tiny_id, excluded.tiny_id);
      end if;
    end if;
  end loop;

  -- Categorias: grupo do Tiny = categoria mãe; "NÃO USAR" entra inativa.
  for x in select * from jsonb_array_elements(coalesce(lote -> 'categorias', '[]')) loop
    if exists (select 1 from public.plano_contas where tiny_id = (x ->> 'id')::bigint) then
      continue;
    end if;
    update public.plano_contas c set tiny_id = (x ->> 'id')::bigint
    where c.id = (select c2.id from public.plano_contas c2
                  where c2.tiny_id is null and c2.tipo = (x ->> 'tipo')::public.tipo_plano_conta
                    and lower(trim(c2.nome)) = lower(trim(x ->> 'descricao'))
                    and not exists (select 1 from public.plano_contas f where f.pai_id = c2.id)
                  limit 1);
    if found then
      continue;
    end if;
    select id into grupo from public.plano_contas
    where pai_id is null and tipo = (x ->> 'tipo')::public.tipo_plano_conta and lower(trim(nome)) = lower(trim(x ->> 'grupo'));
    if grupo is null then
      insert into public.plano_contas (codigo, nome, tipo)
      values ((select (coalesce(max(codigo::integer), 0) + 1)::text from public.plano_contas where pai_id is null and codigo ~ '^\d+$'),
        trim(x ->> 'grupo'), (x ->> 'tipo')::public.tipo_plano_conta)
      returning id into grupo;
    end if;
    insert into public.plano_contas (codigo, nome, tipo, pai_id, ativa, tiny_id)
    select p.codigo || '.' || lpad((coalesce(max(split_part(f.codigo, '.', array_length(string_to_array(f.codigo, '.'), 1))::integer), 0) + 1)::text, 2, '0'),
      trim(x ->> 'descricao'), p.tipo, p.id, coalesce((x ->> 'ativa')::boolean, true), (x ->> 'id')::bigint
    from public.plano_contas p left join public.plano_contas f on f.pai_id = p.id
    where p.id = grupo
    group by p.id, p.codigo, p.tipo;
  end loop;

  -- Registros vistos nas listagens: pendente quando mudou desde a última leitura.
  insert into public.integracao_fila as f (integracao_id, tipo, id_externo, assinatura)
  select integracao, l ->> 'tipo', (l ->> 'id')::bigint, l ->> 'assinatura'
  from jsonb_array_elements(coalesce(lote -> 'listados', '[]')) l
  on conflict (integracao_id, tipo, id_externo) do update
    set visto_em = now(),
        pendente = f.pendente or excluded.assinatura is null or f.assinatura is distinct from excluded.assinatura,
        tentativas = case when f.assinatura is distinct from excluded.assinatura then 0 else f.tentativas end,
        erro = case when f.assinatura is distinct from excluded.assinatura then null else f.erro end,
        assinatura = excluded.assinatura,
        atualizado_em = case when f.assinatura is distinct from excluded.assinatura then now() else f.atualizado_em end;

  -- Fim de uma volta completa no contas a pagar: o que não apareceu é relido.
  if lote ? 'pagar_ciclo_inicio' then
    update public.integracao_fila set pendente = true, atualizado_em = now()
    where integracao_id = integracao and tipo = 'pagar' and erro is null
      and visto_em < (lote ->> 'pagar_ciclo_inicio')::timestamptz;
  end if;

  -- Pedidos de venda primeiro, para os títulos acharem o pedido (sem mexer no
  -- estoque: a saída é pela expedição).
  for t in select * from jsonb_array_elements(coalesce(lote -> 'pedidos', '[]')) loop
    pessoa := public.tiny_pessoa('clientes', t -> 'cliente');
    if pessoa is null then
      raise exception 'Pedido % do Tiny sem cliente', t ->> 'numero';
    end if;
    etapa := public.tiny_etapa((t ->> 'situacao')::integer);
    canal_ped := coalesce(nullif(t ->> 'canal', ''), 'venda_direta');
    num := coalesce(nullif(t ->> 'numero_loja', ''), t ->> 'numero');
    select p.id, e.ordem into atual from public.pedidos_venda p join public.etapas_pedido e on e.id = p.etapa_id
    where p.tiny_id = (t ->> 'id')::bigint;
    if atual.id is null then
      -- Venda da loja já importada pela ligação direta ou planilha: adota.
      select p.id, e.ordem into atual from public.pedidos_venda p join public.etapas_pedido e on e.id = p.etapa_id
      where p.tiny_id is null and p.canal = canal_ped and p.numero_externo = num;
    end if;
    if atual.id is null then
      insert into public.pedidos_venda (empresa_id, cliente_id, canal, numero_externo, data_pedido, prazo_entrega, condicao_pagamento,
        prazo_recebimento_dias, etapa_id, observacao, vendedor_id, vendedor_externo, nota_fiscal, tiny_id,
        valor_frete, valor_desconto, transportadora, dados_tiny)
      values (empresa, pessoa, canal_ped, num, (t ->> 'data')::date, (t ->> 'data_prevista')::date,
        nullif(t ->> 'condicao', ''), greatest(0, coalesce((t ->> 'prazo_dias')::integer, 0)), etapa, nullif(t ->> 'observacao', ''),
        null, nullif(t ->> 'vendedor', ''), nullif(ltrim(t ->> 'nota', '0'), ''), (t ->> 'id')::bigint,
        greatest(0, coalesce((t ->> 'frete')::numeric, 0)), greatest(0, coalesce((t ->> 'desconto')::numeric, 0)),
        nullif(t ->> 'transportadora', ''), t -> 'original')
      returning id into pedido;
    else
      pedido := atual.id;
      -- A etapa só avança pelo Tiny (o que a fábrica marcou aqui não volta), salvo cancelamento.
      update public.pedidos_venda p set
        tiny_id = (t ->> 'id')::bigint, cliente_id = pessoa, numero_externo = num, data_pedido = (t ->> 'data')::date,
        prazo_entrega = (t ->> 'data_prevista')::date, condicao_pagamento = nullif(t ->> 'condicao', ''),
        prazo_recebimento_dias = greatest(0, coalesce((t ->> 'prazo_dias')::integer, 0)),
        observacao = nullif(t ->> 'observacao', ''), vendedor_externo = nullif(t ->> 'vendedor', ''),
        nota_fiscal = nullif(ltrim(t ->> 'nota', '0'), ''),
        valor_frete = greatest(0, coalesce((t ->> 'frete')::numeric, 0)),
        valor_desconto = greatest(0, coalesce((t ->> 'desconto')::numeric, 0)),
        transportadora = nullif(t ->> 'transportadora', ''), dados_tiny = t -> 'original',
        etapa_id = case when (t ->> 'situacao')::integer = 2
                          or (select ordem from public.etapas_pedido where id = etapa) > atual.ordem
                        then etapa else p.etapa_id end
      where p.id = pedido;
    end if;
    -- Itens: refeitos a cada leitura, somando o mesmo produto em uma linha.
    delete from public.pedido_venda_itens where pedido_id = pedido;
    insert into public.pedido_venda_itens (pedido_id, item_id, quantidade, preco_unitario)
    select pedido, i.item, sum(i.quantidade), round(sum(i.quantidade * i.valor) / sum(i.quantidade), 4)
    from (
      select public.tiny_item(it) as item, (it ->> 'quantidade')::numeric as quantidade,
        greatest(0, coalesce((it ->> 'valor_unitario')::numeric, 0)) as valor
      from jsonb_array_elements(coalesce(t -> 'itens', '[]')) it
      where (it ->> 'quantidade')::numeric > 0
    ) i
    group by i.item;
    update public.integracao_fila set pendente = false, tentativas = 0, erro = null
    where integracao_id = integracao and tipo = 'pedido' and id_externo = (t ->> 'id')::bigint;
    r := jsonb_set(r, '{pedidos}', to_jsonb((r ->> 'pedidos')::integer + 1));
  end loop;

  -- Cadastro dos produtos.
  for t in select * from jsonb_array_elements(coalesce(lote -> 'produtos', '[]')) loop
    perform public.tiny_item(t);
    update public.integracao_fila set pendente = false, tentativas = 0, erro = null
    where integracao_id = integracao and tipo = 'produto' and id_externo = (t ->> 'produto_id')::bigint;
    r := jsonb_set(r, '{produtos}', to_jsonb(coalesce((r ->> 'produtos')::integer, 0) + 1));
  end loop;

  -- Contas a receber.
  for t in select * from jsonb_array_elements(coalesce(lote -> 'receber', '[]')) loop
    select id, situacao into atual from public.contas_receber where tiny_id = (t ->> 'id')::bigint;
    if (atual.id is null and ((t ->> 'situacao') = 'cancelado'
          or ((t ->> 'situacao') = 'pago' and (t ->> 'vencimento')::date < desde and (t ->> 'emissao')::date < desde)))
       or coalesce((t ->> 'valor')::numeric, 0) <= 0
       or (atual.situacao = 'pago' and (t ->> 'situacao') not in ('pago', 'cancelado')) then
      r := jsonb_set(r, '{pulados}', to_jsonb((r ->> 'pulados')::integer + 1));
      update public.integracao_fila set pendente = false, tentativas = 0, erro = null
      where integracao_id = integracao and tipo = 'receber' and id_externo = (t ->> 'id')::bigint;
      continue;
    end if;
    pessoa := public.tiny_pessoa('clientes', t -> 'contato');
    categoria := public.tiny_categoria((t ->> 'categoria_id')::bigint, t ->> 'categoria_nome', 'receita');
    sit := case t ->> 'situacao' when 'pago' then 'pago' when 'cancelado' then 'cancelado' else 'aberto' end;
    pago := nullif(coalesce((t ->> 'valor_pago')::numeric, 0), 0);
    quando := coalesce((t ->> 'liquidacao')::date, (t ->> 'vencimento')::date);
    obs := case when (t ->> 'situacao') = 'parcial'
      then 'Recebido em parte no Tiny: R$ ' || coalesce(pago, 0) || ' · saldo R$ ' || coalesce((t ->> 'saldo')::numeric, 0) end;
    if atual.id is null then
      -- Título igual já lançado aqui (mesmo cliente, valor e vencimento) é adotado.
      select id into atual from public.contas_receber
      where tiny_id is null and empresa_id = empresa and cliente_id is not distinct from pessoa
        and valor = (t ->> 'valor')::numeric and vencimento = (t ->> 'vencimento')::date and situacao <> 'cancelado'
      limit 1;
    end if;
    if atual.id is null then
      insert into public.contas_receber (empresa_id, cliente_id, canal, descricao, categoria_id, valor, vencimento, situacao,
        data_recebimento, valor_recebido, conta_bancaria_id, observacao, usuario_id, tiny_id)
      values (empresa, pessoa, 'venda_direta', t ->> 'descricao', categoria, (t ->> 'valor')::numeric, (t ->> 'vencimento')::date,
        sit,
        case when sit = 'pago' then quando end,
        case when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        case when sit = 'pago' then public.tiny_conta(empresa, (t ->> 'conta_id')::bigint) end,
        obs, null, (t ->> 'id')::bigint)
      returning id into atual;
    else
      update public.contas_receber set
        tiny_id = (t ->> 'id')::bigint, cliente_id = coalesce(pessoa, cliente_id), descricao = t ->> 'descricao',
        categoria_id = coalesce(categoria, categoria_id), valor = (t ->> 'valor')::numeric, vencimento = (t ->> 'vencimento')::date,
        situacao = sit,
        data_recebimento = case when sit = 'pago' then quando end,
        valor_recebido = case when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        conta_bancaria_id = case when sit = 'pago' then public.tiny_conta(empresa, (t ->> 'conta_id')::bigint) end,
        observacao = coalesce(obs, observacao)
      where id = atual.id;
    end if;
    -- Pedido do título: pela nota fiscal ou pelo número citado no histórico.
    num := substring(t ->> 'descricao' from '(?i)pedido\D{0,6}(\d+)');
    update public.contas_receber cr set pedido_id = p.id
    from public.pedidos_venda p
    where cr.id = atual.id and cr.pedido_id is null and p.empresa_id = empresa and p.tiny_id is not null
      and ((nullif(ltrim(t ->> 'documento', '0'), '') is not null and p.nota_fiscal = ltrim(t ->> 'documento', '0'))
           or (num is not null and p.numero_externo = num));
    update public.integracao_fila set pendente = false, tentativas = 0, erro = null
    where integracao_id = integracao and tipo = 'receber' and id_externo = (t ->> 'id')::bigint;
    r := jsonb_set(r, '{receber}', to_jsonb((r ->> 'receber')::integer + 1));
  end loop;

  -- Contas a pagar. Fica igual ao Tiny (aberto, pago, cancelado, com a data
  -- e a conta da baixa), salvo a baixa feita aqui por uma pessoa ou
  -- conciliada com o extrato: essa vale mais que o Tiny e não é desfeita.
  for t in select * from jsonb_array_elements(coalesce(lote -> 'pagar', '[]')) loop
    select id, situacao into atual from public.contas_pagar where tiny_id = (t ->> 'id')::bigint;
    if (atual.id is null and ((t ->> 'situacao') = 'cancelado'
          or ((t ->> 'situacao') = 'pago' and (t ->> 'vencimento')::date < desde and (t ->> 'emissao')::date < desde)))
       or coalesce((t ->> 'valor')::numeric, 0) <= 0 then
      r := jsonb_set(r, '{pulados}', to_jsonb((r ->> 'pulados')::integer + 1));
      update public.integracao_fila set pendente = false, tentativas = 0, erro = null
      where integracao_id = integracao and tipo = 'pagar' and id_externo = (t ->> 'id')::bigint;
      continue;
    end if;
    pessoa := public.tiny_pessoa('fornecedores', t -> 'contato');
    categoria := public.tiny_categoria((t ->> 'categoria_id')::bigint, t ->> 'categoria_nome', 'despesa');
    sit := case t ->> 'situacao' when 'pago' then 'pago' when 'cancelado' then 'cancelado' else 'aberto' end;
    pago := nullif(coalesce((t ->> 'valor_pago')::numeric, 0), 0);
    -- Conta da baixa no Tiny (null quando o Tiny não disse qual).
    banco := (select id from public.contas_bancarias where tiny_id = (t ->> 'conta_id')::bigint and empresa_id = empresa);
    obs := case when (t ->> 'situacao') = 'parcial'
      then 'Pago em parte no Tiny: R$ ' || coalesce(pago, 0) || ' · saldo R$ ' || coalesce((t ->> 'saldo')::numeric, 0) end;
    if atual.id is null then
      -- Título da nota já lançado aqui (mesmo fornecedor, valor e vencimento) é adotado.
      select id, situacao into atual from public.contas_pagar
      where tiny_id is null and empresa_id = empresa and fornecedor_id is not distinct from pessoa
        and valor = (t ->> 'valor')::numeric and vencimento = (t ->> 'vencimento')::date and situacao <> 'cancelado'
      limit 1;
    end if;
    fixo := atual.id is not null and atual.situacao = 'pago' and public.pagar_baixado_aqui(atual.id);
    if atual.id is null then
      insert into public.contas_pagar (empresa_id, fornecedor_id, descricao, categoria_id, valor, vencimento, situacao,
        data_pagamento, valor_pago, conta_bancaria_id, observacao, usuario_id, tiny_id)
      values (empresa, pessoa, t ->> 'descricao', categoria, (t ->> 'valor')::numeric, (t ->> 'vencimento')::date, sit,
        case when sit = 'pago' then coalesce((t ->> 'liquidacao')::date, (t ->> 'vencimento')::date) end,
        case when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        case when sit = 'pago' then coalesce(banco, public.tiny_conta(empresa, null)) end,
        obs, null, (t ->> 'id')::bigint);
    else
      -- Sem a data ou a conta da baixa no Tiny, fica a que já estava aqui.
      update public.contas_pagar p set
        tiny_id = (t ->> 'id')::bigint, fornecedor_id = coalesce(pessoa, p.fornecedor_id), descricao = t ->> 'descricao',
        categoria_id = coalesce(categoria, p.categoria_id), valor = (t ->> 'valor')::numeric, vencimento = (t ->> 'vencimento')::date,
        situacao = case when fixo then p.situacao else sit end,
        data_pagamento = case when fixo then p.data_pagamento when sit = 'pago' then
          coalesce((t ->> 'liquidacao')::date, case when p.situacao = 'pago' then p.data_pagamento end, (t ->> 'vencimento')::date) end,
        valor_pago = case when fixo then p.valor_pago when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        conta_bancaria_id = case when fixo then p.conta_bancaria_id when sit = 'pago' then
          coalesce(banco, case when p.situacao = 'pago' then p.conta_bancaria_id end, public.tiny_conta(empresa, null)) end,
        observacao = coalesce(obs, p.observacao)
      where p.id = atual.id;
    end if;
    update public.integracao_fila set pendente = false, tentativas = 0, erro = null
    where integracao_id = integracao and tipo = 'pagar' and id_externo = (t ->> 'id')::bigint;
    r := jsonb_set(r, '{pagar}', to_jsonb((r ->> 'pagar')::integer + 1));
  end loop;

  -- Leituras que falharam: tenta de novo até 5 vezes.
  update public.integracao_fila f set tentativas = f.tentativas + 1, erro = x2 ->> 'erro', pendente = f.tentativas + 1 < 5
  from jsonb_array_elements(coalesce(lote -> 'falhas', '[]')) x2
  where f.integracao_id = integracao and f.tipo = x2 ->> 'tipo' and f.id_externo = (x2 ->> 'id')::bigint;

  -- Apagados no Tiny: o título em aberto é cancelado aqui.
  for x in select * from jsonb_array_elements(coalesce(lote -> 'removidos', '[]')) loop
    update public.integracao_fila set pendente = false, erro = 'Não existe mais no Tiny'
    where integracao_id = integracao and tipo = x ->> 'tipo' and id_externo = (x ->> 'id')::bigint;
    if x ->> 'tipo' = 'receber' then
      update public.contas_receber set situacao = 'cancelado', observacao = 'Apagado no Tiny'
      where tiny_id = (x ->> 'id')::bigint and situacao = 'aberto';
    elsif x ->> 'tipo' = 'pagar' then
      update public.contas_pagar set situacao = 'cancelado', observacao = 'Apagado no Tiny'
      where tiny_id = (x ->> 'id')::bigint and situacao = 'aberto';
    end if;
  end loop;

  perform set_config('venner.leitura_tiny', '', true);
  return r;
end;
$$;

-- Planilha de contas a pagar do Tiny: cada linha é ligada a um título que
-- veio do Tiny (mesmo fornecedor, vencimento e valor) e a situação, a data do
-- pagamento, o valor pago e a conta ficam como na planilha. Com aplicar =
-- false só devolve o que mudaria.
create function public.tiny_aplicar_planilha_pagar(empresa uuid, linhas jsonb, aplicar boolean default false)
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
  vpago numeric;
  obs text;
  conta_nome text;
  rotulo text;
  iguais integer := 0;
  corrigidos integer := 0;
  corrigir jsonb := '[]';
  mantidos jsonb := '[]';
  nao_achados jsonb := '[]';
begin
  if empresa is null or not public.tem_permissao('financeiro.pagar', 'editar') or not public.pode_ver_empresa(empresa) then
    raise exception 'Sem permissão para corrigir as contas a pagar desta empresa';
  end if;
  if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 20000 then
    raise exception 'Planilha inválida';
  end if;

  for l in select * from jsonb_array_elements(linhas) loop
    sit := case l ->> 'situacao' when 'pago' then 'pago' when 'cancelado' then 'cancelado' else 'aberto' end;
    rotulo := coalesce(l ->> 'fornecedor', '') || ' · venc. ' || to_char((l ->> 'vencimento')::date, 'DD/MM/YYYY')
      || ' · R$ ' || replace(((l ->> 'valor')::numeric)::numeric(14, 2)::text, '.', ',');
    select p.id, p.situacao, p.vencimento, p.valor, p.data_pagamento, p.valor_pago, p.conta_bancaria_id, b.nome as banco_nome
    into alvo
    from public.contas_pagar p
    left join public.fornecedores f on f.id = p.fornecedor_id
    left join public.contas_bancarias b on b.id = p.conta_bancaria_id
    where p.empresa_id = empresa and p.tiny_id is not null and p.id <> all(usados)
      and p.vencimento = (l ->> 'vencimento')::date and p.valor = (l ->> 'valor')::numeric
      and public.texto_comparavel(l ->> 'fornecedor') in (public.texto_comparavel(f.nome), public.texto_comparavel(f.nome_fantasia))
    order by (p.situacao = sit) desc,
      (nullif(l ->> 'documento', '') is not null and p.descricao ilike '%' || (l ->> 'documento') || '%') desc,
      p.criado_em
    limit 1;
    if alvo.id is null then
      if jsonb_array_length(nao_achados) < 300 then
        nao_achados := nao_achados || jsonb_build_array(rotulo);
      end if;
      continue;
    end if;
    usados := usados || alvo.id;

    banco := null;
    quando := null;
    vpago := null;
    conta_nome := null;
    obs := case when l ->> 'situacao' = 'parcial'
      then 'Pago em parte no Tiny: R$ ' || coalesce((l ->> 'valor_pago')::numeric, 0) end;
    if sit = 'pago' then
      select id, nome into banco, conta_nome from public.contas_bancarias
      where empresa_id = empresa and public.texto_comparavel(nome) = public.texto_comparavel(l ->> 'conta')
      order by ativa desc limit 1;
      if banco is null then
        banco := coalesce(case when alvo.situacao = 'pago' then alvo.conta_bancaria_id end, public.tiny_conta(empresa, null));
        conta_nome := coalesce(case when alvo.situacao = 'pago' then alvo.banco_nome end, 'Tiny · conta não informada');
      end if;
      quando := coalesce((l ->> 'pagamento')::date, case when alvo.situacao = 'pago' then alvo.data_pagamento end, alvo.vencimento);
      vpago := coalesce(nullif((l ->> 'valor_pago')::numeric, 0), alvo.valor);
    end if;

    if alvo.situacao = sit and alvo.data_pagamento is not distinct from quando
       and alvo.valor_pago is not distinct from vpago and alvo.conta_bancaria_id is not distinct from banco then
      iguais := iguais + 1;
      continue;
    end if;
    if alvo.situacao = 'pago' and public.pagar_baixado_aqui(alvo.id) then
      if jsonb_array_length(mantidos) < 300 then
        mantidos := mantidos || jsonb_build_array(rotulo);
      end if;
      continue;
    end if;

    corrigidos := corrigidos + 1;
    if jsonb_array_length(corrigir) < 2000 then
      corrigir := corrigir || jsonb_build_array(jsonb_build_object(
        'titulo', rotulo,
        'de', case alvo.situacao when 'pago' then 'Pago em ' || to_char(alvo.data_pagamento, 'DD/MM/YYYY') || coalesce(' · ' || alvo.banco_nome, '')
                when 'cancelado' then 'Cancelado' else 'Em aberto' end,
        'para', case sit when 'pago' then 'Pago em ' || to_char(quando, 'DD/MM/YYYY') || coalesce(' · ' || conta_nome, '')
                when 'cancelado' then 'Cancelado' else 'Em aberto' end
          || case when vpago is not null and vpago <> alvo.valor then ' · pago R$ ' || replace(vpago::numeric(14, 2)::text, '.', ',') else '' end));
    end if;
    if aplicar then
      update public.contas_pagar set situacao = sit, data_pagamento = quando, valor_pago = vpago, conta_bancaria_id = banco,
        observacao = coalesce(obs, observacao)
      where id = alvo.id;
    end if;
  end loop;

  return jsonb_build_object(
    'linhas', jsonb_array_length(linhas),
    'iguais', iguais,
    'corrigidos', corrigidos,
    'aplicado', aplicar,
    'corrigir', corrigir,
    'mantidos', mantidos,
    'nao_achados', nao_achados);
end;
$$;
revoke execute on function public.tiny_aplicar_planilha_pagar(uuid, jsonb, boolean) from public, anon;
grant execute on function public.tiny_aplicar_planilha_pagar(uuid, jsonb, boolean) to authenticated;

-- Relê todos os títulos a pagar do Tiny com a regra nova (o robô faz aos
-- poucos, a cada 5 minutos, dentro do limite de leituras do Tiny).
update public.integracao_fila set pendente = true, tentativas = 0, erro = null, atualizado_em = now()
where tipo = 'pagar' and erro is distinct from 'Não existe mais no Tiny';
