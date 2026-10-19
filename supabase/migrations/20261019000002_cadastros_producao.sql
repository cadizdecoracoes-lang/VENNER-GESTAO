-- =============================================================================
-- Venner Gestão · Cadastros de produção
-- Permissões do usuário logado (menu e botões), histórico automático de regime
-- tributário, e regras da ficha técnica: versões, aprovação e estrutura sem ciclos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissões do usuário logado. As telas usam para montar o menu e decidir
-- quais botões mostrar; quem barra de fato continua sendo a RLS.
-- -----------------------------------------------------------------------------
create function public.minhas_permissoes()
returns table (tela_codigo text, acao public.acao_permissao)
language sql
stable
security definer
set search_path = ''
as $$
  select p.tela_codigo, p.acao
  from public.usuarios u
  join public.perfil_permissoes p on p.perfil_id = u.perfil_id
  where u.id = (select auth.uid())
    and u.ativo;
$$;
revoke execute on function public.minhas_permissoes() from public, anon;
grant execute on function public.minhas_permissoes() to authenticated;

-- -----------------------------------------------------------------------------
-- Regime tributário: toda troca fica registrada com a data, para a visão
-- tributária saber o regime de cada CNPJ em cada período.
-- -----------------------------------------------------------------------------
create function public.registrar_regime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.regime_tributario is distinct from old.regime_tributario then
    insert into public.empresas_regime_historico (empresa_id, regime_tributario, vigencia_inicio)
    values (new.id, new.regime_tributario, current_date)
    on conflict (empresa_id, vigencia_inicio) do update set regime_tributario = excluded.regime_tributario;
  end if;
  return new;
end;
$$;
revoke execute on function public.registrar_regime() from public, anon, authenticated;

create trigger registrar_regime
  after insert or update of regime_tributario on public.empresas
  for each row execute function public.registrar_regime();

-- -----------------------------------------------------------------------------
-- Ficha técnica
-- -----------------------------------------------------------------------------

-- No máximo um rascunho por produto: alterações entram sempre numa nova versão.
create unique index fichas_um_rascunho_idx on public.fichas_tecnicas (item_id) where status = 'rascunho';

-- A estrutura não pode ter ciclos em nenhum nível: se o componente (ou algo
-- abaixo dele) já usa o produto, a montagem seria infinita.
create or replace function public.validar_componente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  produto uuid;
begin
  select f.item_id into produto from public.fichas_tecnicas f where f.id = new.ficha_id;
  if new.componente_id = produto then
    raise exception 'O produto não pode ser componente da própria ficha técnica';
  end if;
  if exists (
    with recursive abaixo(item) as (
      select new.componente_id
      union
      select c.componente_id
      from abaixo a
      join public.fichas_tecnicas f on f.item_id = a.item and f.status <> 'substituida'
      join public.ficha_componentes c on c.ficha_id = f.id
    )
    select 1 from abaixo where item = produto
  ) then
    raise exception 'Estrutura circular: este componente já usa o produto na própria estrutura';
  end if;
  return new;
end;
$$;
revoke execute on function public.validar_componente() from public, anon, authenticated;

-- Ficha ativa ou substituída é registro do que foi produzido: só o rascunho muda.
create function public.bloquear_ficha_fechada()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ficha uuid := case when tg_op = 'DELETE' then old.ficha_id else new.ficha_id end;
begin
  if exists (select 1 from public.fichas_tecnicas f where f.id = ficha and f.status <> 'rascunho') then
    raise exception 'Só o rascunho da ficha técnica pode ser alterado. Crie uma nova versão.';
  end if;
  if tg_op = 'UPDATE' and new.ficha_id <> old.ficha_id then
    raise exception 'Não é possível mover a linha para outra ficha técnica';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger bloquear_ficha_fechada
  before insert or update or delete on public.ficha_componentes
  for each row execute function public.bloquear_ficha_fechada();
create trigger bloquear_ficha_fechada
  before insert or update or delete on public.ficha_operacoes
  for each row execute function public.bloquear_ficha_fechada();

-- Quem edita a ficha pode tirar linhas do rascunho; apagar exige só "editar"
-- porque o gatilho acima já impede mexer em versões ativas ou substituídas.
drop policy excluir on public.ficha_componentes;
create policy excluir on public.ficha_componentes for delete to authenticated
  using (public.tem_permissao('producao.ficha_tecnica', 'editar'));
drop policy excluir on public.ficha_operacoes;
create policy excluir on public.ficha_operacoes for delete to authenticated
  using (public.tem_permissao('producao.ficha_tecnica', 'editar'));

-- Cabeçalho da ficha: fora do rascunho nada muda, exceto ativa → substituída.
-- Mudar o status exige a ação "aprovar" na tela de ficha técnica.
create function public.validar_ficha()
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
     and (new.quantidade_base, new.observacao) is distinct from (old.quantidade_base, old.observacao) then
    raise exception 'Só o rascunho da ficha técnica pode ser alterado. Crie uma nova versão.';
  end if;

  if new.status <> old.status then
    if not ((old.status = 'rascunho' and new.status = 'ativa') or (old.status = 'ativa' and new.status = 'substituida')) then
      raise exception 'Mudança de status inválida na ficha técnica';
    end if;
    if not public.tem_permissao('producao.ficha_tecnica', 'aprovar') then
      raise exception 'Seu perfil não pode aprovar fichas técnicas';
    end if;
  end if;
  return new;
end;
$$;

create trigger validar_ficha
  before insert or update on public.fichas_tecnicas
  for each row execute function public.validar_ficha();

-- Rascunho apagado sim; versão ativa ou substituída nunca.
create function public.bloquear_exclusao_ficha()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'rascunho' then
    raise exception 'Fichas ativas ou substituídas não podem ser apagadas';
  end if;
  return old;
end;
$$;

create trigger bloquear_exclusao_ficha
  before delete on public.fichas_tecnicas
  for each row execute function public.bloquear_exclusao_ficha();

-- Abre o rascunho da próxima versão, copiando a versão ativa (ou a mais recente).
-- Se já existe rascunho, devolve ele. Roda com as permissões de quem chama.
create function public.nova_versao_ficha(item uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  rascunho uuid;
  base public.fichas_tecnicas;
begin
  select f.id into rascunho from public.fichas_tecnicas f
  where f.item_id = nova_versao_ficha.item and f.status = 'rascunho';
  if rascunho is not null then
    return rascunho;
  end if;

  select f.* into base from public.fichas_tecnicas f
  where f.item_id = nova_versao_ficha.item
  order by (f.status = 'ativa') desc, f.versao desc
  limit 1;

  insert into public.fichas_tecnicas (item_id, versao, quantidade_base, observacao)
  values (
    nova_versao_ficha.item,
    coalesce((select max(f.versao) from public.fichas_tecnicas f where f.item_id = nova_versao_ficha.item), 0) + 1,
    coalesce(base.quantidade_base, 1),
    base.observacao
  )
  returning id into rascunho;

  if base.id is not null then
    insert into public.ficha_componentes (ficha_id, componente_id, quantidade, perda_percentual)
    select rascunho, c.componente_id, c.quantidade, c.perda_percentual
    from public.ficha_componentes c where c.ficha_id = base.id;

    insert into public.ficha_operacoes (ficha_id, sequencia, descricao, posto_id, tempo_setup_min, tempo_execucao_min, instrucoes)
    select rascunho, o.sequencia, o.descricao, o.posto_id, o.tempo_setup_min, o.tempo_execucao_min, o.instrucoes
    from public.ficha_operacoes o where o.ficha_id = base.id;
  end if;

  return rascunho;
end;
$$;
revoke execute on function public.nova_versao_ficha(uuid) from public, anon;
grant execute on function public.nova_versao_ficha(uuid) to authenticated;

-- Ativa o rascunho: a versão ativa anterior vira substituída, na mesma transação.
create function public.ativar_ficha(ficha uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  produto uuid;
begin
  select f.item_id into produto from public.fichas_tecnicas f
  where f.id = ativar_ficha.ficha and f.status = 'rascunho';
  if produto is null then
    raise exception 'Só um rascunho pode ser ativado';
  end if;
  if not exists (select 1 from public.ficha_componentes c where c.ficha_id = ativar_ficha.ficha) then
    raise exception 'A ficha técnica precisa de ao menos um componente para ser ativada';
  end if;

  update public.fichas_tecnicas set status = 'substituida'
  where item_id = produto and status = 'ativa';

  update public.fichas_tecnicas set status = 'ativa', vigencia_inicio = current_date
  where id = ativar_ficha.ficha;
end;
$$;
revoke execute on function public.ativar_ficha(uuid) from public, anon;
grant execute on function public.ativar_ficha(uuid) to authenticated;
