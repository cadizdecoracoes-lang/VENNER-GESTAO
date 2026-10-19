"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function salvarLocal(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const nome = String(form.get("nome") ?? "").trim();
  if (!nome) return { erro: "Informe o nome do local." };

  const dados = { nome, ativo: form.get("ativo") === "on" };
  const supabase = await criarClienteServidor();
  const { data, error } = id
    ? await supabase.from("locais_estoque").update(dados).eq("id", id).select("id")
    : await supabase.from("locais_estoque").insert(dados).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath("/estoque/locais");
  redirect("/estoque/locais");
}
