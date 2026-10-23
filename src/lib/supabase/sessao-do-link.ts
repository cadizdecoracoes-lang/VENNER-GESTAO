import { criarClienteNavegador } from "./client";

// Links antigos do Supabase trazem a sessão depois do "#" do endereço, que só o
// navegador enxerga. Guarda essa sessão nos cookies e limpa o endereço.
export async function guardarSessaoDoLink(): Promise<"recovery" | "outro" | null> {
  const dados = new URLSearchParams(window.location.hash.slice(1));
  const access_token = dados.get("access_token");
  const refresh_token = dados.get("refresh_token");
  if (!access_token || !refresh_token) return null;
  const { error } = await criarClienteNavegador().auth.setSession({ access_token, refresh_token });
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (error) return null;
  return dados.get("type") === "recovery" ? "recovery" : "outro";
}
