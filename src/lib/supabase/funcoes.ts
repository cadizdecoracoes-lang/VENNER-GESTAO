// Chamada às Edge Functions do Supabase (supabase/functions) com o login de
// quem está usando. As funções devolvem { erro } com o texto para a tela.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function chamarFuncao<T>(supabase: SupabaseClient, nome: string, corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo });
  let resposta = data as (T & { erro?: string }) | null;
  if (error) {
    // Erro HTTP: a mensagem da função vem no corpo da resposta.
    const contexto = (error as { context?: Response }).context;
    resposta = contexto ? await contexto.json().catch(() => null) : null;
    if (!resposta?.erro) throw new Error("O Supabase não respondeu. Tente de novo em alguns minutos.");
  }
  if (resposta?.erro) throw new Error(resposta.erro);
  return resposta as T;
}
