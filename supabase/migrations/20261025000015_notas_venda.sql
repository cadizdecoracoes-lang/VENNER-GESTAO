-- =============================================================================
-- Venner Gestão · Nota fiscal de venda emitida pelo sistema, através do Tiny
--
-- O botão "Emitir NF" do pedido chama a Edge Function integracoes (ação
-- emitir_nf), que no Tiny gera a nota do pedido, manda autorizar na SEFAZ,
-- baixa o DANFE (PDF) e o XML para o Storage e pede ao Tiny que lance as
-- contas a receber da nota (a leitura do Tiny traz as parcelas para cá e liga
-- ao pedido pelo número da nota). O certificado digital continua só no Tiny.
--
-- - notas_venda: uma linha por nota do Tiny, com a situação na SEFAZ e a
--   mensagem de erro (rejeição) em texto. As telas só leem; quem grava são as
--   funções abaixo, chamadas pela Edge Function com o login de quem clicou.
-- - Emitir e cancelar nota exige a ação "aprovar" na tela de pedidos de venda
--   (a Diretoria já tem; os outros perfis ganham em Configurações › Perfis).
-- - nf_venda_acesso entrega à função o acesso ao Tiny da empresa do pedido.
-- - Arquivos no bucket notas-venda: <empresa_id>/<nota_id>.pdf | .xml.
-- =============================================================================

create table public.notas_venda (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  pedido_id uuid not null references public.pedidos_venda(id),
  tiny_id bigint not null unique,
  modelo smallint not null default 55 check (modelo in (55, 65)),
  numero text,
  serie text,
  chave_acesso text,
  -- gerada: existe no Tiny, ainda não foi à SEFAZ · enviada: esperando a
  -- SEFAZ responder · autorizada · rejeitada (corrigir no Tiny e tentar de
  -- novo) · denegada · cancelada.
  situacao text not null default 'gerada'
    check (situacao in ('gerada', 'enviada', 'autorizada', 'rejeitada', 'denegada', 'cancelada')),
  -- Código da situação no Tiny (1 a 10), para conferência.
  situacao_tiny smallint,
  -- Erro da SEFAZ ou do Tiny na última tentativa (vazio quando deu certo).
  mensagem text,
  valor numeric(14, 2),
  emitida_em date,
  -- Consulta da nota no portal (link do Tiny).
  link text,
  danfe_arquivo text,
  xml_arquivo text,
  xml_cancelamento_arquivo text,
  contas_lancadas boolean not null default false,
  justificativa_cancelamento text,
  usuario_id uuid references public.usuarios(id),
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index notas_venda_pedido_idx on public.notas_venda (pedido_id);
-- Uma nota valendo por pedido (cancelada ou denegada libera para emitir outra).
create unique index notas_venda_uma_por_pedido on public.notas_venda (pedido_id)
  where situacao not in ('cancelada', 'denegada');

alter table public.notas_venda enable row level security;
create policy notas_venda_ver on public.notas_venda for select to authenticated
  using (public.tem_permissao('vendas.pedidos', 'ver') and public.pode_ver_empresa(empresa_id));
revoke all on public.notas_venda from anon, authenticated;
grant select on public.notas_venda to authenticated;

create trigger auditoria after insert or update or delete on public.notas_venda
  for each row execute function public.registrar_auditoria();

-- Situação do Tiny (1 Pendente, 2 Emitida, 3 Cancelada, 4 Enviada aguardando
-- recibo, 5 Rejeitada, 6 Autorizada, 7 Emitida DANFE, 8 Registrada,
-- 9 Enviada aguardando protocolo, 10 Denegada) → situação daqui.
create function public.situacao_nf_tiny(codigo integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case codigo
    when 1 then 'gerada'
    when 3 then 'cancelada'
    when 5 then 'rejeitada'
    when 6 then 'autorizada'
    when 7 then 'autorizada'
    when 10 then 'denegada'
    when 2 then 'enviada'
    when 4 then 'enviada'
    when 8 then 'enviada'
    when 9 then 'enviada'
  end;
$$;

-- Confere o perfil e devolve o pedido (para as duas funções abaixo).
create function public.nf_venda_pedido(pedido uuid)
returns public.pedidos_venda
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.pedidos_venda;
begin
  select * into p from public.pedidos_venda where id = pedido;
  if p.id is null or not public.pode_ver_empresa(p.empresa_id) then
    raise exception 'Pedido não encontrado';
  end if;
  if not public.tem_permissao('vendas.pedidos', 'aprovar') then
    raise exception 'Seu perfil não pode emitir nem cancelar nota fiscal (falta a permissão Aprovar em Pedidos de venda)';
  end if;
  return p;
end;
$$;

-- Para a Edge Function: o pedido no Tiny, a nota atual (se houver) e o acesso
-- à conta do Tiny da empresa do pedido.
create function public.nf_venda_acesso(pedido uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos_venda := public.nf_venda_pedido(pedido);
  resposta jsonb;
begin
  if p.tiny_id is null then
    raise exception 'Este pedido foi lançado aqui e ainda não existe no Tiny. Por enquanto só os pedidos lidos do Tiny são faturados por aqui';
  end if;
  select jsonb_build_object(
    'empresa_id', p.empresa_id,
    'pedido_tiny', p.tiny_id,
    'integracao', i.id,
    'access_token', i.access_token,
    'refresh_token', i.refresh_token,
    'expira_em', i.expira_em,
    'client_id', a.client_id,
    'client_secret', a.client_secret,
    -- Leitura automática em andamento: ela pode estar renovando o acesso.
    'lendo', coalesce(r.executando_ate > now(), false),
    'nota', (select to_jsonb(n) - 'empresa_id' - 'pedido_id' from public.notas_venda n
             where n.pedido_id = p.id order by (n.situacao in ('cancelada', 'denegada')), n.criada_em desc limit 1))
  into resposta
  from public.integracoes_plataforma i
  left join public.integracoes_aplicativos a on a.canal = 'tiny' and a.empresa_id = i.empresa_id
  left join public.integracao_robo r on r.integracao_id = i.id
  where i.canal = 'tiny' and i.empresa_id = p.empresa_id
  order by i.criado_em desc
  limit 1;
  if resposta is null then
    raise exception 'A conta do Tiny desta empresa não está ligada (Configurações › Integrações)';
  end if;
  return resposta;
end;
$$;

-- Acesso renovado pela própria emissão (o Tiny troca a chave de renovação).
create function public.nf_venda_tokens(pedido uuid, acesso text, renovacao text, expira timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos_venda := public.nf_venda_pedido(pedido);
begin
  update public.integracoes_plataforma
  set access_token = acesso, refresh_token = coalesce(renovacao, refresh_token), expira_em = expira
  where canal = 'tiny' and empresa_id = p.empresa_id;
end;
$$;

-- Grava o que o Tiny respondeu sobre a nota do pedido (cria na primeira vez).
-- Campos ausentes em dados ficam como estavam; mensagem sempre é a da última
-- tentativa. Devolve o id da nota (nome dos arquivos no Storage).
create function public.nf_venda_gravar(pedido uuid, dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pedidos_venda := public.nf_venda_pedido(pedido);
  tiny bigint := (dados ->> 'tiny_id')::bigint;
  atual public.notas_venda;
  nova_situacao text;
begin
  if tiny is null then
    raise exception 'Nota sem número no Tiny';
  end if;
  select * into atual from public.notas_venda where tiny_id = tiny;
  if atual.id is not null and atual.pedido_id <> p.id then
    raise exception 'Esta nota do Tiny pertence a outro pedido';
  end if;
  nova_situacao := coalesce(public.situacao_nf_tiny((dados ->> 'situacao_tiny')::integer), atual.situacao, 'gerada');

  if atual.id is null then
    insert into public.notas_venda (empresa_id, pedido_id, tiny_id, usuario_id) values (p.empresa_id, p.id, tiny, (select auth.uid()))
    returning * into atual;
  end if;
  update public.notas_venda n set
    modelo = coalesce((dados ->> 'modelo')::smallint, n.modelo),
    numero = coalesce(nullif(ltrim(dados ->> 'numero', '0'), ''), n.numero),
    serie = coalesce(nullif(dados ->> 'serie', ''), n.serie),
    chave_acesso = coalesce(nullif(dados ->> 'chave_acesso', ''), n.chave_acesso),
    situacao = nova_situacao,
    situacao_tiny = coalesce((dados ->> 'situacao_tiny')::smallint, n.situacao_tiny),
    mensagem = left(nullif(dados ->> 'mensagem', ''), 2000),
    valor = coalesce((dados ->> 'valor')::numeric, n.valor),
    emitida_em = coalesce((dados ->> 'emitida_em')::date, n.emitida_em),
    link = coalesce(nullif(dados ->> 'link', ''), n.link),
    danfe_arquivo = coalesce(nullif(dados ->> 'danfe_arquivo', ''), n.danfe_arquivo),
    xml_arquivo = coalesce(nullif(dados ->> 'xml_arquivo', ''), n.xml_arquivo),
    xml_cancelamento_arquivo = coalesce(nullif(dados ->> 'xml_cancelamento_arquivo', ''), n.xml_cancelamento_arquivo),
    contas_lancadas = coalesce((dados ->> 'contas_lancadas')::boolean, n.contas_lancadas),
    justificativa_cancelamento = coalesce(nullif(dados ->> 'justificativa_cancelamento', ''), n.justificativa_cancelamento),
    atualizada_em = now()
  where n.id = atual.id
  returning * into atual;

  -- Número da nota no pedido já na hora (a leitura do Tiny confirma depois).
  if atual.situacao = 'autorizada' and atual.numero is not null then
    update public.pedidos_venda set nota_fiscal = atual.numero where id = p.id and nota_fiscal is distinct from atual.numero;
  elsif atual.situacao = 'cancelada' then
    update public.pedidos_venda set nota_fiscal = null where id = p.id and nota_fiscal = atual.numero;
  end if;
  return atual.id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'situacao_nf_tiny(integer)', 'nf_venda_pedido(uuid)', 'nf_venda_acesso(uuid)',
    'nf_venda_tokens(uuid, text, text, timestamptz)', 'nf_venda_gravar(uuid, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- DANFE e XML das notas de venda no Storage, separados por CNPJ.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('notas-venda', 'notas-venda', false)
  on conflict (id) do nothing;

  create policy notas_venda_ver on storage.objects for select to authenticated
    using (bucket_id = 'notas-venda'
      and public.tem_permissao('vendas.pedidos', 'ver')
      and public.pode_ver_empresa(((storage.foldername(name))[1])::uuid));
  create policy notas_venda_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'notas-venda'
      and public.tem_permissao('vendas.pedidos', 'aprovar')
      and public.pode_ver_empresa(((storage.foldername(name))[1])::uuid));
  create policy notas_venda_trocar on storage.objects for update to authenticated
    using (bucket_id = 'notas-venda'
      and public.tem_permissao('vendas.pedidos', 'aprovar')
      and public.pode_ver_empresa(((storage.foldername(name))[1])::uuid));
end;
$$;
