// Conferência com o Tiny: nomes e regras puras usadas pela tela
// (testadas em tests/conferencia-tiny.test.ts).

export type ModuloConferencia = "pagar" | "compras" | "notas_entrada" | "pedidos" | "notas_saida" | "receber" | "conciliacao";
export type Problema = "falta_aqui" | "sobra_aqui" | "diferente" | "so_aqui";

export const NOME_MODULO: Record<ModuloConferencia, string> = {
  pagar: "Contas a pagar",
  compras: "Ordens de compra",
  notas_entrada: "Notas de entrada",
  pedidos: "Pedidos de venda",
  notas_saida: "Notas de saída",
  receber: "Contas a receber",
  conciliacao: "Conciliação: banco x Tiny",
};

export const NOME_PROBLEMA: Record<Problema, string> = {
  falta_aqui: "Falta aqui",
  sobra_aqui: "Sobra aqui",
  diferente: "Diferente",
  so_aqui: "Lançado só aqui",
};

// O que o Tiny e o sistema contam em cada módulo (o resumo da tela).
export const BASE_RESUMO: Record<ModuloConferencia, { tiny: string; venner: string }> = {
  pagar: { tiny: "Em aberto no Tiny (saldo)", venner: "Em aberto aqui, vindos do Tiny" },
  receber: { tiny: "Em aberto no Tiny (saldo)", venner: "Em aberto aqui, vindos do Tiny" },
  pedidos: { tiny: "Pedidos do Tiny (sem cancelados no valor)", venner: "Pedidos daqui ligados ao Tiny" },
  compras: { tiny: "Ordens de compra de 2026 (sem canceladas no valor)", venner: "Pedidos de compra daqui ligados ao Tiny" },
  notas_saida: { tiny: "Notas de saída válidas de 2026", venner: "Pedidos daqui com número de nota" },
  notas_entrada: { tiny: "Notas de entrada válidas de 2026", venner: "Notas de fornecedor daqui (2026)" },
  conciliacao: { tiny: "Ligações ao extrato com título pago no Tiny", venner: "—" },
};

export type Diferenca = {
  empresa_id: string;
  modulo: ModuloConferencia;
  problema: Problema;
  campos: string | null;
  motivo: string | null;
  corrigivel: boolean;
  tiny_id: number | null;
  referencia: string | null;
  tiny_situacao: string | null;
  tiny_valor: number | null;
  tiny_data: string | null;
  venner_id: string | null;
  venner_situacao: string | null;
  venner_valor: number | null;
  venner_data: string | null;
};

// Onde abrir o registro daqui.
export function linkRegistro(d: Pick<Diferenca, "modulo" | "venner_id" | "venner_data">): string | null {
  if (!d.venner_id) return null;
  const dia = d.venner_data ? `de=${d.venner_data}&ate=${d.venner_data}&por=vencimento&` : "";
  switch (d.modulo) {
    case "pagar":
      return `/financeiro/pagar?${dia}ver=${d.venner_id}`;
    case "receber":
      return dia ? `/financeiro/receber?${dia.slice(0, -1)}` : "/financeiro/receber";
    case "pedidos":
    case "notas_saida":
      return `/vendas/pedidos/pedido?id=${d.venner_id}`;
    case "compras":
      return `/compras/pedidos/pedido?id=${d.venner_id}`;
    default:
      return null;
  }
}

// Agrupa os números do Tiny escolhidos por módulo, só os que têm correção.
export function escolhidosPorModulo(lista: Diferenca[], escolhidos: Set<string>): Partial<Record<ModuloConferencia, number[]>> {
  const saida: Partial<Record<ModuloConferencia, number[]>> = {};
  for (const d of lista) {
    if (!d.corrigivel || d.tiny_id === null || !escolhidos.has(chaveDiferenca(d))) continue;
    const l = (saida[d.modulo] ??= []);
    if (!l.includes(d.tiny_id)) l.push(d.tiny_id);
  }
  return saida;
}

export function chaveDiferenca(d: Pick<Diferenca, "modulo" | "problema" | "tiny_id" | "venner_id">): string {
  return `${d.modulo}:${d.problema}:${d.tiny_id ?? ""}:${d.venner_id ?? ""}`;
}
