import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

export function criarClienteNavegador() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
