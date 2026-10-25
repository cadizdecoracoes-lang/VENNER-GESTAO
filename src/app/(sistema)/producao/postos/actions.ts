import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

export async function salvarPosto(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const nome = String(form.get("nome") ?? "").trim();
  const custoHora = lerNumero(form.get("custo_hora"));
  const capacidade = lerNumero(form.get("capacidade_horas_dia"));
  if (!nome) return { erro: "Informe o nome do posto." };
  if (Number.isNaN(custoHora) || custoHora < 0) return { erro: "O custo hora precisa ser um número positivo." };
  if (Number.isNaN(capacidade) || capacidade <= 0 || capacidade > 24) return { erro: "A capacidade precisa ficar entre 0 e 24 horas por dia." };

  const dados = { nome, custo_hora: custoHora, capacidade_horas_dia: capacidade, ativo: form.get("ativo") === "on" };
  const supabase = criarClienteNavegador();
  const { data, error } = id
    ? await supabase.from("postos_trabalho").update(dados).eq("id", id).select("id")
    : await supabase.from("postos_trabalho").insert(dados).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath("/producao/postos");
  redirect("/producao/postos");
}
