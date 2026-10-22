"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { FASES_PEDIDO } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function salvarEtapa(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const nome = String(form.get("nome") ?? "").trim();
  const ordem = Number(form.get("ordem"));
  const fase = String(form.get("fase") ?? "");
  if (!nome) return { erro: "Informe o nome da etapa." };
  if (!Number.isInteger(ordem)) return { erro: "A ordem precisa ser um número inteiro." };
  if (!(fase in FASES_PEDIDO)) return { erro: "Escolha a fase da etapa." };

  const dados = { nome, ordem, fase, ativa: form.get("ativa") === "on" };
  const supabase = await criarClienteServidor();
  const { data, error } = id
    ? await supabase.from("etapas_pedido").update(dados).eq("id", id).select("id")
    : await supabase.from("etapas_pedido").insert(dados).select("id");
  if (error) return { erro: error.code === "23505" ? "Já existe uma etapa com esse nome." : mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath("/vendas/etapas");
  redirect("/vendas/etapas");
}
