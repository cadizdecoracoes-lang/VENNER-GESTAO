// Pedidos de compra: tipos e listas usadas nas telas de compras e na nota do fornecedor.
import type { EtapaCompra } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

export type PedidoCompraResumo = {
  id: string;
  numero: number;
  empresa_id: string;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  categoria_id: string | null;
  data_pedido: string;
  data_prevista: string | null;
  condicao_pagamento: string | null;
  frete_por_conta: string | null;
  transportador: string | null;
  valor_frete: number;
  valor_desconto: number;
  observacoes: string | null;
  observacoes_internas: string | null;
  etapa: EtapaCompra;
  etapa_desde: string;
  aprovado_em: string | null;
  quantidade_itens: number;
  valor_itens: number;
  valor_ipi: number;
  valor_total: number;
  quantidade_notas: number;
  valor_notas: number;
};

export const CAMPOS_PEDIDO_COMPRA =
  "id, numero, empresa_id, fornecedor_id, fornecedor_nome, categoria_id, data_pedido, data_prevista, condicao_pagamento, frete_por_conta, transportador, valor_frete, valor_desconto, observacoes, observacoes_internas, etapa, etapa_desde, aprovado_em, quantidade_itens, valor_itens, valor_ipi, valor_total, quantidade_notas, valor_notas";

export type MaterialCompra = { id: string; codigo: string; descricao: string; unidade: string; custo_medio: number };

// Tudo o que se compra (matéria-prima, embalagem, revenda, consumo...): itens ativos.
export async function carregarItensCompra(): Promise<MaterialCompra[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("itens")
    .select("id, codigo, descricao, unidade, custo_medio")
    .eq("ativo", true)
    .order("codigo")
    .limit(5000);
  return (data ?? []) as MaterialCompra[];
}

// Pedidos aprovados (ou já recebidos em parte) que podem receber uma nota.
export async function carregarPedidosParaNota(): Promise<
  { id: string; numero: number; empresa_id: string; fornecedor_id: string | null; fornecedor_nome: string | null; valor_total: number; etapa: EtapaCompra }[]
> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("pedidos_compra_resumo")
    .select("id, numero, empresa_id, fornecedor_id, fornecedor_nome, valor_total, etapa")
    .in("etapa", ["aprovado", "recebido"])
    .order("numero", { ascending: false })
    .limit(2000);
  return (data ?? []) as never;
}

// Mesma conta da visão pedidos_compra_resumo: itens + IPI + frete − desconto.
export function totalPedidoCompra(
  itens: { quantidade: number; valor_unitario: number; aliquota_ipi: number }[],
  frete: number,
  desconto: number,
): { itens: number; ipi: number; total: number } {
  const linhas = itens.map((i) => Math.round((i.quantidade || 0) * (i.valor_unitario || 0) * 100) / 100);
  const soma = linhas.reduce((s, v) => s + v, 0);
  const ipi = Math.round(itens.reduce((s, i, k) => s + (linhas[k] * (i.aliquota_ipi || 0)) / 100, 0) * 100) / 100;
  return { itens: soma, ipi, total: Math.round((soma + ipi + (frete || 0) - (desconto || 0)) * 100) / 100 };
}

export const COR_ETAPA_COMPRA: Record<EtapaCompra, "neutra" | "primaria" | "sucesso" | "alerta"> = {
  criacao: "neutra",
  orcamento: "primaria",
  aprovacao: "alerta",
  aprovado: "sucesso",
  recebido: "neutra",
  cancelado: "neutra",
};
