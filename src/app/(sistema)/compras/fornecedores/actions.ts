import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { lerPessoa } from "@/lib/pessoa";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

export async function salvarFornecedor(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const pessoa = lerPessoa(form);
  if ("erro" in pessoa) return pessoa;
  const prazo = lerNumero(form.get("prazo_entrega_dias"));
  if (!Number.isInteger(prazo) || prazo < 0) return { erro: "O prazo de entrega precisa ser um número inteiro de dias." };

  const dados = {
    ...pessoa.dados,
    prazo_entrega_dias: prazo,
    condicao_pagamento: String(form.get("condicao_pagamento") ?? "").trim() || null,
  };
  const supabase = criarClienteNavegador();
  const { data, error } = id
    ? await supabase.from("fornecedores").update(dados).eq("id", id).select("id")
    : await supabase.from("fornecedores").insert(dados).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath("/compras/fornecedores");
  redirect("/compras/fornecedores");
}
