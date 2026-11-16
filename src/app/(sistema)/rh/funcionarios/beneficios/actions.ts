import { mensagemErro, SEM_BANCO, type Estado } from "@/lib/erros";
import { redirect, revalidatePath } from "@/lib/navegacao";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

type Lote = { empresa_id: string; tipo: string; competencia: string; linhas: unknown[] };

// Grava os lotes lidos (VT por aba, auxílio por PDF). Cada lote troca o mês
// inteiro daquele tipo.
export async function importarBeneficios(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  let lotes: Lote[];
  try {
    lotes = JSON.parse(String(form.get("dados") ?? ""));
  } catch {
    return { erro: "Não foi possível ler os arquivos. Escolha de novo." };
  }
  if (!Array.isArray(lotes) || !lotes.length) return { erro: "Nada para gravar." };
  const supabase = criarClienteNavegador();
  let gravados = 0;
  for (const l of lotes) {
    const { error } = await supabase.rpc("importar_beneficios", {
      empresa: l.empresa_id,
      tipo_beneficio: l.tipo,
      competencia_mes: l.competencia,
      linhas: l.linhas,
    });
    if (error) return { erro: `${gravados ? `${gravados} linhas gravadas, mas o resto parou: ` : ""}${mensagemErro(error)}` };
    gravados += l.linhas.length;
  }
  revalidatePath("/rh/funcionarios/beneficios");
  redirect(`/rh/funcionarios/beneficios?mes=${lotes.map((l) => l.competencia).sort().at(-1)!.slice(0, 7)}`);
}

export async function excluirBeneficios(empresa: string, tipo: string, competencia: string, _: Estado, __: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const { error } = await criarClienteNavegador().rpc("excluir_beneficios", { empresa, tipo_beneficio: tipo, competencia_mes: competencia });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath("/rh/funcionarios/beneficios");
  return { ok: Date.now() };
}
