-- =============================================================================
-- Venner Gestão · Gestão de usuários
-- Liberação de logins pela tela Configurações → Usuários: perfil, situação e
-- CNPJs que cada pessoa enxerga.
-- =============================================================================

-- Troca os CNPJs liberados de um usuário numa única transação.
-- Roda com as permissões de quem chama (a RLS de usuario_empresas vale).
create function public.definir_empresas_usuario(usuario uuid, empresas uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.tem_permissao('config.usuarios', 'editar') then
    raise exception 'Seu perfil não pode alterar usuários';
  end if;
  delete from public.usuario_empresas ue
  where ue.usuario_id = definir_empresas_usuario.usuario
    and ue.empresa_id <> all (coalesce(definir_empresas_usuario.empresas, '{}'));
  insert into public.usuario_empresas (usuario_id, empresa_id)
  select definir_empresas_usuario.usuario, e
  from unnest(coalesce(definir_empresas_usuario.empresas, '{}')) as e
  on conflict do nothing;
end;
$$;
revoke execute on function public.definir_empresas_usuario(uuid, uuid[]) from public, anon;
grant execute on function public.definir_empresas_usuario(uuid, uuid[]) to authenticated;

-- O sistema nunca fica sem ninguém que possa liberar usuários: a última pessoa
-- ativa com acesso total (perfil de todas as empresas) não pode ser desativada
-- nem trocar de perfil.
create function public.manter_um_administrador()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.usuarios u
    join public.perfis p on p.id = u.perfil_id
    where u.ativo and p.todas_empresas
  ) then
    raise exception 'O sistema precisa de ao menos um usuário ativo da diretoria';
  end if;
  return null;
end;
$$;
revoke execute on function public.manter_um_administrador() from public, anon, authenticated;

-- Só checa quando havia um administrador antes da mudança, para não travar a
-- liberação do primeiro usuário.
create trigger manter_um_administrador
  after update of ativo, perfil_id or delete on public.usuarios
  for each row
  when (old.ativo and old.perfil_id is not null)
  execute function public.manter_um_administrador();
