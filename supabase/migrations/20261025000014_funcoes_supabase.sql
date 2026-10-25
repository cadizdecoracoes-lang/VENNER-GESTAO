-- =============================================================================
-- Integrações nas Edge Functions do Supabase (primeira etapa para tirar o
-- sistema do Cloudflare).
--
-- - O robô do Tiny passa a ser a Edge Function robo-tiny do próprio projeto.
--   disparar_robo_tiny chama <projeto>.supabase.co/functions/v1/robo-tiny
--   quando o endereço guardado é o do Supabase; enquanto não for, segue
--   chamando o endereço antigo (/integracoes/robo), para não parar a leitura.
--   registrar_endereco_robo (só a função robo-tiny, com a chave de serviço)
--   troca o endereço de todas as contas do Tiny; a publicação no GitHub chama
--   depois de cada deploy das funções.
-- - Ligar conta do Tiny, Mercado Livre ou Shopee: o estado da autorização fica
--   15 minutos em ligacoes_pendentes (antes ficava num cookie do Cloudflare).
--   iniciar_ligacao guarda; destino_ligacao devolve só o endereço da tela para
--   onde a pessoa volta; concluir_ligacao entrega o verificador uma vez, só
--   para quem começou a ligação.
-- =============================================================================

create table public.ligacoes_pendentes (
  estado text primary key check (length(estado) >= 32),
  canal text not null check (canal in ('tiny', 'mercado_livre', 'shopee')),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null,
  voltar text not null,
  verificador text not null check (length(verificador) >= 32),
  criada_em timestamptz not null default now()
);
alter table public.ligacoes_pendentes enable row level security;
revoke all on public.ligacoes_pendentes from anon, authenticated;

create function public.iniciar_ligacao(canal text, empresa uuid, voltar text, estado text, verificador text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.pode_ligar_integracao() and public.pode_ver_empresa(empresa)) then
    raise exception 'Seu perfil não pode ligar contas das plataformas nesta empresa';
  end if;
  -- Endereço da tela de integrações do próprio sistema, sem parâmetros.
  if voltar !~ '^(https://[a-zA-Z0-9.-]+|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)(/[a-zA-Z0-9._~/-]*)?$' then
    raise exception 'Endereço de volta inválido';
  end if;
  delete from public.ligacoes_pendentes where criada_em < now() - interval '15 minutes';
  insert into public.ligacoes_pendentes (estado, canal, empresa_id, usuario_id, voltar, verificador)
  values (estado, canal, empresa, (select auth.uid()), voltar, verificador);
end;
$$;

-- Usada pela volta da plataforma, que não tem login: devolve só o endereço da tela.
create function public.destino_ligacao(estado text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select l.voltar from public.ligacoes_pendentes l
  where l.estado = destino_ligacao.estado and l.criada_em > now() - interval '15 minutes';
$$;

create function public.concluir_ligacao(estado text, canal text)
returns table (empresa_id uuid, verificador text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    delete from public.ligacoes_pendentes l
    where l.estado = concluir_ligacao.estado and l.canal = concluir_ligacao.canal
      and l.usuario_id = (select auth.uid()) and l.criada_em > now() - interval '15 minutes'
    returning l.empresa_id, l.verificador;
end;
$$;

do $$
begin
  revoke execute on function public.iniciar_ligacao(text, uuid, text, text, text) from public, anon;
  grant execute on function public.iniciar_ligacao(text, uuid, text, text, text) to authenticated;
  revoke execute on function public.destino_ligacao(text) from public;
  grant execute on function public.destino_ligacao(text) to anon, authenticated;
  revoke execute on function public.concluir_ligacao(text, text) from public, anon;
  grant execute on function public.concluir_ligacao(text, text) to authenticated;
end;
$$;

-- -----------------------------------------------------------------------------
-- Robô do Tiny na Edge Function robo-tiny.
-- -----------------------------------------------------------------------------
create function public.registrar_endereco_robo(endereco text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if endereco !~ '^https://[a-z0-9]+\.supabase\.co$' then
    raise exception 'Endereço do Supabase inválido';
  end if;
  update public.integracao_robo set endereco = registrar_endereco_robo.endereco
  where integracao_robo.endereco is distinct from registrar_endereco_robo.endereco;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.registrar_endereco_robo(text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.registrar_endereco_robo(text) to service_role;
  end if;
end;
$$;

create or replace function public.disparar_robo_tiny()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select rb.integracao_id, rb.chave, rb.endereco
    from public.integracao_robo rb join public.integracoes_plataforma i on i.id = rb.integracao_id
    where i.canal = 'tiny' and rb.endereco is not null and (rb.executando_ate is null or rb.executando_ate < now())
  loop
    perform net.http_post(
      url := r.endereco || case when r.endereco ~ '\.supabase\.co$' then '/functions/v1/robo-tiny' else '/integracoes/robo' end,
      body := jsonb_build_object('integracao', r.integracao_id),
      headers := jsonb_build_object('content-type', 'application/json', 'x-chave-robo', r.chave),
      timeout_milliseconds := 120000);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.disparar_robo_tiny() from public, anon, authenticated;
