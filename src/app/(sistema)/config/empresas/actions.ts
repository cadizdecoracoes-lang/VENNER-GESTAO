"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { cnpjValido, somenteDigitos } from "@/lib/formato";
import { REGIMES } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function salvarEmpresa(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const cnpj = somenteDigitos(form.get("cnpj"));
  if (!cnpjValido(cnpj)) return { erro: "CNPJ inválido. Confira os 14 dígitos." };
  const regime = String(form.get("regime_tributario"));
  if (!(regime in REGIMES)) return { erro: "Escolha o regime tributário." };
  const razao = String(form.get("razao_social") ?? "").trim();
  if (!razao) return { erro: "Informe a razão social." };

  const dados = {
    razao_social: razao,
    nome_fantasia: String(form.get("nome_fantasia") ?? "").trim() || null,
    cnpj,
    regime_tributario: regime,
    atividades: form.getAll("atividades").map(String),
    ativa: form.get("ativa") === "on",
  };

  const supabase = await criarClienteServidor();
  const { data, error } = id
    ? await supabase.from("empresas").update(dados).eq("id", id).select("id")
    : await supabase.from("empresas").insert(dados).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  // O seletor de empresa no topo também lista as empresas.
  revalidatePath("/", "layout");
  redirect("/config/empresas");
}
