import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerPessoa } from "@/lib/pessoa";
import { CANAIS } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

export async function salvarCliente(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const pessoa = lerPessoa(form);
  if ("erro" in pessoa) return pessoa;
  const canal = String(form.get("canal") ?? "venda_direta");
  if (!(canal in CANAIS)) return { erro: "Escolha o canal de venda." };

  const dados = { ...pessoa.dados, canal };
  const supabase = criarClienteNavegador();
  const { data, error } = id
    ? await supabase.from("clientes").update(dados).eq("id", id).select("id")
    : await supabase.from("clientes").insert(dados).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath("/vendas/clientes");
  redirect("/vendas/clientes");
}
