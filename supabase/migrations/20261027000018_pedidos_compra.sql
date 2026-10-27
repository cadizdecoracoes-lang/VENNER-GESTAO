-- =============================================================================
-- Venner Gestão · Pedidos de compra com etapas e aprovação
--
-- O pedido de compra tem os mesmos campos da ordem de compra do Tiny
-- (fornecedor, data, data prevista, condição, categoria, frete por conta,
-- transportador, frete, desconto, observações e observações internas; itens
-- com quantidade, valor, IPI, ICMS e informações adicionais; parcelas com
-- dias, vencimento, valor e meio de pagamento). tiny_id fica reservado para
-- quando o pedido for enviado ao Tiny (ainda não enviamos nada).
--
-- Etapas: criação → orçamento → aprovação → aprovado → recebido (ou cancelado).
-- - Criação e orçamento: o comprador monta o pedido e registra os orçamentos
--   dos fornecedores; escolher um orçamento define o fornecedor do pedido.
-- - Pedir aprovação exige produtos, fornecedor e um orçamento escolhido.
-- - Aprovar (ou devolver para orçamento) exige a ação "aprovar" da tela de
--   pedidos de compra (a Diretoria já tem). Depois de pedir aprovação o pedido
--   não muda mais; para mudar, volta para orçamento com o motivo.
-- - A troca de etapa só acontece pela função mudar_etapa_pedido_compra, e
--   fica no histórico com quem fez, quando e o motivo.
--
-- Nota do fornecedor: toda nota nova precisa de um pedido de compra aprovado
-- da mesma empresa e do mesmo fornecedor, ou de uma justificativa escrita
-- (mínimo 15 letras) de por que entrou sem pedido. A primeira nota ligada
-- marca o pedido como recebido. Notas antigas ficam como estão.
-- =============================================================================

create type public.etapa_pedido_compra as enum ('criacao', 'orcamento', 'aprovacao', 'aprovado', 'recebido', 'cancelado');

-- -----------------------------------------------------------------------------
-- Pedido de compra
-- -----------------------------------------------------------------------------
create table public.pedidos_compra (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  -- CNPJ do grupo que compra.
  empresa_id uuid not null references public.empresas(id),
  -- Pode ficar vazio na criação; o orçamento escolhido define.
  fornecedor_id uuid references public.fornecedores(id),
  categoria_id uuid references public.plano_contas(id),
  data_pedido date not null default current_date,
  data_prevista date,
  condicao_pagamento text,
  -- Igual ao Tiny: R remetente, D destinatário, T terceiros, 3 próprio
  -- remetente, 4 próprio destinatário, S sem transporte.
  frete_por_conta text check (frete_por_conta in ('R', 'D', 'T', '3', '4', 'S')),
  transportador text,
  valor_frete numeric(14, 2) not null default 0 check (valor_frete >= 0),
  valor_desconto numeric(14, 2) not null default 0 check (valor_desconto >= 0),
  observacoes text,
  observacoes_internas text,
  etapa public.etapa_pedido_compra not null default 'criacao',
  etapa_desde timestamptz not null default now(),
  aprovado_por uuid references public.usuarios(id),
  aprovado_em timestamptz,
  tiny_id bigint unique,
  usuario_id uuid default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now()
);
create index pedidos_compra_etapa_idx on public.pedidos_compra (empresa_id, etapa);
create index pedidos_compra_fornecedor_idx on public.pedidos_compra (fornecedor_id);

create table public.pedido_compra_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_compra(id) on delete cascade,
  item_id uuid not null references public.itens(id),
  quantidade numeric(14, 4) not null check (quantidade > 0),
  valor_unitario numeric(16, 6) not null default 0 check (valor_unitario >= 0),
  valor_total numeric(14, 2) generated always as (round(quantidade * valor_unitario, 2)) stored,
  aliquota_ipi numeric(6, 2) not null default 0 check (aliquota_ipi >= 0),
  valor_icms numeric(14, 2) not null default 0 check (valor_icms >= 0),
  informacoes_adicionais text,
  unique (pedido_id, item_id)
);

create table public.pedido_compra_parcelas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_compra(id) on delete cascade,
  dias integer not null default 0 check (dias >= 0),
  vencimento date not null,
  valor numeric(14, 2) not null check (valor > 0),
  -- Códigos do Tiny: 1 dinheiro, 2 cheque, 3 cartão de crédito, 4 cartão de
  -- débito, 14 duplicata, 15 boleto, 16 depósito, 17 Pix, 18 transferência, 99 outros...
  meio_pagamento text check (meio_pagamento in ('1', '2', '3', '4', '5', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '90', '99')),
  observacao text
);
create index pedido_compra_parcelas_idx on public.pedido_compra_parcelas (pedido_id, vencimento);

-- Orçamentos pedidos aos fornecedores. Um só fica escolhido por pedido.
create table public.pedido_compra_orcamentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_compra(id) on delete cascade,
  fornecedor_id uuid not null references public.fornecedores(id),
  valor_total numeric(14, 2) not null check (valor_total >= 0),
  prazo_entrega_dias integer check (prazo_entrega_dias >= 0),
  condicao_pagamento text,
  validade date,
  observacao text,
  escolhido boolean not null default false,
  usuario_id uuid default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now()
);
create index pedido_compra_orcamentos_idx on public.pedido_compra_orcamentos (pedido_id);
create unique index pedido_compra_orcamento_escolhido_idx on public.pedido_compra_orcamentos (pedido_id) where escolhido;

create table public.pedido_compra_historico (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos_compra(id) on delete cascade,
  etapa public.etapa_pedido_compra not null,
  observacao text,
  usuario_id uuid default auth.uid() references public.usuarios(id),
  em timestamptz not null default now()
);
create index pedido_compra_historico_idx on public.pedido_compra_historico (pedido_id, em);

-- Nota do fornecedor: pedido de compra ou justificativa de entrar sem pedido.
alter table public.notas_fornecedor
  add column pedido_compra_id uuid references public.pedidos_compra(id),
  add column justificativa_sem_pedido text;
create index notas_fornecedor_pedido_compra_idx on public.notas_fornecedor (pedido_compra_id);

-- Total do pedido (itens + IPI + frete − desconto) e o que já chegou em nota.
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

-- -----------------------------------------------------------------------------
-- Regras: só muda em criação/orçamento; a etapa só muda pela função.
-- -----------------------------------------------------------------------------
create function public.pedido_compra_editavel(pedido uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.pedidos_compra p where p.id = pedido and p.etapa in ('criacao', 'orcamento'));
$$;

create function public.validar_pedido_compra()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.etapa <> 'criacao' then
      raise exception 'O pedido de compra nasce na etapa Criação';
    end if;
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

create trigger validar_pedido_compra
  before insert or update on public.pedidos_compra
  for each row execute function public.validar_pedido_compra();

-- Itens, parcelas e orçamentos só mudam com o pedido em criação/orçamento.
create function public.travar_filhos_pedido_compra()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pedido uuid := case when tg_op = 'DELETE' then old.pedido_id else new.pedido_id end;
begin
  -- Excluir o pedido inteiro (ainda em criação) leva os filhos junto.
  if tg_op = 'DELETE' and not exists (select 1 from public.pedidos_compra p where p.id = pedido) then
    return old;
  end if;
  if current_setting('venner.mudando_etapa_compra', true) is distinct from 'sim'
     and not public.pedido_compra_editavel(pedido) then
    raise exception 'Pedido em aprovação ou aprovado não muda: volte para Orçamento para alterar';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger travar_itens before insert or update or delete on public.pedido_compra_itens
  for each row execute function public.travar_filhos_pedido_compra();
create trigger travar_parcelas before insert or update or delete on public.pedido_compra_parcelas
  for each row execute function public.travar_filhos_pedido_compra();
create trigger travar_orcamentos before insert or update or delete on public.pedido_compra_orcamentos
  for each row execute function public.travar_filhos_pedido_compra();

create function public.registrar_criacao_pedido_compra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pedido_compra_historico (pedido_id, etapa) values (new.id, new.etapa);
  return null;
end;
$$;
revoke execute on function public.registrar_criacao_pedido_compra() from public, anon, authenticated;

create trigger registrar_criacao
  after insert on public.pedidos_compra
  for each row execute function public.registrar_criacao_pedido_compra();

-- -----------------------------------------------------------------------------
-- Regras de acesso. Quem lança nota de fornecedor enxerga os pedidos (para
-- ligar a nota ao pedido aprovado). Cabeçalho, itens e parcelas são gravados
-- pela função salvar_pedido_compra; orçamentos direto na tabela.
-- -----------------------------------------------------------------------------
alter table public.pedidos_compra enable row level security;
alter table public.pedido_compra_itens enable row level security;
alter table public.pedido_compra_parcelas enable row level security;
alter table public.pedido_compra_orcamentos enable row level security;
alter table public.pedido_compra_historico enable row level security;

create function public.pode_ver_pedido_compra(empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.tem_permissao('compras.pedidos', 'ver') or public.tem_permissao('financeiro.notas_fornecedor', 'criar'))
    and public.pode_ver_empresa(empresa);
$$;
revoke execute on function public.pode_ver_pedido_compra(uuid) from public, anon;
grant execute on function public.pode_ver_pedido_compra(uuid) to authenticated;

create policy ver on public.pedidos_compra for select to authenticated
  using (public.pode_ver_pedido_compra(empresa_id));
create policy excluir on public.pedidos_compra for delete to authenticated
  using (public.tem_permissao('compras.pedidos', 'excluir') and public.pode_ver_empresa(empresa_id) and etapa = 'criacao');

create policy ver on public.pedido_compra_itens for select to authenticated
  using (exists (select 1 from public.pedidos_compra p where p.id = pedido_id));
create policy ver on public.pedido_compra_parcelas for select to authenticated
  using (exists (select 1 from public.pedidos_compra p where p.id = pedido_id));
create policy ver on public.pedido_compra_historico for select to authenticated
  using (exists (select 1 from public.pedidos_compra p where p.id = pedido_id));

create policy ver on public.pedido_compra_orcamentos for select to authenticated
  using (exists (select 1 from public.pedidos_compra p where p.id = pedido_id));
create policy criar on public.pedido_compra_orcamentos for insert to authenticated
  with check (public.tem_permissao('compras.pedidos', 'editar') and not escolhido
    and exists (select 1 from public.pedidos_compra p where p.id = pedido_id and public.pode_ver_empresa(p.empresa_id)));
create policy excluir on public.pedido_compra_orcamentos for delete to authenticated
  using (public.tem_permissao('compras.pedidos', 'editar')
    and exists (select 1 from public.pedidos_compra p where p.id = pedido_id and public.pode_ver_empresa(p.empresa_id)));

revoke all on public.pedidos_compra, public.pedido_compra_itens, public.pedido_compra_parcelas,
  public.pedido_compra_orcamentos, public.pedido_compra_historico from anon, authenticated;
grant select on public.pedidos_compra, public.pedido_compra_itens, public.pedido_compra_parcelas,
  public.pedido_compra_orcamentos, public.pedido_compra_historico, public.pedidos_compra_resumo to authenticated;
grant delete on public.pedidos_compra to authenticated;
grant insert, delete on public.pedido_compra_orcamentos to authenticated;

-- O comprador escolhe os produtos e a categoria financeira do pedido.
create policy ver_compras on public.plano_contas for select to authenticated
  using (public.tem_permissao('compras.pedidos', 'ver'));
create policy ver_compras on public.itens for select to authenticated
  using (public.tem_permissao('compras.pedidos', 'ver'));

do $$
declare
  t text;
begin
  foreach t in array array['pedidos_compra', 'pedido_compra_itens', 'pedido_compra_parcelas', 'pedido_compra_orcamentos'] loop
    execute format(
      'create trigger auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()',
      t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Gravar o pedido inteiro: cabeçalho, itens e parcelas (substitui os anteriores).
-- -----------------------------------------------------------------------------
create function public.salvar_pedido_compra(dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pedido uuid := nullif(dados ->> 'id', '')::uuid;
  empresa uuid;
  item jsonb;
  parcela jsonb;
begin
  if jsonb_array_length(coalesce(dados -> 'itens', '[]')) = 0 then
    raise exception 'Inclua pelo menos um produto no pedido';
  end if;

  if pedido is null then
    empresa := nullif(dados ->> 'empresa_id', '')::uuid;
    if not public.tem_permissao('compras.pedidos', 'criar') then
      raise exception 'Seu perfil não pode criar pedidos de compra';
    end if;
    if empresa is null or not public.pode_ver_empresa(empresa) then
      raise exception 'Seu usuário não tem acesso a esta empresa';
    end if;
    insert into public.pedidos_compra (empresa_id) values (empresa) returning id into pedido;
  else
    select p.empresa_id into empresa from public.pedidos_compra p where p.id = pedido;
    if empresa is null or not public.pode_ver_empresa(empresa) then
      raise exception 'Pedido de compra não encontrado';
    end if;
    if not public.tem_permissao('compras.pedidos', 'editar') then
      raise exception 'Seu perfil não pode alterar pedidos de compra';
    end if;
  end if;

  update public.pedidos_compra set
    fornecedor_id = nullif(dados ->> 'fornecedor_id', '')::uuid,
    categoria_id = nullif(dados ->> 'categoria_id', '')::uuid,
    data_pedido = coalesce(nullif(dados ->> 'data_pedido', '')::date, data_pedido),
    data_prevista = nullif(dados ->> 'data_prevista', '')::date,
    condicao_pagamento = nullif(trim(dados ->> 'condicao_pagamento'), ''),
    frete_por_conta = nullif(dados ->> 'frete_por_conta', ''),
    transportador = nullif(trim(dados ->> 'transportador'), ''),
    valor_frete = coalesce(nullif(dados ->> 'valor_frete', '')::numeric, 0),
    valor_desconto = coalesce(nullif(dados ->> 'valor_desconto', '')::numeric, 0),
    observacoes = nullif(trim(dados ->> 'observacoes'), ''),
    observacoes_internas = nullif(trim(dados ->> 'observacoes_internas'), '')
  where id = pedido;

  if not public.pedido_compra_editavel(pedido) then
    raise exception 'Pedido em aprovação ou aprovado não muda: volte para Orçamento para alterar';
  end if;

  delete from public.pedido_compra_itens where pedido_id = pedido;
  for item in select * from jsonb_array_elements(dados -> 'itens') loop
    insert into public.pedido_compra_itens (
      pedido_id, item_id, quantidade, valor_unitario, aliquota_ipi, valor_icms, informacoes_adicionais
    ) values (
      pedido, (item ->> 'item_id')::uuid, (item ->> 'quantidade')::numeric,
      coalesce(nullif(item ->> 'valor_unitario', '')::numeric, 0), coalesce(nullif(item ->> 'aliquota_ipi', '')::numeric, 0),
      coalesce(nullif(item ->> 'valor_icms', '')::numeric, 0), nullif(trim(item ->> 'informacoes_adicionais'), '')
    );
  end loop;

  delete from public.pedido_compra_parcelas where pedido_id = pedido;
  for parcela in select * from jsonb_array_elements(coalesce(dados -> 'parcelas', '[]')) loop
    insert into public.pedido_compra_parcelas (pedido_id, dias, vencimento, valor, meio_pagamento, observacao)
    values (
      pedido, coalesce(nullif(parcela ->> 'dias', '')::integer, 0), (parcela ->> 'vencimento')::date,
      (parcela ->> 'valor')::numeric, nullif(parcela ->> 'meio_pagamento', ''), nullif(trim(parcela ->> 'observacao'), '')
    );
  end loop;

  return pedido;
end;
$$;
revoke execute on function public.salvar_pedido_compra(jsonb) from public, anon;
grant execute on function public.salvar_pedido_compra(jsonb) to authenticated;

-- Escolher o orçamento: define o fornecedor, a condição e a data prevista.
create function public.escolher_orcamento_compra(orcamento uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.pedido_compra_orcamentos;
  p public.pedidos_compra;
begin
  select * into o from public.pedido_compra_orcamentos where id = orcamento;
  select * into p from public.pedidos_compra where id = o.pedido_id for update;
  if p.id is null or not public.pode_ver_empresa(p.empresa_id) then
    raise exception 'Orçamento não encontrado';
  end if;
  if not public.tem_permissao('compras.pedidos', 'editar') then
    raise exception 'Seu perfil não pode alterar pedidos de compra';
  end if;
  if p.etapa not in ('criacao', 'orcamento') then
    raise exception 'Pedido em aprovação ou aprovado não muda: volte para Orçamento para alterar';
  end if;

  update public.pedido_compra_orcamentos set escolhido = false where pedido_id = p.id and escolhido and id <> o.id;
  update public.pedido_compra_orcamentos set escolhido = true where id = o.id;
  update public.pedidos_compra set
    fornecedor_id = o.fornecedor_id,
    condicao_pagamento = coalesce(o.condicao_pagamento, condicao_pagamento),
    data_prevista = case when o.prazo_entrega_dias is not null then data_pedido + o.prazo_entrega_dias else data_prevista end
  where id = p.id;
end;
$$;
revoke execute on function public.escolher_orcamento_compra(uuid) from public, anon;
grant execute on function public.escolher_orcamento_compra(uuid) to authenticated;

-- Trocar de etapa, com as conferências de cada passo e o histórico.
create function public.mudar_etapa_pedido_compra(pedido uuid, destino public.etapa_pedido_compra, motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos_compra;
  texto text := nullif(trim(motivo), '');
begin
  select * into p from public.pedidos_compra where id = pedido for update;
  if p.id is null or not public.pode_ver_empresa(p.empresa_id) then
    raise exception 'Pedido de compra não encontrado';
  end if;
  if p.etapa = destino then
    raise exception 'O pedido já está nesta etapa';
  end if;

  case
    when p.etapa = 'criacao' and destino = 'orcamento'
      or p.etapa = 'orcamento' and destino = 'criacao' then
      if not public.tem_permissao('compras.pedidos', 'editar') then
        raise exception 'Seu perfil não pode alterar pedidos de compra';
      end if;
      if destino = 'orcamento' and not exists (select 1 from public.pedido_compra_itens where pedido_id = pedido) then
        raise exception 'Inclua os produtos antes de pedir orçamentos';
      end if;

    when p.etapa in ('criacao', 'orcamento') and destino = 'aprovacao' then
      if not public.tem_permissao('compras.pedidos', 'editar') then
        raise exception 'Seu perfil não pode alterar pedidos de compra';
      end if;
      if not exists (select 1 from public.pedido_compra_itens where pedido_id = pedido) then
        raise exception 'Inclua pelo menos um produto antes de pedir aprovação';
      end if;
      if not exists (select 1 from public.pedido_compra_orcamentos where pedido_id = pedido and escolhido) then
        raise exception 'Registre os orçamentos e escolha um antes de pedir aprovação';
      end if;
      if p.fornecedor_id is null then
        raise exception 'Escolha o fornecedor antes de pedir aprovação';
      end if;

    when p.etapa = 'aprovacao' and destino = 'aprovado' then
      if not public.tem_permissao('compras.pedidos', 'aprovar') then
        raise exception 'Seu perfil não pode aprovar pedidos de compra';
      end if;

    -- Devolver para orçamento: quem aprova (reprovar) ou, antes da aprovação,
    -- o próprio comprador. Depois de aprovado só quem aprova reabre.
    when p.etapa in ('aprovacao', 'aprovado') and destino = 'orcamento' then
      if not (public.tem_permissao('compras.pedidos', 'aprovar')
              or p.etapa = 'aprovacao' and public.tem_permissao('compras.pedidos', 'editar')) then
        raise exception 'Seu perfil não pode devolver este pedido para orçamento';
      end if;
      if exists (select 1 from public.notas_fornecedor where pedido_compra_id = pedido) then
        raise exception 'Este pedido já tem nota de fornecedor lançada';
      end if;
      if texto is null then
        raise exception 'Escreva o motivo de voltar o pedido para orçamento';
      end if;

    when p.etapa <> 'recebido' and destino = 'cancelado' then
      if not (public.tem_permissao('compras.pedidos', 'aprovar')
              or p.etapa in ('criacao', 'orcamento', 'aprovacao') and public.tem_permissao('compras.pedidos', 'editar')) then
        raise exception 'Seu perfil não pode cancelar este pedido';
      end if;
      if exists (select 1 from public.notas_fornecedor where pedido_compra_id = pedido) then
        raise exception 'Este pedido já tem nota de fornecedor lançada';
      end if;
      if texto is null then
        raise exception 'Escreva o motivo do cancelamento';
      end if;

    else
      raise exception 'Este pedido não pode ir desta etapa para a escolhida';
  end case;

  perform set_config('venner.mudando_etapa_compra', 'sim', true);
  update public.pedidos_compra set
    etapa = destino,
    aprovado_por = case when destino = 'aprovado' then auth.uid() when destino = 'orcamento' then null else aprovado_por end,
    aprovado_em = case when destino = 'aprovado' then now() when destino = 'orcamento' then null else aprovado_em end
  where id = pedido;
  perform set_config('venner.mudando_etapa_compra', '', true);
  insert into public.pedido_compra_historico (pedido_id, etapa, observacao) values (pedido, destino, texto);
end;
$$;
revoke execute on function public.mudar_etapa_pedido_compra(uuid, public.etapa_pedido_compra, text) from public, anon;
grant execute on function public.mudar_etapa_pedido_compra(uuid, public.etapa_pedido_compra, text) to authenticated;

create function public.historico_pedido_compra(pedido uuid)
returns table (etapa public.etapa_pedido_compra, observacao text, em timestamptz, usuario text)
language sql
stable
security definer
set search_path = ''
as $$
  select h.etapa, h.observacao, h.em, u.nome
  from public.pedido_compra_historico h
  join public.pedidos_compra p on p.id = h.pedido_id
  left join public.usuarios u on u.id = h.usuario_id
  where h.pedido_id = pedido and public.pode_ver_pedido_compra(p.empresa_id)
  order by h.em, h.id;
$$;
revoke execute on function public.historico_pedido_compra(uuid) from public, anon;
grant execute on function public.historico_pedido_compra(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Nota do fornecedor exige pedido aprovado ou justificativa.
-- -----------------------------------------------------------------------------
create function public.conferir_pedido_da_nota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos_compra;
begin
  new.justificativa_sem_pedido := nullif(trim(new.justificativa_sem_pedido), '');
  if new.pedido_compra_id is null then
    if length(coalesce(new.justificativa_sem_pedido, '')) < 15 then
      raise exception 'Escolha o pedido de compra aprovado desta nota ou escreva a justificativa de lançar sem pedido (pelo menos 15 letras)';
    end if;
    return new;
  end if;

  select * into p from public.pedidos_compra where id = new.pedido_compra_id for update;
  if p.id is null or p.empresa_id <> new.empresa_id then
    raise exception 'O pedido de compra precisa ser da mesma empresa da nota';
  end if;
  if p.fornecedor_id is distinct from new.fornecedor_id then
    raise exception 'O pedido de compra é de outro fornecedor';
  end if;
  if p.etapa not in ('aprovado', 'recebido') then
    raise exception 'O pedido de compra % ainda não foi aprovado', p.numero;
  end if;
  new.justificativa_sem_pedido := null;

  if p.etapa = 'aprovado' then
    perform set_config('venner.mudando_etapa_compra', 'sim', true);
    update public.pedidos_compra set etapa = 'recebido' where id = p.id;
    perform set_config('venner.mudando_etapa_compra', '', true);
    insert into public.pedido_compra_historico (pedido_id, etapa, observacao)
    values (p.id, 'recebido', 'NF ' || new.numero || coalesce('-' || new.serie, '') || ' lançada');
  end if;
  return new;
end;
$$;
revoke execute on function public.conferir_pedido_da_nota() from public, anon, authenticated;

create trigger conferir_pedido_da_nota
  before insert or update of pedido_compra_id, justificativa_sem_pedido on public.notas_fornecedor
  for each row execute function public.conferir_pedido_da_nota();

-- Mesmo lançamento de antes, agora com o pedido de compra ou a justificativa.
create or replace function public.registrar_nota_fornecedor(dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  empresa uuid := (dados ->> 'empresa_id')::uuid;
  fornecedor uuid := nullif(dados ->> 'fornecedor_id', '')::uuid;
  f jsonb := dados -> 'fornecedor';
  doc text := regexp_replace(coalesce(f ->> 'documento', ''), '\D', '', 'g');
  nota uuid := coalesce(nullif(dados ->> 'id', '')::uuid, gen_random_uuid());
  nome_fornecedor text;
  numero text := nullif(trim(dados ->> 'numero'), '');
  item jsonb;
  parcela jsonb;
  total_parcelas integer := coalesce(jsonb_array_length(dados -> 'parcelas'), 0);
  n integer := 0;
begin
  if not public.tem_permissao('financeiro.notas_fornecedor', 'criar') then
    raise exception 'Seu perfil não pode lançar notas de fornecedores';
  end if;
  if empresa is null or not public.pode_ver_empresa(empresa) then
    raise exception 'Seu usuário não tem acesso a esta empresa';
  end if;
  if total_parcelas > 0 and not public.tem_permissao('financeiro.pagar', 'criar') then
    raise exception 'Seu perfil não pode criar contas a pagar';
  end if;
  if numero is null then
    raise exception 'Informe o número da nota';
  end if;
  if dados ->> 'destinatario_cnpj' is not null
     and not exists (select 1 from public.empresas e where e.id = empresa and e.cnpj = dados ->> 'destinatario_cnpj') then
    raise exception 'Esta nota foi emitida para outro CNPJ e não para a empresa escolhida';
  end if;

  if fornecedor is null then
    if doc = '' then
      raise exception 'Informe o fornecedor da nota';
    end if;
    select id into fornecedor from public.fornecedores where documento = doc;
    if fornecedor is null then
      insert into public.fornecedores (tipo_pessoa, documento, nome, nome_fantasia, cidade, uf)
      values (
        case when length(doc) = 11 then 'fisica' else 'juridica' end::public.tipo_pessoa,
        doc,
        coalesce(nullif(trim(f ->> 'nome'), ''), 'Fornecedor ' || doc),
        nullif(trim(f ->> 'nome_fantasia'), ''),
        nullif(trim(f ->> 'cidade'), ''),
        nullif(upper(trim(f ->> 'uf')), '')
      )
      returning id into fornecedor;
    end if;
  end if;
  select coalesce(nome_fantasia, nome) into nome_fornecedor from public.fornecedores where id = fornecedor;

  insert into public.notas_fornecedor (
    id, empresa_id, fornecedor_id, numero, serie, chave, data_emissao,
    valor_produtos, valor_frete, valor_desconto, valor_total, origem, arquivo, observacao,
    pedido_compra_id, justificativa_sem_pedido
  ) values (
    nota, empresa, fornecedor, numero, nullif(trim(dados ->> 'serie'), ''), nullif(dados ->> 'chave', ''),
    (dados ->> 'data_emissao')::date,
    coalesce((dados ->> 'valor_produtos')::numeric, 0), coalesce((dados ->> 'valor_frete')::numeric, 0),
    coalesce((dados ->> 'valor_desconto')::numeric, 0), (dados ->> 'valor_total')::numeric,
    (dados ->> 'origem')::public.origem_nota, nullif(dados ->> 'arquivo', ''), nullif(trim(dados ->> 'observacao'), ''),
    nullif(dados ->> 'pedido_compra_id', '')::uuid, dados ->> 'justificativa_sem_pedido'
  );

  for item in select * from jsonb_array_elements(coalesce(dados -> 'itens', '[]')) loop
    n := n + 1;
    insert into public.nota_fornecedor_itens (
      nota_id, ordem, codigo_fornecedor, descricao, ncm, cfop, unidade, quantidade, valor_unitario, valor_total
    ) values (
      nota, n, item ->> 'codigo', item ->> 'descricao', item ->> 'ncm', item ->> 'cfop', item ->> 'unidade',
      (item ->> 'quantidade')::numeric, coalesce((item ->> 'valor_unitario')::numeric, 0), coalesce((item ->> 'valor_total')::numeric, 0)
    );
  end loop;

  n := 0;
  for parcela in select * from jsonb_array_elements(coalesce(dados -> 'parcelas', '[]')) loop
    n := n + 1;
    insert into public.contas_pagar (
      empresa_id, fornecedor_id, nota_id, descricao, parcela, categoria_id, centro_custo_id, valor, vencimento
    ) values (
      empresa, fornecedor, nota, 'NF ' || numero || ' · ' || nome_fornecedor,
      case when total_parcelas > 1 then n || '/' || total_parcelas end,
      nullif(dados ->> 'categoria_id', '')::uuid, nullif(dados ->> 'centro_custo_id', '')::uuid,
      (parcela ->> 'valor')::numeric, (parcela ->> 'vencimento')::date
    );
  end loop;

  return nota;
end;
$$;
