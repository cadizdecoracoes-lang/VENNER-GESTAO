// Dados do planejamento lidos do banco (pedidos em produção, estrutura,
// saldos e postos), para as telas de compras, produção e o painel.
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import type { DadosPlanejamento } from "./planejamento";

export async function carregarPlanejamento(): Promise<DadosPlanejamento | null> {
  if (!supabaseConfigurado) return null;
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.rpc("dados_planejamento");
  if (error || !data) return null;
  return data as DadosPlanejamento;
}
