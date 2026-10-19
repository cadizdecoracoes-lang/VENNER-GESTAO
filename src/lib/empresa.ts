// Empresa (CNPJ) escolhida no seletor do topo, ou o consolidado do grupo.
// A escolha fica num cookie para as telas do servidor filtrarem os dados.
import { cookies } from "next/headers";
import { cache } from "react";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { COOKIE_EMPRESA, type EmpresaResumo } from "./empresa-cookie";

export type { EmpresaResumo };

// Só as empresas que o perfil da pessoa enxerga (a RLS filtra).
export const carregarEmpresas = cache(async (): Promise<EmpresaResumo[]> => {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("empresas").select("id, nome_fantasia, razao_social").eq("ativa", true).order("razao_social");
  return (data ?? []).map((e) => ({ id: e.id as string, nome: (e.nome_fantasia ?? e.razao_social) as string }));
});

// null = consolidado do grupo. Uma escolha que a pessoa não enxerga mais vira consolidado.
export const empresaSelecionada = cache(async (): Promise<EmpresaResumo | null> => {
  const id = (await cookies()).get(COOKIE_EMPRESA)?.value;
  if (!id) return null;
  return (await carregarEmpresas()).find((e) => e.id === id) ?? null;
});
