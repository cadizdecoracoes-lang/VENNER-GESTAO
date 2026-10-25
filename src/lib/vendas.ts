// Consultas comuns às telas de pedidos de venda e ao painel.
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import type { FasePedido } from "./rotulos";

export type Etapa = { id: string; nome: string; ordem: number; fase: FasePedido; ativa: boolean };

export type PedidoResumo = {
  id: string;
  numero: number;
  empresa_id: string;
  cliente_id: string;
  canal: string;
  data_pedido: string;
  prazo_entrega: string | null;
  condicao_pagamento: string | null;
  prazo_recebimento_dias: number;
  prioridade: number;
  etapa_id: string;
  etapa_desde: string;
  observacao: string | null;
  etapa_nome: string;
  etapa_ordem: number;
  fase: FasePedido;
  valor_total: number;
  quantidade_itens: number;
  dias_atraso: number;
  clientes: { nome: string; nome_fantasia: string | null; cidade: string | null; uf: string | null } | null;
};

export const CAMPOS_PEDIDO =
  "id, numero, empresa_id, cliente_id, canal, data_pedido, prazo_entrega, condicao_pagamento, prazo_recebimento_dias, prioridade, etapa_id, etapa_desde, observacao, etapa_nome, etapa_ordem, fase, valor_total, quantidade_itens, dias_atraso, clientes(nome, nome_fantasia, cidade, uf)";

export const nomeCliente = (p: PedidoResumo) => p.clientes?.nome_fantasia || p.clientes?.nome || "—";

export async function carregarEtapas(): Promise<Etapa[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("etapas_pedido").select("id, nome, ordem, fase, ativa").order("ordem");
  return (data ?? []) as Etapa[];
}

export async function carregarClientes(): Promise<{ id: string; nome: string }[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("clientes").select("id, nome, nome_fantasia").eq("ativo", true).order("nome").limit(5000);
  return (data ?? []).map((c) => ({ id: c.id, nome: c.nome_fantasia || c.nome }));
}

export type Produto = { id: string; codigo: string; descricao: string; unidade: string; preco_venda: number };

export async function carregarProdutosVenda(): Promise<Produto[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("itens")
    .select("id, codigo, descricao, unidade, preco_venda")
    .eq("tipo", "produto_acabado")
    .eq("ativo", true)
    .order("codigo")
    .limit(5000);
  return (data ?? []) as Produto[];
}

// Pedidos que entraram no período na primeira etapa da fase Produção (a
// confirmação do cliente). Base de "aprovados na semana".
export async function confirmadosNoPeriodo(etapas: Etapa[], de: string, ate: string): Promise<{ etapa: Etapa | null; ids: Set<string> }> {
  const etapa = etapas.filter((e) => e.fase === "producao").sort((a, b) => a.ordem - b.ordem)[0] ?? null;
  if (!supabaseConfigurado || !etapa) return { etapa, ids: new Set() };
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("pedido_etapas_historico")
    .select("pedido_id")
    .eq("etapa_id", etapa.id)
    .gte("em", `${de}T00:00:00-03:00`)
    .lte("em", `${ate}T23:59:59.999-03:00`)
    .limit(5000);
  return { etapa, ids: new Set((data ?? []).map((h) => h.pedido_id as string)) };
}
