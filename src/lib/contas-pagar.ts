// Regras das contas a pagar usadas pela tela (sem dependências do Next):
// status de cada título, lançamentos parcelados e recorrentes e a composição
// do pagamento (principal + juros + multa - desconto).
import { somarDias } from "./datas.ts";

export type StatusPagar = "vencido" | "a_vencer" | "pago" | "cancelado";

// Vencido = em aberto com vencimento antes de hoje; a vencer = em aberto de hoje em diante.
export function statusDoTitulo(t: { situacao: string; vencimento: string }, hoje: string): StatusPagar {
  if (t.situacao === "pago") return "pago";
  if (t.situacao === "cancelado") return "cancelado";
  return t.vencimento < hoje ? "vencido" : "a_vencer";
}

// Mantém o dia; em meses mais curtos cai no último dia (31/01 -> 28/02).
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

export const INTERVALOS = {
  mensal: "Mensal",
  quinzenal: "A cada 15 dias",
  semanal: "Semanal",
  bimestral: "A cada 2 meses",
  trimestral: "A cada 3 meses",
  anual: "Anual",
} as const;
export type Intervalo = keyof typeof INTERVALOS;

export function proximaData(base: string, intervalo: Intervalo, vez: number): string {
  switch (intervalo) {
    case "quinzenal":
      return somarDias(base, 15 * vez);
    case "semanal":
      return somarDias(base, 7 * vez);
    case "bimestral":
      return somarMeses(base, 2 * vez);
    case "trimestral":
      return somarMeses(base, 3 * vez);
    case "anual":
      return somarMeses(base, 12 * vez);
    default:
      return somarMeses(base, vez);
  }
}

export type TipoLancamento = "unica" | "parcelada" | "recorrente";
export type Lancamento = { parcela: string | null; valor: number; vencimento: string };

// Única: um título. Parcelada: o valor TOTAL dividido em N (centavos que sobram
// vão na 1ª parcela), "1/N". Recorrente: o MESMO valor repetido N vezes, "rec. 1/N".
export function gerarLancamentos(p: {
  tipo: TipoLancamento;
  valor: number;
  vencimento: string;
  quantidade: number;
  intervalo: Intervalo;
}): Lancamento[] {
  const n = p.tipo === "unica" ? 1 : Math.max(1, Math.trunc(p.quantidade));
  if (n === 1) return [{ parcela: null, valor: arred(p.valor), vencimento: p.vencimento }];
  const cent = Math.round(p.valor * 100);
  const parte = Math.floor(cent / n);
  return Array.from({ length: n }, (_, i) => ({
    parcela: p.tipo === "parcelada" ? `${i + 1}/${n}` : `rec. ${i + 1}/${n}`,
    valor: p.tipo === "parcelada" ? (i === 0 ? cent - parte * (n - 1) : parte) / 100 : arred(p.valor),
    vencimento: proximaData(p.vencimento, p.intervalo, i),
  }));
}

const arred = (v: number) => Math.round(v * 100) / 100;

// Valor que sai do banco: principal + juros + multa - desconto.
export function totalPago(p: { principal: number; juros?: number; multa?: number; desconto?: number }): number {
  return arred(p.principal + (p.juros ?? 0) + (p.multa ?? 0) - (p.desconto ?? 0));
}
