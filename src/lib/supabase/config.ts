// Aceita o endereço do projeto colado com sobras ("/rest/v1/", barra no fim,
// espaços): o Supabase só responde no endereço raiz (https://xxxx.supabase.co).
function enderecoRaiz(valor: string) {
  const limpo = valor.trim();
  if (!limpo) return "";
  try {
    return new URL(limpo).origin;
  } catch {
    return limpo;
  }
}

export const SUPABASE_URL = enderecoRaiz(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

// Enquanto o projeto Supabase da Venner não existir, o sistema abre em modo de
// demonstração (sem login), para que as telas possam ser revisadas na prévia.
export const supabaseConfigurado = SUPABASE_URL !== "" && SUPABASE_KEY !== "";
