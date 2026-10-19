// Listas usadas nos lançamentos do financeiro (notas e contas a pagar).
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

export type OpcaoCodigo = { id: string; codigo: string; nome: string };

// Só as categorias de despesa sem subcategorias aceitam lançamento.
export async function carregarCategoriasDespesa(): Promise<OpcaoCodigo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("plano_contas").select("id, codigo, nome, pai_id, ativa").eq("tipo", "despesa").order("codigo");
  const lista = data ?? [];
  const maes = new Set(lista.map((c) => c.pai_id).filter(Boolean));
  return lista.filter((c) => c.ativa && !maes.has(c.id)).map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome }));
}

export async function carregarCentrosCusto(): Promise<OpcaoCodigo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("centros_custo").select("id, codigo, nome").eq("ativo", true).order("codigo");
  return (data ?? []) as OpcaoCodigo[];
}

export async function carregarFornecedores(): Promise<{ id: string; nome: string; documento: string | null }[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("fornecedores")
    .select("id, nome, nome_fantasia, documento")
    .eq("ativo", true)
    .order("nome")
    .limit(5000);
  return (data ?? []).map((f) => ({ id: f.id, nome: f.nome_fantasia || f.nome, documento: f.documento }));
}
