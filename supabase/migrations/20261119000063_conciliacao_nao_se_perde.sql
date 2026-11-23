-- =============================================================================
-- Venner Gestão · A conciliação não se perde quando o Tiny mexe no título
--
-- Reclamação da Venner (19/11/2026): "a maioria do que eu fiz ontem terei que
-- refazer". Causa: o gatilho soltar_conciliado desligava a linha do extrato
-- sempre que um título conciliado deixava de estar pago. Quando o financeiro
-- estorna e refaz a baixa no Tiny (para acertar data, conta ou valor), o robô
-- lê o título em aberto no meio do caminho, a linha volta para pendente e a
-- ligação some, mesmo depois de o Tiny baixar o título de novo.
--
-- - Título do Tiny que volta para em aberto continua ligado à linha do
--   extrato. A tela da conciliação e a Conferência com o Tiny mostram a
--   diferença ("no Tiny está em aberto") até o Tiny baixar de novo. Só o
--   título cancelado/apagado no Tiny solta a linha. Título lançado só aqui
--   segue como antes.
-- - Uma vez agora: as ligações desfeitas pela leitura do Tiny (sem usuário) ou
--   perdidas ao excluir e importar de novo o mesmo extrato (mesma conta e
--   mesma chave da linha) desde 16/11 voltam, quando a linha está pendente e
--   os títulos estão pagos de novo e sem outra conciliação. Só conciliações de
--   uma linha (as feitas "juntas" com várias linhas ficam para refazer).
-- - Leitura do Tiny: contas a pagar sempre lidas (a data "parar de ler contas
--   a pagar" não vale mais, pela regra de 16/11) e a fila de detalhes começa
--   pelos títulos (a pagar e a receber), que são os que a conciliação usa;
--   antes o contas a pagar ficava no fim da fila, depois de pedidos e produtos.
-- =============================================================================

create or replace function public.soltar_titulo_conciliado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linha uuid;
begin
  if old.situacao = 'pago' and new.situacao <> 'pago' then
    -- Do Tiny e só reaberto: a ligação fica (a diferença aparece na tela).
    if old.tiny_id is not null and new.situacao <> 'cancelado' then
      return new;
    end if;
    select c.lancamento_id into linha from public.extrato_conciliacoes c
    where (tg_table_name = 'contas_pagar' and c.conta_pagar_id = old.id)
       or (tg_table_name = 'contas_receber' and c.conta_receber_id = old.id)
    limit 1;
    if linha is not null then
      delete from public.extrato_conciliacoes where lancamento_id = linha;
      update public.extrato_lancamentos set situacao = 'pendente', conciliado_por = null, conciliado_em = null where id = linha;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.soltar_titulo_conciliado() from public, anon, authenticated;

-- Contas a pagar sempre lidas; fila começa pelos títulos.
update public.integracao_robo set ler_pagar_ate = null where ler_pagar_ate is not null;

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
    'ler_pagar', true,
    'estado', r.estado,
    'pendentes', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', f.tipo, 'id', f.id_externo))
      from (select f2.tipo, f2.id_externo from public.integracao_fila f2
            where f2.integracao_id = integracao and f2.pendente
            order by case f2.tipo when 'pagar' then 1 when 'receber' then 1 when 'pedido' then 2 when 'compra' then 3 else 4 end, f2.atualizado_em
            limit greatest(1, least(limite, 200))) f), '[]'))
  into resposta
  from public.integracoes_plataforma i
  join public.integracao_robo r on r.integracao_id = i.id
  left join public.integracoes_aplicativos a on a.canal = 'tiny' and a.empresa_id = i.empresa_id
  where i.id = integracao;
  return resposta;
end;
$$;

-- -----------------------------------------------------------------------------
-- Uma vez agora: devolve as conciliações perdidas desde 16/11.
-- -----------------------------------------------------------------------------
create function public.recuperar_conciliacoes_tiny(desde timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  ev record;
  alvo uuid;
  situacao_alvo text;
  feitas integer := 0;
begin
  -- Última exclusão de ligações de cada linha (todas as ligações apagadas na
  -- mesma transação têm o mesmo horário na auditoria).
  for ev in
    with apagadas as (
      select a.criado_em, a.usuario_id, (a.dados_antes ->> 'lancamento_id')::uuid as linha,
        coalesce((a.dados_antes ->> 'grupo')::uuid, (a.dados_antes ->> 'lancamento_id')::uuid) as grupo,
        (a.dados_antes ->> 'conta_pagar_id')::uuid as pagar,
        (a.dados_antes ->> 'conta_receber_id')::uuid as receber,
        (a.dados_antes ->> 'valor')::numeric as valor
      from public.auditoria a
      where a.tabela = 'extrato_conciliacoes' and a.acao = 'DELETE' and a.criado_em >= desde
    ),
    ultima as (
      select linha, max(criado_em) as quando from apagadas group by linha
    )
    select u.linha, u.quando,
      bool_and(a.usuario_id is null) as pela_leitura,
      bool_and(a.grupo = a.linha) as uma_linha,
      array_agg(a.pagar) filter (where a.pagar is not null) as pagar,
      array_agg(a.receber) filter (where a.receber is not null) as receber,
      jsonb_agg(jsonb_build_object('pagar', a.pagar, 'receber', a.receber, 'valor', a.valor)) as itens
    from ultima u join apagadas a on a.linha = u.linha and a.criado_em = u.quando
    group by u.linha, u.quando
  loop
    if not ev.uma_linha then
      continue;
    end if;
    -- A linha ainda existe: só volta se foi a leitura do Tiny que desligou.
    -- Não existe mais (importação excluída): a mesma linha importada de novo.
    if exists (select 1 from public.extrato_lancamentos where id = ev.linha) then
      if not ev.pela_leitura then
        continue;
      end if;
      alvo := ev.linha;
    else
      -- Só se as ligações saíram junto com a linha (importação excluída) ou
      -- pela leitura do Tiny; desfeitas por uma pessoa antes não voltam.
      if not ev.pela_leitura and not exists (
        select 1 from public.auditoria a
        where a.tabela = 'extrato_lancamentos' and a.acao = 'DELETE' and a.registro_id = ev.linha::text and a.criado_em = ev.quando
      ) then
        continue;
      end if;
      select l.id into alvo
      from public.auditoria a
      join public.extrato_lancamentos l
        on l.conta_bancaria_id = (a.dados_antes ->> 'conta_bancaria_id')::uuid and l.chave = a.dados_antes ->> 'chave'
           and l.valor = (a.dados_antes ->> 'valor')::numeric
      where a.tabela = 'extrato_lancamentos' and a.acao = 'DELETE' and a.registro_id = ev.linha::text
      order by a.criado_em desc
      limit 1;
      if alvo is null then
        continue;
      end if;
    end if;
    select situacao::text into situacao_alvo from public.extrato_lancamentos where id = alvo;
    if situacao_alvo is distinct from 'pendente'
       or exists (select 1 from public.extrato_conciliacoes where lancamento_id = alvo) then
      continue;
    end if;
    -- Todos os títulos estão pagos de novo e sem outra conciliação.
    if exists (
      select 1 from public.contas_pagar p where p.id = any(coalesce(ev.pagar, '{}'))
        and (p.situacao <> 'pago'
             or exists (select 1 from public.extrato_conciliacoes c where c.conta_pagar_id = p.id))
    ) or exists (
      select 1 from public.contas_receber r where r.id = any(coalesce(ev.receber, '{}'))
        and (r.situacao <> 'pago'
             or exists (select 1 from public.extrato_conciliacoes c where c.conta_receber_id = r.id))
    ) or (select count(*) from public.contas_pagar where id = any(coalesce(ev.pagar, '{}')))
         + (select count(*) from public.contas_receber where id = any(coalesce(ev.receber, '{}')))
         <> coalesce(cardinality(ev.pagar), 0) + coalesce(cardinality(ev.receber), 0) then
      continue;
    end if;

    insert into public.extrato_conciliacoes (lancamento_id, grupo, conta_pagar_id, conta_receber_id, valor, efeito)
    select alvo, alvo, (i ->> 'pagar')::uuid, (i ->> 'receber')::uuid, (i ->> 'valor')::numeric, 'vinculou'
    from jsonb_array_elements(ev.itens) i;
    update public.extrato_lancamentos set situacao = 'conciliado', conciliado_em = now(),
      observacao = 'Conciliação recuperada em 19/11/2026 (tinha sido desfeita pela leitura do Tiny)'
    where id = alvo;
    feitas := feitas + 1;
  end loop;
  return feitas;
end;
$$;
revoke execute on function public.recuperar_conciliacoes_tiny(timestamptz) from public, anon, authenticated;

do $$
declare
  n integer;
begin
  n := public.recuperar_conciliacoes_tiny(timestamptz '2026-11-16 00:00:00-03');
  raise notice 'Conciliações recuperadas: %', n;
end;
$$;
