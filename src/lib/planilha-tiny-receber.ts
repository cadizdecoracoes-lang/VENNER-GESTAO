// Leitura da planilha de contas a receber exportada do Tiny (Finanças ›
// Contas a receber › Exportar), para deixar a situação dos títulos daqui
// igual à do Tiny: recebido com a data e a conta, ou em aberto. Sem
// dependências do Next (testada em tests/).
import { comparavel, dataPlanilha, numeroPlanilha, type Celula } from "./planilha-tiny-pagar.ts";

export type { Celula };

export type LinhaTinyReceber = {
  cliente: string;
  vencimento: string;
  valor: number;
  situacao: "aberto" | "pago" | "parcial" | "cancelado";
  documento: string | null;
  conta: string | null;
  valor_recebido: number;
  recebimento: string | null;
};

// Nomes das colunas (sem acento e em minúsculas); a primeira que existir vale.
const COLUNAS = {
  vencimento: ["data de vencimento", "vencimento"],
  situacao: ["situacao"],
  valor: ["valor"],
  cliente: ["nome do cliente", "cliente", "nome"],
  documento: ["documento origem", "numero do documento", "documento"],
  conta: ["conta", "conta financeira"],
  valor_recebido: ["recebido", "valor recebido", "valor pago"],
  recebimento: ["data de recebimento", "data do recebimento", "data de pagamento", "data de liquidacao"],
} as const;

function situacao(v: Celula): LinhaTinyReceber["situacao"] {
  const s = comparavel(v);
  if (s.startsWith("cancel")) return "cancelado";
  if (s.startsWith("parcial")) return "parcial";
  if (s.startsWith("pag") || s.startsWith("receb") || s.startsWith("liquid") || s.startsWith("quit")) return "pago";
  return "aberto";
}

export type LeituraTinyReceber = { linhas: LinhaTinyReceber[]; ignoradas: number; erro?: string };

export function lerPlanilhaTinyReceber(dados: Celula[][]): LeituraTinyReceber {
  const cab = dados.slice(0, 15).findIndex((l) => l.some((c) => comparavel(c) === "data de vencimento"));
  if (cab < 0) return { linhas: [], ignoradas: 0, erro: 'Não achei a coluna "Data de vencimento". Use a planilha de contas a receber exportada do Tiny.' };
  const nomes = dados[cab].map(comparavel);
  const col = Object.fromEntries(
    Object.entries(COLUNAS).map(([k, ns]) => [k, ns.map((n) => nomes.indexOf(n)).find((i) => i >= 0) ?? -1]),
  ) as Record<keyof typeof COLUNAS, number>;
  const faltam = (["situacao", "valor", "cliente"] as const).filter((k) => col[k] < 0);
  const rotulos = { situacao: "Situação", valor: "Valor", cliente: "Nome do cliente" };
  if (faltam.length) return { linhas: [], ignoradas: 0, erro: `Faltam as colunas: ${faltam.map((k) => rotulos[k]).join(", ")}.` };

  const linhas: LinhaTinyReceber[] = [];
  let ignoradas = 0;
  for (const l of dados.slice(cab + 1)) {
    if (!l.some((c) => String(c ?? "").trim())) continue;
    const pega = (k: keyof typeof COLUNAS) => (col[k] < 0 ? null : l[col[k]]);
    const vencimento = dataPlanilha(pega("vencimento"));
    const valor = Math.round(numeroPlanilha(pega("valor")) * 100) / 100;
    const cliente = String(pega("cliente") ?? "").trim();
    if (!vencimento || !(valor > 0) || !cliente) {
      ignoradas++;
      continue;
    }
    linhas.push({
      cliente,
      vencimento,
      valor,
      situacao: situacao(pega("situacao")),
      documento: String(pega("documento") ?? "").trim() || null,
      conta: String(pega("conta") ?? "").trim() || null,
      valor_recebido: Math.round(numeroPlanilha(pega("valor_recebido")) * 100) / 100,
      recebimento: dataPlanilha(pega("recebimento")),
    });
  }
  return { linhas, ignoradas };
}
