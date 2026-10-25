// Listas usadas nos lançamentos do financeiro (notas e contas a pagar).
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

export type OpcaoCodigo = { id: string; codigo: string; nome: string };

// Só as categorias sem subcategorias aceitam lançamento.
async function carregarCategorias(tipo: "despesa" | "receita"): Promise<OpcaoCodigo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("plano_contas").select("id, codigo, nome, pai_id, ativa").eq("tipo", tipo).order("codigo");
  const lista = data ?? [];
  const maes = new Set(lista.map((c) => c.pai_id).filter(Boolean));
  return lista.filter((c) => c.ativa && !maes.has(c.id)).map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome }));
}

export const carregarCategoriasDespesa = () => carregarCategorias("despesa");
export const carregarCategoriasReceita = () => carregarCategorias("receita");

export async function carregarContasBancarias(empresa: string): Promise<{ id: string; nome: string }[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("contas_bancarias")
    .select("id, nome")
    .eq("empresa_id", empresa)
    .eq("ativa", true)
    .order("tipo")
    .order("nome");
  return data ?? [];
}

export async function carregarLocais(): Promise<{ id: string; nome: string }[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("locais_estoque").select("id, nome").eq("ativo", true).order("nome");
  return data ?? [];
}

export async function carregarCentrosCusto(): Promise<OpcaoCodigo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("centros_custo").select("id, codigo, nome").eq("ativo", true).order("codigo");
  return (data ?? []) as OpcaoCodigo[];
}

export async function carregarFornecedores(): Promise<{ id: string; nome: string; documento: string | null }[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("fornecedores")
    .select("id, nome, nome_fantasia, documento")
    .eq("ativo", true)
    .order("nome")
    .limit(5000);
  return (data ?? []).map((f) => ({ id: f.id, nome: f.nome_fantasia || f.nome, documento: f.documento }));
}
