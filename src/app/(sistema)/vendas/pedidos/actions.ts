import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { lerNumero } from "@/lib/formato";
import { diasDaCondicao, dividirParcelas } from "@/lib/parcelas";
import { chamarFuncao } from "@/lib/supabase/funcoes";

type ItemForm = { item_id: string; quantidade: number; preco_unitario: number };

// O formulário manda os itens num campo "itens" (JSON), montado na tela.
export async function salvarPedido(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  let itens: ItemForm[];
  try {
    itens = JSON.parse(String(form.get("itens") ?? "[]"));
  } catch {
    return { erro: "Não foi possível ler os itens do pedido." };
  }
  itens = itens.filter((i) => i.item_id);
  if (itens.length === 0) return { erro: "Inclua pelo menos um produto." };
  if (itens.some((i) => !(i.quantidade > 0))) return { erro: "Toda quantidade precisa ser maior que zero." };
  if (itens.some((i) => !(i.preco_unitario >= 0))) return { erro: "Confira os preços: use números como 1.234,56." };
  if (new Set(itens.map((i) => i.item_id)).size !== itens.length)
    return { erro: "Há um produto repetido: junte as quantidades numa linha só." };

  const cliente = String(form.get("cliente_id") ?? "");
  const empresa = String(form.get("empresa_id") ?? "");
  if (!cliente) return { erro: "Escolha o cliente." };
  if (!id && !empresa) return { erro: "Escolha a empresa que vende." };
  const recebimento = Number(form.get("prazo_recebimento_dias") || 0);
  if (!Number.isInteger(recebimento) || recebimento < 0) return { erro: "O prazo de recebimento é um número de dias (0 = à vista)." };

  const dados = {
    id,
    empresa_id: empresa,
    cliente_id: cliente,
    data_pedido: String(form.get("data_pedido") || "") || null,
    prazo_entrega: String(form.get("prazo_entrega") || "") || null,
    condicao_pagamento: String(form.get("condicao_pagamento") ?? ""),
    prazo_recebimento_dias: recebimento,
    prioridade: Number(form.get("prioridade") || 0),
    observacao: String(form.get("observacao") ?? ""),
    itens,
  };
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.rpc("salvar_pedido_venda", { dados });
  if (error) return { erro: error.code === "42501" ? "Seu perfil não pode lançar pedidos nesta empresa." : mensagemErro(error) };
  revalidatePath("/vendas/pedidos");
  redirect(`/vendas/pedidos/pedido?id=${data}`);
}

export async function mudarEtapa(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const etapa = String(form.get("etapa_id") ?? "");
  if (!etapa) return { erro: "Escolha a etapa." };
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.from("pedidos_venda").update({ etapa_id: etapa }).eq("id", id).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath("/vendas/pedidos");
  revalidatePath(`/vendas/pedidos/pedido?id=${id}`);
  return { ok: Date.now() };
}

// Parcelas a receber do pedido: dias da condição de pagamento contados da data base.
export async function gerarParcelas(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const base = String(form.get("base") ?? "");
  const total = lerNumero(form.get("total"));
  const dias = diasDaCondicao(String(form.get("dias") ?? ""), 0);
  if (!base) return { erro: "Informe a data de onde contam os dias (normalmente a da nota ou da entrega)." };
  if (!(total > 0)) return { erro: "Informe o valor total a receber." };
  if (dias.length > 24) return { erro: "No máximo 24 parcelas." };

  const supabase = criarClienteNavegador();
  const { error } = await supabase.rpc("gerar_receber_pedido", { pedido: id, parcelas: dividirParcelas(total, dias, base) });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(`/vendas/pedidos/pedido?id=${id}`);
  revalidatePath("/financeiro/receber");
  return { ok: Date.now() };
}

// Nota fiscal pelo Tiny (Edge Function integracoes): emitir, trazer a
// situação, o DANFE e o XML, ou cancelar. Rejeição da SEFAZ volta gravada na
// nota (a tela mostra o motivo); só falha de comunicação vira erro aqui.
async function acaoNota(id: string, corpo: Record<string, unknown>): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = criarClienteNavegador();
  try {
    await chamarFuncao(supabase, "integracoes", { ...corpo, pedido: id });
  } catch (e) {
    revalidatePath(`/vendas/pedidos/pedido?id=${id}`);
    return { erro: e instanceof Error ? e.message : "O Tiny não respondeu. Tente de novo em alguns minutos." };
  }
  revalidatePath(`/vendas/pedidos/pedido?id=${id}`);
  revalidatePath("/vendas/pedidos");
  revalidatePath("/financeiro/receber");
  return { ok: Date.now() };
}

export const emitirNotaFiscal = (id: string, _: Estado, form: FormData) =>
  acaoNota(id, { acao: "emitir_nf", enviar_email: form.get("enviar_email") === "on" });

export const atualizarNotaFiscal = (id: string) => acaoNota(id, { acao: "atualizar_nf" });

export async function cancelarNotaFiscal(id: string, _: Estado, form: FormData): Promise<Estado> {
  const justificativa = String(form.get("justificativa") ?? "").trim();
  if (justificativa.length < 15) return { erro: "Escreva o motivo do cancelamento (pelo menos 15 letras)." };
  return acaoNota(id, { acao: "cancelar_nf", justificativa });
}
