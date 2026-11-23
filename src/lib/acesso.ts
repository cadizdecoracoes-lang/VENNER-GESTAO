import { guardado } from "@/lib/navegacao";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

export type Acao = "ver" | "criar" | "editar" | "aprovar" | "excluir";

export type Acesso = {
  email: string | null;
  // Login liberado pela diretoria (perfil atribuído e ativo).
  ativo: boolean;
  // "tela:acao". null no modo de demonstração, em que tudo aparece.
  permissoes: Set<string> | null;
};

// Uma consulta só, compartilhada entre o layout e as telas (refeita depois de gravar).
export const carregarAcesso = guardado(async (): Promise<Acesso> => {
  if (!supabaseConfigurado) return { email: null, ativo: true, permissoes: null };
  const supabase = criarClienteNavegador();
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

// Contas a pagar e a receber (e as notas de fornecedor, que geram contas a
// pagar) são lançadas, editadas, baixadas e excluídas só no Tiny (regra do
// Alexandre, 23/11/2026): nessas telas o sistema só mostra. O banco barra
// também (bloquear_titulo_tiny).
const SO_NO_TINY = new Set(["financeiro.pagar", "financeiro.receber", "financeiro.notas_fornecedor"]);

export function pode(acesso: Acesso, tela: string, acao: Acao): boolean {
  if (acao !== "ver" && SO_NO_TINY.has(tela)) return false;
  return acesso.permissoes === null || acesso.permissoes.has(`${tela}:${acao}`);
}

export function telasVisiveis(acesso: Acesso): string[] | null {
  if (acesso.permissoes === null) return null;
  return [...acesso.permissoes].filter((p) => p.endsWith(":ver")).map((p) => p.slice(0, -4));
}
