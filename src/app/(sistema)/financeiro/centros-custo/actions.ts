"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function salvarCentro(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const codigo = String(form.get("codigo") ?? "").trim().toUpperCase();
  const nome = String(form.get("nome") ?? "").trim();
  if (!codigo) return { erro: "Informe o código do centro de custo." };
  if (!nome) return { erro: "Informe o nome do centro de custo." };

  const dados = { codigo, nome, ativo: form.get("ativo") === "on" };
  const supabase = await criarClienteServidor();
  const { data, error } = id
    ? await supabase.from("centros_custo").update(dados).eq("id", id).select("id")
    : await supabase.from("centros_custo").insert(dados).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath("/financeiro/centros-custo");
  redirect("/financeiro/centros-custo");
}
