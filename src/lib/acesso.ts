import { cache } from "react";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

export type Acao = "ver" | "criar" | "editar" | "aprovar" | "excluir";

export type Acesso = {
  email: string | null;
  // Login liberado pela diretoria (perfil atribuído e ativo).
  ativo: boolean;
  // "tela:acao". null no modo de demonstração, em que tudo aparece.
  permissoes: Set<string> | null;
};

// Uma consulta por requisição, compartilhada entre o layout e a página.
export const carregarAcesso = cache(async (): Promise<Acesso> => {
  if (!supabaseConfigurado) return { email: null, ativo: true, permissoes: null };
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { email: null, ativo: false, permissoes: new Set() };

  const [{ data: usuario }, { data: lista }] = await Promise.all([
    supabase.from("usuarios").select("ativo").eq("id", user.id).maybeSingle(),
    supabase.rpc("minhas_permissoes"),
  ]);
  const permissoes = new Set(
    ((lista ?? []) as { tela_codigo: string; acao: Acao }[]).map((p) => `${p.tela_codigo}:${p.acao}`),
  );
  return { email: user.email ?? null, ativo: !!usuario?.ativo, permissoes };
});

export function pode(acesso: Acesso, tela: string, acao: Acao): boolean {
  return acesso.permissoes === null || acesso.permissoes.has(`${tela}:${acao}`);
}

export function telasVisiveis(acesso: Acesso): string[] | null {
  if (acesso.permissoes === null) return null;
  return [...acesso.permissoes].filter((p) => p.endsWith(":ver")).map((p) => p.slice(0, -4));
}
