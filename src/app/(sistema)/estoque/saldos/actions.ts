import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

// Cada campo "contagem_<item>" preenchido é um item contado; vazio fica como está.
export async function registrarInventario(local: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const contagens: { item_id: string; quantidade: number }[] = [];
  for (const [campo, valor] of form.entries()) {
    if (!campo.startsWith("contagem_") || String(valor).trim() === "") continue;
    const quantidade = lerNumero(valor);
    if (!Number.isFinite(quantidade) || quantidade < 0) return { erro: "Confira as quantidades: só números de zero para cima." };
    contagens.push({ item_id: campo.slice("contagem_".length), quantidade });
  }
  if (contagens.length === 0) return { erro: "Preencha a quantidade contada de pelo menos um item." };
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.rpc("registrar_inventario", {
    local,
    contagens,
    observacao: String(form.get("observacao") ?? "") || null,
  });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath("/estoque/saldos");
  redirect(`/estoque/saldos?ajustes=${data}&contados=${contagens.length}`);
}
