-- =============================================================================
-- Venner Gestão · Título excluído ou cancelado na Venner não volta pelo Tiny
--
-- Pergunta do Alexandre (09/11/2026): títulos excluídos só na Venner (no Tiny
-- continuam) voltam com a leitura do Tiny? Regra: não voltam.
--
-- - tiny_excluidos: o número do Tiny de cada título apagado aqui (contas a
--   pagar e a receber). A leitura do Tiny pula esses números e não recria.
-- - Títulos já excluídos antes: os que a leitura gravou e sumiram daqui.
-- - Cancelado aqui fica cancelado (editado_aqui, do pacote anterior). Para os
--   cancelados antes dele: contas a receber canceladas e contas a pagar
--   canceladas sem ter sido o Tiny a cancelar ficam marcadas agora.
-- =============================================================================

create table public.tiny_excluidos (
  tipo text not null check (tipo in ('pagar', 'receber')),
  tiny_id bigint not null,
  empresa_id uuid not null references public.empresas(id),
  descricao text,
  excluido_em timestamptz not null default now(),
  usuario_id uuid default auth.uid() references public.usuarios(id) on delete set null,
  primary key (tipo, tiny_id)
);
alter table public.tiny_excluidos enable row level security;
create policy ver on public.tiny_excluidos for select to authenticated
  using (public.tem_permissao(case tipo when 'pagar' then 'financeiro.pagar' else 'financeiro.receber' end, 'ver')
         and public.pode_ver_empresa(empresa_id));
revoke all on public.tiny_excluidos from public, anon, authenticated;
grant select on public.tiny_excluidos to authenticated;

-- Quem grava é o gatilho, ao apagar um título que veio do Tiny.
create function public.guardar_excluido_tiny()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.tiny_id is not null then
    insert into public.tiny_excluidos (tipo, tiny_id, empresa_id, descricao)
    values (tg_argv[0], old.tiny_id, old.empresa_id, old.descricao)
    on conflict do nothing;
  end if;
  return old;
end;
$$;
revoke execute on function public.guardar_excluido_tiny() from public, anon, authenticated;

create trigger guardar_excluido_tiny after delete on public.contas_pagar
  for each row execute function public.guardar_excluido_tiny('pagar');
create trigger guardar_excluido_tiny after delete on public.contas_receber
  for each row execute function public.guardar_excluido_tiny('receber');

-- Já excluídos antes deste pacote: títulos que a leitura gravou (na fila, sem
-- pendência nem erro) e que não existem mais aqui. Ficam de fora os que a
-- leitura pula de propósito: cancelados no Tiny, valor zero e pagos de antes
-- de 2026.
insert into public.tiny_excluidos (tipo, tiny_id, empresa_id, descricao, excluido_em, usuario_id)
select f.tipo, f.id_externo, i.empresa_id, 'Excluído antes do registro de exclusões', f.atualizado_em, null
from public.integracao_fila f
join public.integracoes_plataforma i on i.id = f.integracao_id
where f.tipo in ('pagar', 'receber') and not f.pendente and f.erro is null
  and split_part(f.assinatura, '|', 1) not ilike 'cancel%'
  and split_part(f.assinatura, '|', 2) ~ '^\d+(\.\d+)?$' and split_part(f.assinatura, '|', 2)::numeric > 0
  and split_part(f.assinatura, '|', 4) ~ '^\d{4}-\d{2}-\d{2}' and left(split_part(f.assinatura, '|', 4), 10) >= '2026-01-01'
  and not exists (select 1 from public.contas_pagar p where f.tipo = 'pagar' and p.tiny_id = f.id_externo)
  and not exists (select 1 from public.contas_receber r where f.tipo = 'receber' and r.tiny_id = f.id_externo)
on conflict do nothing;

-- Cancelados antes do pacote anterior.
update public.contas_receber
set editado_aqui = array(select distinct unnest(editado_aqui || array['situacao', 'data_recebimento', 'valor_recebido', 'conta_bancaria_id']))
where tiny_id is not null and situacao = 'cancelado' and not 'situacao' = any(editado_aqui);

update public.contas_pagar p
set editado_aqui = array(select distinct unnest(p.editado_aqui || array['situacao', 'data_pagamento', 'valor_pago', 'conta_bancaria_id']))
where p.tiny_id is not null and p.situacao = 'cancelado' and not 'situacao' = any(p.editado_aqui)
  and p.observacao is distinct from 'Apagado no Tiny'
  and not exists (select 1 from public.contas_pagar_historico h
                  where h.conta_id = p.id and h.origem = 'tiny' and h.mudancas -> 'Situação' ->> 1 = 'Cancelado');

-- Leitura do Tiny: a mesma do pacote anterior, pulando os excluídos aqui.
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
    -- Excluído aqui: não volta.
    if exists (select 1 from public.tiny_excluidos e where e.tipo = 'receber' and e.tiny_id = (t ->> 'id')::bigint) then
      r := jsonb_set(r, '{pulados}', to_jsonb((r ->> 'pulados')::integer + 1));
      update public.integracao_fila set pendente = false, tentativas = 0, erro = null
      where integracao_id = integracao and tipo = 'receber' and id_externo = (t ->> 'id')::bigint;
      continue;
    end if;
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
    -- Excluído aqui: não volta.
    if exists (select 1 from public.tiny_excluidos e where e.tipo = 'pagar' and e.tiny_id = (t ->> 'id')::bigint) then
      r := jsonb_set(r, '{pulados}', to_jsonb((r ->> 'pulados')::integer + 1));
      update public.integracao_fila set pendente = false, tentativas = 0, erro = null
      where integracao_id = integracao and tipo = 'pagar' and id_externo = (t ->> 'id')::bigint;
      continue;
    end if;
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
