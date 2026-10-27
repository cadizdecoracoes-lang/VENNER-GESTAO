import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { totalPedidoCompra } from "@/lib/compras";
import { lerNumero } from "@/lib/formato";
import { diasDaCondicao, dividirParcelas } from "@/lib/parcelas";
import type { EtapaCompra } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

const CAMINHO = "/compras/pedidos";

type ItemForm = { item_id: string; quantidade: number; valor_unitario: number; aliquota_ipi: number; informacoes_adicionais: string };

// Cabeçalho, itens (JSON montado na tela) e parcelas, calculadas pelos dias
// da condição de pagamento a partir da data do pedido.
export async function salvarPedidoCompra(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  let itens: ItemForm[];
  try {
    itens = JSON.parse(String(form.get("itens") ?? "[]"));
  } catch {
    return { erro: "Não foi possível ler os produtos do pedido." };
  }
  itens = itens.filter((i) => i.item_id);
  if (itens.length === 0) return { erro: "Inclua pelo menos um produto." };
  if (itens.some((i) => !(i.quantidade > 0))) return { erro: "Toda quantidade precisa ser maior que zero." };
  if (itens.some((i) => !(i.valor_unitario >= 0) || !(i.aliquota_ipi >= 0)))
    return { erro: "Confira os valores: use números como 1.234,56." };
  if (new Set(itens.map((i) => i.item_id)).size !== itens.length)
    return { erro: "Há um produto repetido: junte as quantidades numa linha só." };

  const empresa = String(form.get("empresa_id") ?? "");
  if (!id && !empresa) return { erro: "Escolha a empresa que compra." };
  const dataPedido = String(form.get("data_pedido") || "");
  const frete = lerNumero(form.get("valor_frete")) || 0;
  const desconto = lerNumero(form.get("valor_desconto")) || 0;
  if (frete < 0 || desconto < 0) return { erro: "Frete e desconto não podem ser negativos." };

  // Parcelas pelos dias escritos ("30/60/90"); vazio = sem parcelas ainda.
  const textoDias = String(form.get("dias_parcelas") ?? "").trim();
  const { total } = totalPedidoCompra(itens, frete, desconto);
  const meio = String(form.get("meio_pagamento") ?? "");
  const dias = textoDias ? diasDaCondicao(textoDias, 0) : [];
  if (dias.length > 24) return { erro: "No máximo 24 parcelas." };
  const parcelas =
    dias.length && total > 0
      ? dividirParcelas(total, dias, dataPedido || new Date().toISOString().slice(0, 10)).map((p, i) => ({
          ...p,
          dias: dias[i],
          meio_pagamento: meio || null,
        }))
      : [];

  const dados = {
    id,
    empresa_id: empresa,
    fornecedor_id: String(form.get("fornecedor_id") ?? ""),
    categoria_id: String(form.get("categoria_id") ?? ""),
    data_pedido: dataPedido || null,
    data_prevista: String(form.get("data_prevista") || "") || null,
    condicao_pagamento: String(form.get("condicao_pagamento") ?? ""),
    frete_por_conta: String(form.get("frete_por_conta") ?? ""),
    transportador: String(form.get("transportador") ?? ""),
    valor_frete: frete,
    valor_desconto: desconto,
    observacoes: String(form.get("observacoes") ?? ""),
    observacoes_internas: String(form.get("observacoes_internas") ?? ""),
    itens,
    parcelas,
  };
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.rpc("salvar_pedido_compra", { dados });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}/pedido?id=${data}`);
}

// Avançar, devolver, aprovar ou cancelar. O banco confere quem pode e o motivo.
export async function mudarEtapaCompra(id: string, destino: EtapaCompra, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const motivo = String(form.get("motivo") ?? "").trim();
  const supabase = criarClienteNavegador();
  const { error } = await supabase.rpc("mudar_etapa_pedido_compra", { pedido: id, destino, motivo: motivo || null });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  revalidatePath(`${CAMINHO}/pedido?id=${id}`);
  return { ok: Date.now() };
}

export async function incluirOrcamento(pedido: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const fornecedor = String(form.get("fornecedor_id") ?? "");
  const valor = lerNumero(form.get("valor_total"));
  const prazo = String(form.get("prazo_entrega_dias") ?? "").trim();
  if (!fornecedor) return { erro: "Escolha o fornecedor do orçamento." };
  if (!(valor >= 0) || String(form.get("valor_total") ?? "").trim() === "") return { erro: "Informe o valor total orçado." };
  if (prazo && !(Number.isInteger(Number(prazo)) && Number(prazo) >= 0)) return { erro: "O prazo de entrega é um número de dias." };

  const supabase = criarClienteNavegador();
  const { error } = await supabase.from("pedido_compra_orcamentos").insert({
    pedido_id: pedido,
    fornecedor_id: fornecedor,
    valor_total: valor,
    prazo_entrega_dias: prazo ? Number(prazo) : null,
    condicao_pagamento: String(form.get("condicao_pagamento") ?? "").trim() || null,
    validade: String(form.get("validade") || "") || null,
    observacao: String(form.get("observacao") ?? "").trim() || null,
  });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(`${CAMINHO}/pedido?id=${pedido}`);
  return { ok: Date.now() };
}

export async function escolherOrcamento(pedido: string, orcamento: string): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = criarClienteNavegador();
  const { error } = await supabase.rpc("escolher_orcamento_compra", { orcamento });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(`${CAMINHO}/pedido?id=${pedido}`);
  return { ok: Date.now() };
}

export async function excluirOrcamento(pedido: string, orcamento: string): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.from("pedido_compra_orcamentos").delete().eq("id", orcamento).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(`${CAMINHO}/pedido?id=${pedido}`);
  return { ok: Date.now() };
}
