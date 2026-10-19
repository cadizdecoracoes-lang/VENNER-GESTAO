export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

// Enquanto o projeto Supabase da Venner não existir, o sistema abre em modo de
// demonstração (sem login), para que as telas possam ser revisadas na prévia.
export const supabaseConfigurado = SUPABASE_URL !== "" && SUPABASE_KEY !== "";
