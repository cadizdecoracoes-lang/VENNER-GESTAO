"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { TIPOS_PLANO_CONTA } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

const CAMINHO = "/financeiro/categorias";

export async function salvarPlanoConta(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const codigo = String(form.get("codigo") ?? "").trim();
  const nome = String(form.get("nome") ?? "").trim();
  const pai = String(form.get("pai_id") ?? "") || null;
  let tipo = String(form.get("tipo") ?? "");
  if (!/^\d+(\.\d+)*$/.test(codigo)) return { erro: "O código usa só números separados por ponto, ex.: 4.07." };
  if (!nome) return { erro: "Informe o nome da categoria." };

  const supabase = await criarClienteServidor();
  if (pai) {
    // A subcategoria herda o tipo da categoria acima.
    const { data } = await supabase.from("plano_contas").select("tipo").eq("id", pai).maybeSingle();
    if (!data) return { erro: "A categoria acima não foi encontrada." };
    tipo = data.tipo as string;
  }
  if (!(tipo in TIPOS_PLANO_CONTA)) return { erro: "Escolha se a categoria é de receita ou despesa." };

  const dados = { codigo, nome, tipo, pai_id: pai, ativa: form.get("ativa") === "on" };
  const { data, error } = id
    ? await supabase.from("plano_contas").update(dados).eq("id", id).select("id")
    : await supabase.from("plano_contas").insert(dados).select("id");
  if (error) {
    if (error.code === "23505") return { erro: "Já existe uma categoria com esse código." };
    return { erro: mensagemErro(error) };
  }
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath(CAMINHO);
  redirect(CAMINHO);
}
