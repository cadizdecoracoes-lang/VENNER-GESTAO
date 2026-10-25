// Empresa (CNPJ) escolhida no seletor do topo, ou o consolidado do grupo.
// A escolha fica num cookie do navegador (lido também pelo seletor).
import { guardado } from "@/lib/navegacao";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { COOKIE_EMPRESA, type EmpresaResumo } from "./empresa-cookie";

export type { EmpresaResumo };

// Só as empresas que o perfil da pessoa enxerga (a RLS filtra).
export const carregarEmpresas = guardado(async (): Promise<EmpresaResumo[]> => {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("empresas").select("id, nome_fantasia, razao_social").eq("ativa", true).order("razao_social");
  return (data ?? []).map((e) => ({ id: e.id as string, nome: (e.nome_fantasia ?? e.razao_social) as string }));
});

// null = consolidado do grupo. Uma escolha que a pessoa não enxerga mais vira consolidado.
export async function empresaSelecionada(): Promise<EmpresaResumo | null> {
  const id = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE_EMPRESA}=`))
    ?.slice(COOKIE_EMPRESA.length + 1);
  if (!id) return null;
  return (await carregarEmpresas()).find((e) => e.id === id) ?? null;
}
