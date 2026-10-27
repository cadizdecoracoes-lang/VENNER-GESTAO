import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

const CAMINHO = "/financeiro/notas-fornecedor";
const BUCKET = "notas-fornecedor";

// Recebe a nota já lida no navegador (JSON) e o arquivo original. O arquivo vai
// para o Storage na pasta do CNPJ e a nota é lançada de uma vez pelo banco.
export async function importarNota(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(String(form.get("dados") ?? ""));
  } catch {
    return { erro: "Não foi possível ler os dados da nota. Escolha o arquivo de novo." };
  }
  const empresa = String(dados.empresa_id ?? "");
  if (!empresa) return { erro: "Escolha a empresa (CNPJ) que comprou." };
  if (!dados.numero) return { erro: "Informe o número da nota." };
  if (!dados.data_emissao) return { erro: "Informe a data de emissão." };
  if (!dados.fornecedor_id && !(dados.fornecedor as { documento?: string })?.documento) return { erro: "Informe o fornecedor." };
  if (!(Number(dados.valor_total) > 0)) return { erro: "Informe o valor total da nota." };
  if (!dados.pedido_compra_id && String(dados.justificativa_sem_pedido ?? "").trim().length < 15)
    return { erro: "Escolha o pedido de compra aprovado ou escreva a justificativa de lançar sem pedido (pelo menos 15 letras)." };
  const parcelas = (dados.parcelas ?? []) as { valor: number; vencimento: string }[];
  if (parcelas.some((p) => !p.vencimento || !(p.valor > 0))) return { erro: "Cada parcela precisa de vencimento e valor." };

  const supabase = criarClienteNavegador();
  const id = crypto.randomUUID();
  const arquivo = form.get("arquivo");
  let caminho: string | null = null;
  if (arquivo instanceof File && arquivo.size > 0) {
    const ext = arquivo.name.toLowerCase().endsWith(".pdf") ? "pdf" : "xml";
    caminho = `${empresa}/${id}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, {
      contentType: ext === "pdf" ? "application/pdf" : "application/xml",
    });
    if (error) return { erro: `Não foi possível guardar o arquivo da nota: ${error.message}` };
  }

  const { error } = await supabase.rpc("registrar_nota_fornecedor", { dados: { ...dados, id, arquivo: caminho } });
  if (error) {
    if (caminho) await supabase.storage.from(BUCKET).remove([caminho]);
    if (error.code === "23505") {
      return { erro: "Esta nota já foi lançada (mesma chave de acesso, ou mesmo número e série deste fornecedor)." };
    }
    return { erro: mensagemErro(error) };
  }
  revalidatePath(CAMINHO);
  revalidatePath("/financeiro/pagar");
  revalidatePath("/compras/pedidos");
  redirect(`${CAMINHO}/nota?id=${id}`);
}

// Vincula o produto do fornecedor a um item do sistema. O banco memoriza o
// vínculo e aplica nas demais notas desse fornecedor.
export async function vincularItem(nota: string, linha: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const item = String(form.get("item_id") ?? "");
  const fator = lerNumero(form.get("fator"));
  if (!item) return { erro: "Escolha o item do sistema." };
  if (!(fator > 0)) return { erro: "A conversão precisa ser maior que zero (1 se a unidade é a mesma)." };

  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.from("nota_fornecedor_itens").update({ item_id: item, fator }).eq("id", linha).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(`${CAMINHO}/nota?id=${nota}`);
  redirect(`${CAMINHO}/nota?id=${nota}`);
}

export async function darEntrada(nota: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const local = String(form.get("local_id") ?? "");
  if (!local) return { erro: "Escolha o local de estoque." };
  const supabase = criarClienteNavegador();
  const { error } = await supabase.rpc("dar_entrada_nota", { nota, local });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  revalidatePath(`${CAMINHO}/nota?id=${nota}`);
  return { ok: Date.now() };
}
