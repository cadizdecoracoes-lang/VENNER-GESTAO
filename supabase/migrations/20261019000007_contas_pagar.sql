-- =============================================================================
-- Venner Gestão · Notas de fornecedores e contas a pagar
-- A nota do fornecedor (XML ou PDF) gera os títulos a pagar do CNPJ que comprou
-- e, depois de conferida, dá entrada no estoque do grupo.
-- =============================================================================

insert into public.telas (codigo, titulo, grupo) values
  ('financeiro.notas_fornecedor', 'Notas de fornecedores', 'Financeiro');

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'financeiro.notas_fornecedor', a.acao
from public.perfis p
cross join (values ('ver'::public.acao_permissao), ('criar'), ('editar')) as a(acao)
where p.nome = 'Financeiro';

insert into public.perfil_permissoes (perfil_id, tela_codigo, acao)
select p.id, 'financeiro.notas_fornecedor', 'ver'
from public.perfis p
where p.nome in ('Compras', 'Contabilidade');

create type public.origem_nota as enum ('xml', 'pdf', 'manual');
create type public.situacao_titulo as enum ('aberto', 'pago', 'cancelado');

-- -----------------------------------------------------------------------------
-- Notas de fornecedores
-- -----------------------------------------------------------------------------
create table public.notas_fornecedor (
  id uuid primary key default gen_random_uuid(),
  -- CNPJ do grupo que comprou (destinatário da nota).
  empresa_id uuid not null references public.empresas(id),
  fornecedor_id uuid not null references public.fornecedores(id),
  numero text not null,
  serie text,
  chave text unique check (chave ~ '^\d{44}$'),
  data_emissao date not null,
  valor_produtos numeric(14, 2) not null default 0,
  valor_frete numeric(14, 2) not null default 0,
  valor_desconto numeric(14, 2) not null default 0,
  valor_total numeric(14, 2) not null check (valor_total >= 0),
  origem public.origem_nota not null,
  -- Caminho do XML ou PDF no Storage: <empresa_id>/<nota_id>.<xml|pdf>
  arquivo text,
  observacao text,
  -- Preenchidos quando a nota dá entrada no estoque.
  entrada_em timestamptz,
  entrada_local_id uuid references public.locais_estoque(id),
  usuario_id uuid default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now()
);
create unique index notas_fornecedor_numero_idx on public.notas_fornecedor (fornecedor_id, coalesce(serie, ''), numero);

-- De-para: código do produto no fornecedor -> item da Venner. Memorizado no
-- primeiro vínculo e aplicado sozinho nas próximas notas.
create table public.fornecedor_produtos (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.fornecedores(id) on delete cascade,
  codigo_fornecedor text not null,
  descricao text,
  item_id uuid not null references public.itens(id),
  -- Quantas unidades do item equivalem a 1 unidade do fornecedor (1 CX = 100 UN -> 100).
  fator numeric(14, 6) not null default 1 check (fator > 0),
  atualizado_em timestamptz not null default now(),
  unique (fornecedor_id, codigo_fornecedor)
);

create table public.nota_fornecedor_itens (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas_fornecedor(id) on delete cascade,
  ordem integer not null,
  codigo_fornecedor text not null,
  descricao text not null,
  ncm text,
  cfop text,
  unidade text,
  quantidade numeric(14, 4) not null check (quantidade > 0),
  valor_unitario numeric(16, 6) not null default 0,
  valor_total numeric(14, 2) not null default 0,
  item_id uuid references public.itens(id),
  fator numeric(14, 6) not null default 1 check (fator > 0),
  unique (nota_id, ordem)
);
create index nota_fornecedor_itens_item_idx on public.nota_fornecedor_itens (item_id);

-- Item novo na nota: aplica o de-para já conhecido. Item vinculado: memoriza o
-- de-para e vincula as demais linhas do mesmo produto ainda sem vínculo.
create function public.aplicar_de_para()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fornecedor uuid;
  ja_entrou boolean;
begin
  select n.fornecedor_id, n.entrada_em is not null into fornecedor, ja_entrou
  from public.notas_fornecedor n where n.id = new.nota_id;

  if tg_op = 'UPDATE' and ja_entrou
     and (new.item_id is distinct from old.item_id or new.fator <> old.fator or new.quantidade <> old.quantidade) then
    raise exception 'Esta nota já deu entrada no estoque; o vínculo dos itens não pode mais mudar';
  end if;

  if new.item_id is null then
    select fp.item_id, fp.fator into new.item_id, new.fator
    from public.fornecedor_produtos fp
    where fp.fornecedor_id = fornecedor and fp.codigo_fornecedor = new.codigo_fornecedor;
    new.fator := coalesce(new.fator, 1);
  end if;
  return new;
end;
$$;

create trigger aplicar_de_para
  before insert or update on public.nota_fornecedor_itens
  for each row execute function public.aplicar_de_para();

create function public.memorizar_de_para()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fornecedor uuid;
begin
  if new.item_id is null or pg_trigger_depth() > 1 then
    return null;
  end if;
  select n.fornecedor_id into fornecedor from public.notas_fornecedor n where n.id = new.nota_id;

  insert into public.fornecedor_produtos (fornecedor_id, codigo_fornecedor, descricao, item_id, fator)
  values (fornecedor, new.codigo_fornecedor, new.descricao, new.item_id, new.fator)
  on conflict (fornecedor_id, codigo_fornecedor) do update
    set item_id = excluded.item_id, fator = excluded.fator, descricao = excluded.descricao, atualizado_em = now()
    where (fornecedor_produtos.item_id, fornecedor_produtos.fator) is distinct from (excluded.item_id, excluded.fator);

  update public.nota_fornecedor_itens i
  set item_id = new.item_id, fator = new.fator
  from public.notas_fornecedor n
  where n.id = i.nota_id and n.fornecedor_id = fornecedor and n.entrada_em is null
    and i.item_id is null and i.codigo_fornecedor = new.codigo_fornecedor;
  return null;
end;
$$;

create trigger memorizar_de_para
  after insert or update of item_id, fator on public.nota_fornecedor_itens
  for each row execute function public.memorizar_de_para();

-- Comparação com a compra anterior do mesmo produto, no mesmo fornecedor.
create view public.nota_fornecedor_itens_comparacao
with (security_invoker = true)
as
select
  i.*,
  ant.valor_unitario as valor_unitario_anterior,
  ant.quantidade as quantidade_anterior,
  ant.numero as numero_anterior,
  ant.data_emissao as data_anterior,
  case when ant.valor_unitario > 0
    then round((i.valor_unitario / ant.valor_unitario - 1) * 100, 1)
  end as variacao_preco_pct,
  ant.valor_unitario is null as produto_novo
from public.nota_fornecedor_itens i
join public.notas_fornecedor n on n.id = i.nota_id
left join lateral (
  select ai.valor_unitario, ai.quantidade, an.numero, an.data_emissao
  from public.nota_fornecedor_itens ai
  join public.notas_fornecedor an on an.id = ai.nota_id
  where an.fornecedor_id = n.fornecedor_id
    and ai.codigo_fornecedor = i.codigo_fornecedor
    and (an.data_emissao, an.criado_em) < (n.data_emissao, n.criado_em)
  order by an.data_emissao desc, an.criado_em desc
  limit 1
) ant on true;

-- -----------------------------------------------------------------------------
-- Contas a pagar
-- -----------------------------------------------------------------------------
create table public.contas_pagar (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  fornecedor_id uuid references public.fornecedores(id),
  nota_id uuid references public.notas_fornecedor(id),
  descricao text not null,
  -- Ex.: "1/3".
  parcela text,
  categoria_id uuid references public.plano_contas(id),
  centro_custo_id uuid references public.centros_custo(id),
  valor numeric(14, 2) not null check (valor > 0),
  vencimento date not null,
  situacao public.situacao_titulo not null default 'aberto',
  data_pagamento date,
  valor_pago numeric(14, 2) check (valor_pago > 0),
  conta_bancaria_id uuid references public.contas_bancarias(id),
  observacao text,
  usuario_id uuid default auth.uid() references public.usuarios(id),
  criado_em timestamptz not null default now(),
  check (
    (situacao = 'pago') = (data_pagamento is not null and valor_pago is not null and conta_bancaria_id is not null)
  )
);
create index contas_pagar_vencimento_idx on public.contas_pagar (empresa_id, situacao, vencimento);
create index contas_pagar_nota_idx on public.contas_pagar (nota_id);

-- Título usa categoria de despesa sem subcategorias, conta bancária e nota do
-- mesmo CNPJ.
create function public.validar_conta_pagar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.categoria_id is not null then
    if exists (select 1 from public.plano_contas c where c.id = new.categoria_id and c.tipo <> 'despesa') then
      raise exception 'Contas a pagar usam categorias de despesa';
    end if;
    if exists (select 1 from public.plano_contas c where c.pai_id = new.categoria_id) then
      raise exception 'Escolha a categoria mais detalhada (sem subcategorias abaixo dela)';
    end if;
  end if;
  if new.conta_bancaria_id is not null
     and not exists (select 1 from public.contas_bancarias b where b.id = new.conta_bancaria_id and b.empresa_id = new.empresa_id) then
    raise exception 'A conta bancária do pagamento precisa ser da mesma empresa do título';
  end if;
  if new.nota_id is not null
     and not exists (select 1 from public.notas_fornecedor n where n.id = new.nota_id and n.empresa_id = new.empresa_id) then
    raise exception 'O título precisa ser da mesma empresa da nota';
  end if;
  return new;
end;
$$;

create trigger validar_conta_pagar
  before insert or update on public.contas_pagar
  for each row execute function public.validar_conta_pagar();

-- -----------------------------------------------------------------------------
-- Regras de acesso: por tela e por CNPJ
-- -----------------------------------------------------------------------------
alter table public.notas_fornecedor enable row level security;
alter table public.nota_fornecedor_itens enable row level security;
alter table public.fornecedor_produtos enable row level security;
alter table public.contas_pagar enable row level security;

create policy ver on public.notas_fornecedor for select to authenticated
  using (public.tem_permissao('financeiro.notas_fornecedor', 'ver') and public.pode_ver_empresa(empresa_id));
create policy criar on public.notas_fornecedor for insert to authenticated
  with check (public.tem_permissao('financeiro.notas_fornecedor', 'criar') and public.pode_ver_empresa(empresa_id));
create policy editar on public.notas_fornecedor for update to authenticated
  using (public.tem_permissao('financeiro.notas_fornecedor', 'editar') and public.pode_ver_empresa(empresa_id))
  with check (public.tem_permissao('financeiro.notas_fornecedor', 'editar') and public.pode_ver_empresa(empresa_id));
create policy excluir on public.notas_fornecedor for delete to authenticated
  using (public.tem_permissao('financeiro.notas_fornecedor', 'excluir') and public.pode_ver_empresa(empresa_id) and entrada_em is null);

-- Itens seguem a nota (a subconsulta já passa pela regra da nota).
create policy ver on public.nota_fornecedor_itens for select to authenticated
  using (exists (select 1 from public.notas_fornecedor n where n.id = nota_id));
create policy criar on public.nota_fornecedor_itens for insert to authenticated
  with check (public.tem_permissao('financeiro.notas_fornecedor', 'criar') and exists (select 1 from public.notas_fornecedor n where n.id = nota_id));
create policy editar on public.nota_fornecedor_itens for update to authenticated
  using (public.tem_permissao('financeiro.notas_fornecedor', 'editar') and exists (select 1 from public.notas_fornecedor n where n.id = nota_id))
  with check (public.tem_permissao('financeiro.notas_fornecedor', 'editar'));
create policy excluir on public.nota_fornecedor_itens for delete to authenticated
  using (public.tem_permissao('financeiro.notas_fornecedor', 'excluir') and exists (select 1 from public.notas_fornecedor n where n.id = nota_id));

-- O de-para é gravado pelo gatilho de quem vincula o item.
create policy ver on public.fornecedor_produtos for select to authenticated
  using (public.tem_permissao('financeiro.notas_fornecedor', 'ver') or public.tem_permissao('compras.fornecedores', 'ver'));
create policy criar on public.fornecedor_produtos for insert to authenticated
  with check (public.tem_permissao('financeiro.notas_fornecedor', 'editar') or public.tem_permissao('financeiro.notas_fornecedor', 'criar'));
create policy editar on public.fornecedor_produtos for update to authenticated
  using (public.tem_permissao('financeiro.notas_fornecedor', 'editar'))
  with check (public.tem_permissao('financeiro.notas_fornecedor', 'editar'));
create policy excluir on public.fornecedor_produtos for delete to authenticated
  using (public.tem_permissao('financeiro.notas_fornecedor', 'excluir'));

create policy ver on public.contas_pagar for select to authenticated
  using (public.tem_permissao('financeiro.pagar', 'ver') and public.pode_ver_empresa(empresa_id));
create policy criar on public.contas_pagar for insert to authenticated
  with check (public.tem_permissao('financeiro.pagar', 'criar') and public.pode_ver_empresa(empresa_id));
create policy editar on public.contas_pagar for update to authenticated
  using (public.tem_permissao('financeiro.pagar', 'editar') and public.pode_ver_empresa(empresa_id))
  with check (public.tem_permissao('financeiro.pagar', 'editar') and public.pode_ver_empresa(empresa_id));
create policy excluir on public.contas_pagar for delete to authenticated
  using (public.tem_permissao('financeiro.pagar', 'excluir') and public.pode_ver_empresa(empresa_id));

-- Quem lança notas precisa enxergar os itens (para vincular) e os locais (para a entrada).
drop policy ver on public.itens;
create policy ver on public.itens for select to authenticated
  using (public.tem_permissao('estoque.itens', 'ver') or public.tem_permissao('producao.ficha_tecnica', 'ver')
    or public.tem_permissao('financeiro.notas_fornecedor', 'ver'));
drop policy ver on public.locais_estoque;
create policy ver on public.locais_estoque for select to authenticated
  using (public.tem_permissao('estoque.locais', 'ver') or public.tem_permissao('estoque.saldos', 'ver')
    or public.tem_permissao('estoque.movimentos', 'ver') or public.tem_permissao('financeiro.notas_fornecedor', 'ver'));

do $$
declare
  t text;
begin
  foreach t in array array['notas_fornecedor', 'nota_fornecedor_itens', 'fornecedor_produtos', 'contas_pagar'] loop
    execute format(
      'create trigger auditoria after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()',
      t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lançar a nota inteira de uma vez: cabeçalho, itens e parcelas.
-- Cadastra o fornecedor pelo CNPJ da nota quando ainda não existe.
-- -----------------------------------------------------------------------------
create function public.registrar_nota_fornecedor(dados jsonb)
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
    valor_produtos, valor_frete, valor_desconto, valor_total, origem, arquivo, observacao
  ) values (
    nota, empresa, fornecedor, numero, nullif(trim(dados ->> 'serie'), ''), nullif(dados ->> 'chave', ''),
    (dados ->> 'data_emissao')::date,
    coalesce((dados ->> 'valor_produtos')::numeric, 0), coalesce((dados ->> 'valor_frete')::numeric, 0),
    coalesce((dados ->> 'valor_desconto')::numeric, 0), (dados ->> 'valor_total')::numeric,
    (dados ->> 'origem')::public.origem_nota, nullif(dados ->> 'arquivo', ''), nullif(trim(dados ->> 'observacao'), '')
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
revoke execute on function public.registrar_nota_fornecedor(jsonb) from public, anon;
grant execute on function public.registrar_nota_fornecedor(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Entrada no estoque: uma movimentação por item, com custo proporcional ao
-- total da nota (inclui frete, impostos e descontos), e custo médio recalculado.
-- -----------------------------------------------------------------------------
create function public.dar_entrada_nota(nota uuid, local uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.notas_fornecedor;
  soma_itens numeric;
  linha record;
  qtd numeric;
  custo numeric;
  saldo numeric;
  movimentos integer := 0;
begin
  select * into n from public.notas_fornecedor where id = nota for update;
  if n.id is null or not public.pode_ver_empresa(n.empresa_id) then
    raise exception 'Nota não encontrada';
  end if;
  if not public.tem_permissao('financeiro.notas_fornecedor', 'editar') then
    raise exception 'Seu perfil não pode dar entrada de notas no estoque';
  end if;
  if n.entrada_em is not null then
    raise exception 'Esta nota já deu entrada no estoque';
  end if;
  if not exists (select 1 from public.locais_estoque l where l.id = local and l.ativo) then
    raise exception 'Escolha um local de estoque ativo';
  end if;
  if not exists (select 1 from public.nota_fornecedor_itens where nota_id = nota) then
    raise exception 'A nota não tem itens (notas lançadas por PDF não trazem os produtos)';
  end if;
  if exists (select 1 from public.nota_fornecedor_itens where nota_id = nota and item_id is null) then
    raise exception 'Vincule todos os produtos da nota a itens do sistema antes de dar entrada';
  end if;

  select sum(valor_total) into soma_itens from public.nota_fornecedor_itens where nota_id = nota;

  for linha in
    select i.*, it.custo_medio, it.tipo
    from public.nota_fornecedor_itens i
    join public.itens it on it.id = i.item_id
    where i.nota_id = nota
    order by i.ordem
  loop
    -- Serviço não vai para o estoque.
    continue when linha.tipo = 'servico';
    qtd := round(linha.quantidade * linha.fator, 4);
    custo := case when soma_itens > 0
      then round(linha.valor_total * (n.valor_total / soma_itens) / qtd, 4)
      else 0 end;

    select coalesce(sum(m.quantidade), 0) into saldo from public.movimentos_estoque m where m.item_id = linha.item_id;
    update public.itens
    set custo_medio = case when saldo > 0
      then round((saldo * custo_medio + qtd * custo) / (saldo + qtd), 4)
      else custo end
    where id = linha.item_id;

    insert into public.movimentos_estoque (item_id, local_id, tipo, quantidade, custo_unitario, empresa_id, origem_tipo, origem_id, observacao)
    values (linha.item_id, local, 'entrada', qtd, custo, n.empresa_id, 'nota_fornecedor', nota,
            'NF ' || n.numero || coalesce('-' || n.serie, ''));
    movimentos := movimentos + 1;
  end loop;

  update public.notas_fornecedor set entrada_em = now(), entrada_local_id = local where id = nota;
  return movimentos;
end;
$$;
revoke execute on function public.dar_entrada_nota(uuid, uuid) from public, anon;
grant execute on function public.dar_entrada_nota(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Arquivos das notas (XML e PDF) no Storage, separados por CNPJ.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('notas-fornecedor', 'notas-fornecedor', false)
  on conflict (id) do nothing;

  create policy notas_fornecedor_ver on storage.objects for select to authenticated
    using (bucket_id = 'notas-fornecedor'
      and public.tem_permissao('financeiro.notas_fornecedor', 'ver')
      and public.pode_ver_empresa(((storage.foldername(name))[1])::uuid));
  create policy notas_fornecedor_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'notas-fornecedor'
      and public.tem_permissao('financeiro.notas_fornecedor', 'criar')
      and public.pode_ver_empresa(((storage.foldername(name))[1])::uuid));
  create policy notas_fornecedor_apagar on storage.objects for delete to authenticated
    using (bucket_id = 'notas-fornecedor'
      and public.tem_permissao('financeiro.notas_fornecedor', 'criar')
      and public.pode_ver_empresa(((storage.foldername(name))[1])::uuid));
end;
$$;
