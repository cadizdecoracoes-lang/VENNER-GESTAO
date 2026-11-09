-- =============================================================================
-- Venner Gestão · Tiny → Venner sem perder o que foi mudado aqui
--
-- Pedido do Alexandre (09/11/2026): o que muda no Tiny (Olist) vem para a
-- Venner; o que muda na Venner nunca vai para o Tiny (a leitura continua só
-- leitura). E o Tiny não pode desfazer o que já foi mudado aqui: título novo,
-- vencimento, pagamento, valores.
--
-- - A leitura das contas a pagar tinha data para parar (02/11/2026, carga
--   inicial) e parou: por isso a mudança de vencimento da Cristiane
--   (R$ 3.532,79) não chegou. Agora lê sempre; a data na tela de
--   Integrações passa a ser só para parar de ler, se um dia for preciso.
-- - editado_aqui (contas a pagar e a receber): os campos mudados aqui por uma
--   pessoa ou rotina da Venner. A leitura do Tiny não mexe neles; a baixa
--   (situação, data, valor pago e conta) é mantida inteira. Nas contas a
--   pagar, o que já foi mudado aqui antes deste pacote vem do histórico.
-- - Título novo do Tiny parecido com um lançado aqui (mesmo fornecedor ou
--   cliente e valor, outro vencimento) entra com o aviso "Conferir: parecido
--   com título lançado aqui" na observação, para ninguém pagar duas vezes.
-- - O resumo de cada leitura conta em "mantidos" os títulos em que algo
--   ficou como estava aqui.
-- =============================================================================

alter table public.contas_pagar add column editado_aqui text[] not null default '{}';
alter table public.contas_receber add column editado_aqui text[] not null default '{}';

-- Marca os campos mudados fora da leitura do Tiny (a leitura e a planilha do
-- Tiny são reconhecidas pelo aviso venner.leitura_tiny ou pela pilha).
create function public.marcar_editado_aqui()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pilha text;
  campo text;
  antes jsonb := to_jsonb(old);
  depois jsonb := to_jsonb(new);
begin
  get diagnostics pilha = pg_context;
  if coalesce(current_setting('venner.leitura_tiny', true), '') = 'sim' or pilha like '%tiny_aplicar%' then
    return new;
  end if;
  foreach campo in array array['fornecedor_id', 'cliente_id', 'descricao', 'categoria_id', 'valor', 'vencimento', 'situacao',
    'data_pagamento', 'valor_pago', 'data_recebimento', 'valor_recebido', 'conta_bancaria_id', 'observacao'] loop
    if depois ? campo and antes -> campo is distinct from depois -> campo and not campo = any(new.editado_aqui) then
      new.editado_aqui := new.editado_aqui || campo;
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.marcar_editado_aqui() from public, anon, authenticated;

create trigger marcar_editado_aqui before update on public.contas_pagar
  for each row execute function public.marcar_editado_aqui();
create trigger marcar_editado_aqui before update on public.contas_receber
  for each row execute function public.marcar_editado_aqui();

-- Contas a pagar já mudadas aqui: o último registro de cada campo no
-- histórico que não veio do Tiny.
update public.contas_pagar p set editado_aqui = x.campos
from (
  select u.conta_id, array_agg(u.campo order by u.campo) as campos
  from (
    select distinct on (h.conta_id, m.rotulo) h.conta_id, m.rotulo, h.origem,
      case m.rotulo
        when 'Fornecedor' then 'fornecedor_id' when 'Descrição' then 'descricao' when 'Categoria' then 'categoria_id'
        when 'Valor' then 'valor' when 'Vencimento' then 'vencimento' when 'Situação' then 'situacao'
        when 'Data do pagamento' then 'data_pagamento' when 'Valor pago' then 'valor_pago'
        when 'Conta bancária' then 'conta_bancaria_id' when 'Observação' then 'observacao'
      end as campo
    from public.contas_pagar_historico h
    cross join lateral jsonb_object_keys(h.mudancas) m(rotulo)
    where h.evento = 'alterada'
    order by h.conta_id, m.rotulo, h.quando desc, h.id desc
  ) u
  where u.origem <> 'tiny' and u.campo is not null
  group by u.conta_id
) x
where x.conta_id = p.id;
-- Baixa conciliada com o extrato também é daqui.
update public.contas_pagar p set editado_aqui = array(select distinct unnest(p.editado_aqui || array['situacao', 'data_pagamento', 'valor_pago', 'conta_bancaria_id']))
where exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = p.id);

update public.contas_receber r set editado_aqui = array['situacao', 'data_recebimento', 'valor_recebido', 'conta_bancaria_id']
where exists (select 1 from public.extrato_conciliacoes c where c.conta_receber_id = r.id);

-- Leitura das contas a pagar sem data para parar (vazio = lê sempre).
alter table public.integracao_robo alter column ler_pagar_ate drop default;
update public.integracao_robo set ler_pagar_ate = null;

create or replace function public.robo_tiny_inicio(integracao uuid, chave_robo text, limite integer default 40)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resposta jsonb;
begin
  perform public.robo_tiny_conferir(integracao, chave_robo);
  update public.integracao_robo set executando_ate = now() + interval '3 minutes', executado_em = now()
  where integracao_id = integracao and (executando_ate is null or executando_ate < now());
  if not found then
    raise exception 'Uma leitura do Tiny já está em andamento';
  end if;
  select jsonb_build_object(
    'empresa_id', i.empresa_id,
    'access_token', i.access_token,
    'refresh_token', i.refresh_token,
    'expira_em', i.expira_em,
    'client_id', a.client_id,
    'client_secret', a.client_secret,
    'ler_pagar', (r.ler_pagar_ate is null or current_date <= r.ler_pagar_ate),
    'estado', r.estado,
    'pendentes', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', f.tipo, 'id', f.id_externo))
      from (select f2.tipo, f2.id_externo from public.integracao_fila f2
            where f2.integracao_id = integracao and f2.pendente and ((r.ler_pagar_ate is null or current_date <= r.ler_pagar_ate) or f2.tipo <> 'pagar')
            order by case f2.tipo when 'receber' then 1 when 'pedido' then 2 when 'produto' then 3 else 4 end, f2.atualizado_em
            limit greatest(1, least(limite, 200))) f), '[]'))
  into resposta
  from public.integracoes_plataforma i
  join public.integracao_robo r on r.integracao_id = i.id
  left join public.integracoes_aplicativos a on a.canal = 'tiny' and a.empresa_id = i.empresa_id
  where i.id = integracao;
  return resposta;
end;
$$;


-- Leitura do Tiny: a mesma de antes, respeitando editado_aqui.
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
  ed text[];
  parecido date;
  obs text;
  num text;
  canal_ped text;
  r jsonb := '{"receber": 0, "pagar": 0, "pedidos": 0, "pulados": 0, "mantidos": 0}';
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
    select id, situacao, editado_aqui into atual from public.contas_receber where tiny_id = (t ->> 'id')::bigint;
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
      select id, situacao, editado_aqui into atual from public.contas_receber
      where tiny_id is null and empresa_id = empresa and cliente_id is not distinct from pessoa
        and valor = (t ->> 'valor')::numeric and vencimento = (t ->> 'vencimento')::date and situacao <> 'cancelado'
      limit 1;
    end if;
    if atual.id is null then
      -- Parecido com um título lançado aqui (mesmo cliente e valor, outro
      -- vencimento): entra, mas com aviso para conferir se não é repetido.
      select min(vencimento) into parecido from public.contas_receber
      where tiny_id is null and empresa_id = empresa and cliente_id is not distinct from pessoa
        and valor = (t ->> 'valor')::numeric and situacao <> 'cancelado';
      if parecido is not null then
        obs := concat_ws(' · ', obs, 'Conferir: parecido com título lançado aqui (venc. ' || to_char(parecido, 'DD/MM/YYYY') || ')');
      end if;
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
      -- O que foi mudado aqui (editado_aqui) fica como está; a baixa
      -- (situação, data, valor e conta) é mantida inteira.
      ed := coalesce(atual.editado_aqui, '{}');
      fixo := ed && array['situacao', 'data_recebimento', 'valor_recebido', 'conta_bancaria_id'];
      if ed <> '{}' then
        r := jsonb_set(r, '{mantidos}', to_jsonb((r ->> 'mantidos')::integer + 1));
      end if;
      update public.contas_receber c set
        tiny_id = (t ->> 'id')::bigint,
        cliente_id = case when 'cliente_id' = any(ed) then c.cliente_id else coalesce(pessoa, c.cliente_id) end,
        descricao = case when 'descricao' = any(ed) then c.descricao else t ->> 'descricao' end,
        categoria_id = case when 'categoria_id' = any(ed) then c.categoria_id else coalesce(categoria, c.categoria_id) end,
        valor = case when 'valor' = any(ed) then c.valor else (t ->> 'valor')::numeric end,
        vencimento = case when 'vencimento' = any(ed) then c.vencimento else (t ->> 'vencimento')::date end,
        situacao = case when fixo then c.situacao else sit end,
        data_recebimento = case when fixo then c.data_recebimento when sit = 'pago' then quando end,
        valor_recebido = case when fixo then c.valor_recebido when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        conta_bancaria_id = case when fixo then c.conta_bancaria_id when sit = 'pago' then public.tiny_conta(empresa, (t ->> 'conta_id')::bigint) end,
        observacao = case when 'observacao' = any(ed) then c.observacao else coalesce(obs, c.observacao) end
      where c.id = atual.id;
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
    select id, situacao, editado_aqui into atual from public.contas_pagar where tiny_id = (t ->> 'id')::bigint;
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
      select id, situacao, editado_aqui into atual from public.contas_pagar
      where tiny_id is null and empresa_id = empresa and fornecedor_id is not distinct from pessoa
        and valor = (t ->> 'valor')::numeric and vencimento = (t ->> 'vencimento')::date and situacao <> 'cancelado'
      limit 1;
    end if;
    ed := coalesce(atual.editado_aqui, '{}');
    fixo := atual.id is not null and ((atual.situacao = 'pago' and public.pagar_baixado_aqui(atual.id))
      or ed && array['situacao', 'data_pagamento', 'valor_pago', 'conta_bancaria_id']);
    if atual.id is null then
      select min(vencimento) into parecido from public.contas_pagar
      where tiny_id is null and empresa_id = empresa and fornecedor_id is not distinct from pessoa
        and valor = (t ->> 'valor')::numeric and situacao <> 'cancelado';
      if parecido is not null then
        obs := concat_ws(' · ', obs, 'Conferir: parecido com título lançado aqui (venc. ' || to_char(parecido, 'DD/MM/YYYY') || ')');
      end if;
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
        tiny_id = (t ->> 'id')::bigint,
        fornecedor_id = case when 'fornecedor_id' = any(ed) then p.fornecedor_id else coalesce(pessoa, p.fornecedor_id) end,
        descricao = case when 'descricao' = any(ed) then p.descricao else t ->> 'descricao' end,
        categoria_id = case when 'categoria_id' = any(ed) then p.categoria_id else coalesce(categoria, p.categoria_id) end,
        valor = case when 'valor' = any(ed) then p.valor else (t ->> 'valor')::numeric end,
        vencimento = case when 'vencimento' = any(ed) then p.vencimento else (t ->> 'vencimento')::date end,
        situacao = case when fixo then p.situacao else sit end,
        data_pagamento = case when fixo then p.data_pagamento when sit = 'pago' then
          coalesce((t ->> 'liquidacao')::date, case when p.situacao = 'pago' then p.data_pagamento end, (t ->> 'vencimento')::date) end,
        valor_pago = case when fixo then p.valor_pago when sit = 'pago' then coalesce(pago, (t ->> 'valor')::numeric) end,
        conta_bancaria_id = case when fixo then p.conta_bancaria_id when sit = 'pago' then
          coalesce(banco, case when p.situacao = 'pago' then p.conta_bancaria_id end, public.tiny_conta(empresa, null)) end,
        observacao = case when 'observacao' = any(ed) then p.observacao else coalesce(obs, p.observacao) end
      where p.id = atual.id;
      if ed <> '{}' then
        r := jsonb_set(r, '{mantidos}', to_jsonb((r ->> 'mantidos')::integer + 1));
      end if;
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
