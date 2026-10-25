-- =============================================================================
-- Matéria-prima certa na estrutura e nas sugestões de compra.
--
-- Os produtos vendidos chegavam do Tiny sem ficha técnica e, por isso, o
-- cálculo de materiais tratava o próprio produto (o kit) como item a comprar.
--
-- - A leitura do Tiny passa a trazer a estrutura do produto (kit ou produção
--   do produto fabricado) e cria a ficha técnica sozinha, já ativa, marcada
--   como "do Tiny" (fichas_tecnicas.origem). Quando a estrutura muda no Tiny,
--   entra uma nova versão. Ficha feita ou editada aqui não é tocada: mandou
--   a versão daqui, o Tiny para de mexer naquele produto.
-- - Os componentes que ainda não existem aqui nascem como matéria-prima; os
--   que estavam como produto acabado e não têm ficha própria viram
--   matéria-prima. O tipo do cadastro segue o Tiny: M = matéria-prima,
--   K (kit) e F (fabricado) = produto acabado.
-- - Todos os produtos já lidos voltam para a fila, para buscar a estrutura.
-- =============================================================================

alter table public.fichas_tecnicas
  add column origem text not null default 'manual' check (origem in ('manual', 'tiny'));

-- Igual à anterior; a leitura do Tiny (aviso venner.leitura_tiny, só dentro de
-- tiny_aplicar) ativa a ficha que veio de lá sem a permissão "aprovar".
create or replace function public.validar_ficha()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'rascunho' then
      raise exception 'Toda ficha técnica nasce como rascunho';
    end if;
    return new;
  end if;

  if new.item_id <> old.item_id or new.versao <> old.versao then
    raise exception 'Produto e versão da ficha técnica não podem ser trocados';
  end if;

  if old.status <> 'rascunho'
     and (new.quantidade_base, new.observacao, new.origem) is distinct from (old.quantidade_base, old.observacao, old.origem) then
    raise exception 'Só o rascunho da ficha técnica pode ser alterado. Crie uma nova versão.';
  end if;

  if new.status <> old.status then
    if not ((old.status = 'rascunho' and new.status = 'ativa') or (old.status = 'ativa' and new.status = 'substituida')) then
      raise exception 'Mudança de status inválida na ficha técnica';
    end if;
    if not public.tem_permissao('producao.ficha_tecnica', 'aprovar')
       and coalesce(current_setting('venner.leitura_tiny', true), '') <> 'sim' then
      raise exception 'Seu perfil não pode aprovar fichas técnicas';
    end if;
  end if;
  return new;
end;
$$;

-- Estrutura do produto no Tiny → ficha técnica ativa daqui.
create function public.tiny_estrutura(produto uuid, estrutura jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  comps jsonb;
  ativa public.fichas_tecnicas;
  nova uuid;
begin
  -- Componentes pelo número no Tiny (cria o cadastro que faltar), somando repetidos.
  select coalesce(jsonb_object_agg(c.item, c.qtd), '{}') into comps
  from (
    select x.item, sum(x.qtd) as qtd
    from (
      select public.tiny_item(jsonb_build_object(
          'produto_id', e -> 'produto_id', 'sku', e ->> 'sku', 'descricao', e ->> 'descricao', 'tipo_item', 'materia_prima')) as item,
        (e ->> 'quantidade')::numeric as qtd
      from jsonb_array_elements(estrutura) e
      where (e ->> 'quantidade')::numeric > 0 and e ->> 'produto_id' is not null
    ) x
    where x.item <> produto
    group by x.item
  ) c;
  if comps = '{}' then
    return;
  end if;

  -- Ficha daqui (ou um rascunho aberto) manda.
  select * into ativa from public.fichas_tecnicas where item_id = produto and status = 'ativa';
  if (ativa.id is not null and ativa.origem <> 'tiny')
     or exists (select 1 from public.fichas_tecnicas where item_id = produto and status = 'rascunho') then
    return;
  end if;
  -- Mesma estrutura: nada a fazer.
  if ativa.id is not null and ativa.quantidade_base = 1
     and comps = (select jsonb_object_agg(c.componente_id, c.quantidade) from public.ficha_componentes c
                  where c.ficha_id = ativa.id and c.perda_percentual = 0)
     and (select count(*) from public.ficha_componentes c where c.ficha_id = ativa.id) = (select count(*) from jsonb_object_keys(comps)) then
    return;
  end if;

  -- Estrutura circular (ou outro erro do cadastro) não pode parar a leitura.
  begin
    insert into public.fichas_tecnicas (item_id, versao, quantidade_base, observacao, origem)
    values (produto, coalesce((select max(versao) from public.fichas_tecnicas where item_id = produto), 0) + 1, 1,
            'Estrutura importada do Tiny', 'tiny')
    returning id into nova;
    insert into public.ficha_componentes (ficha_id, componente_id, quantidade)
    select nova, c.key::uuid, c.value::numeric from jsonb_each_text(comps) c;
    if ativa.id is not null then
      insert into public.ficha_operacoes (ficha_id, sequencia, descricao, posto_id, tempo_setup_min, tempo_execucao_min, instrucoes)
      select nova, o.sequencia, o.descricao, o.posto_id, o.tempo_setup_min, o.tempo_execucao_min, o.instrucoes
      from public.ficha_operacoes o where o.ficha_id = ativa.id;
      update public.fichas_tecnicas set status = 'substituida' where id = ativa.id;
    end if;
    update public.fichas_tecnicas set status = 'ativa', vigencia_inicio = current_date where id = nova;
  exception when others then
    raise notice 'Estrutura do Tiny não importada (%): %', produto, sqlerrm;
    return;
  end;

  -- Componente que estava como produto acabado e não tem ficha própria é matéria-prima.
  update public.itens i set tipo = 'materia_prima'
  where i.id in (select k::uuid from jsonb_object_keys(comps) k)
    and i.tipo = 'produto_acabado'
    and not exists (select 1 from public.fichas_tecnicas f where f.item_id = i.id and f.status in ('ativa', 'rascunho'));
end;
$$;
revoke execute on function public.tiny_estrutura(uuid, jsonb) from public, anon, authenticated;

-- Igual à anterior, mais o tipo do Tiny e a estrutura (kit ou fabricado).
create or replace function public.tiny_item(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  achado uuid;
  cod text := coalesce(nullif(trim(p ->> 'sku'), ''), 'TINY-' || (p ->> 'produto_id'));
  un text := upper(nullif(trim(p ->> 'unidade'), ''));
begin
  if p ->> 'produto_id' is not null then
    select id into achado from public.itens where tiny_id = (p ->> 'produto_id')::bigint;
  end if;
  if achado is null then
    select id into achado from public.itens i where i.codigo = cod;
    if achado is not null and p ->> 'produto_id' is not null then
      update public.itens set tiny_id = (p ->> 'produto_id')::bigint where id = achado and tiny_id is null;
    end if;
  end if;
  if achado is null then
    if un is not null then
      insert into public.unidades (sigla, descricao) values (un, un) on conflict do nothing;
    end if;
    insert into public.itens (codigo, descricao, tipo, unidade, tiny_id)
    values (cod, coalesce(nullif(trim(p ->> 'descricao'), ''), cod),
      coalesce(nullif(p ->> 'tipo_item', ''), case when (p ->> 'servico')::boolean then 'servico' else 'produto_acabado' end)::public.tipo_item,
      coalesce(un, 'UN'), (p ->> 'produto_id')::bigint)
    returning id into achado;
  end if;
  -- Dados do cadastro do produto no Tiny: só completa o que está vazio aqui.
  update public.itens set
    preco_venda = case when preco_venda = 0 then greatest(0, coalesce((p ->> 'preco')::numeric, 0)) else preco_venda end,
    ncm = coalesce(ncm, case when regexp_replace(coalesce(p ->> 'ncm', ''), '\D', '', 'g') ~ '^\d{8}$'
                             then regexp_replace(p ->> 'ncm', '\D', '', 'g') end),
    peso_kg = coalesce(peso_kg, nullif((p ->> 'peso')::numeric, 0))
  where id = achado;
  -- Tipo segue o Tiny (só entre produto acabado e matéria-prima; subconjunto,
  -- embalagem e serviço marcados aqui ficam).
  if p ->> 'tipo_tiny' = 'M' then
    update public.itens set tipo = 'materia_prima' where id = achado and tipo = 'produto_acabado';
  elsif p ->> 'tipo_tiny' in ('K', 'F') then
    update public.itens set tipo = 'produto_acabado' where id = achado and tipo = 'materia_prima';
  end if;
  if p ->> 'tipo_tiny' in ('K', 'F') and jsonb_typeof(p -> 'estrutura') = 'array' then
    perform public.tiny_estrutura(achado, p -> 'estrutura');
  end if;
  return achado;
end;
$$;
revoke execute on function public.tiny_item(jsonb) from public, anon, authenticated;

-- Relê todos os produtos já vistos para trazer a estrutura.
update public.integracao_fila set pendente = true, tentativas = 0, erro = null where tipo = 'produto';
