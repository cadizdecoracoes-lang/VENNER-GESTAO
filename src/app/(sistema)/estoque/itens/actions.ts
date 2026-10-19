"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { TIPOS_ITEM } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function salvarItem(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const codigo = String(form.get("codigo") ?? "").trim().toUpperCase();
  const descricao = String(form.get("descricao") ?? "").trim();
  const tipo = String(form.get("tipo"));
  if (!codigo || !descricao) return { erro: "Informe o código e a descrição." };
  if (!(tipo in TIPOS_ITEM)) return { erro: "Escolha o tipo do item." };

  const estoqueMinimo = lerNumero(form.get("estoque_minimo"));
  const prazo = lerNumero(form.get("prazo_reposicao_dias"));
  const custo = lerNumero(form.get("custo_medio"));
  if ([estoqueMinimo, prazo, custo].some((n) => Number.isNaN(n) || n < 0)) {
    return { erro: "Estoque mínimo, prazo e custo precisam ser números positivos." };
  }

  const dados = {
    codigo,
    descricao,
    tipo,
    unidade: String(form.get("unidade")),
    estoque_minimo: estoqueMinimo,
    prazo_reposicao_dias: Math.round(prazo),
    custo_medio: custo,
    ativo: form.get("ativo") === "on",
  };

  const supabase = await criarClienteServidor();
  const { data, error } = id
    ? await supabase.from("itens").update(dados).eq("id", id).select("id")
    : await supabase.from("itens").insert(dados).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath("/estoque/itens");
  redirect("/estoque/itens");
}
