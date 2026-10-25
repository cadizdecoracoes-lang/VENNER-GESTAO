// O que as Edge Functions têm em comum: endereço e chaves do próprio projeto
// (o Supabase coloca no ambiente de cada função), cliente do banco e respostas.
import { createClient } from "@supabase/supabase-js";
import { ambiente } from "./ambiente.ts";

export const SUPABASE_URL = ambiente("SUPABASE_URL");

// Projetos novos trazem as chaves em JSON (SUPABASE_PUBLISHABLE_KEYS e
// SUPABASE_SECRET_KEYS); os antigos, em SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.
function chave(antiga: string, nova: string): string {
  if (ambiente(antiga)) return ambiente(antiga);
  try {
    const lista = JSON.parse(ambiente(nova) || "{}") as Record<string, string>;
    return lista.default ?? Object.values(lista)[0] ?? "";
  } catch {
    return "";
  }
}

const sem = { auth: { persistSession: false, autoRefreshToken: false } };

// Cliente com o login de quem chamou: o banco confere o perfil em cada função.
export function clienteDoPedido(pedido: Request) {
  const autorizacao = pedido.headers.get("authorization") ?? "";
  return createClient(SUPABASE_URL, chave("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS"), {
    ...sem,
    global: { headers: autorizacao ? { authorization: autorizacao } : {} },
  });
}

// Cliente sem login (o robô se identifica pela chave que o banco gerou).
export const clientePublico = () => createClient(SUPABASE_URL, chave("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS"), sem);

// Cliente do próprio projeto, só para funções do banco liberadas ao service_role.
export const clienteServico = () => createClient(SUPABASE_URL, chave("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"), sem);

// As telas chamam as funções de outro endereço (o do site).
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

export const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
