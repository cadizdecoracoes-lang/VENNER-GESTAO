// Leitura da planilha de contas a pagar exportada do Tiny (Finanças › Contas
// a pagar › Exportar), para conferir a situação e a data do pagamento dos
// títulos que vieram de lá. Sem dependências do Next (testada em tests/).

export type Celula = string | number | boolean | Date | null | undefined;

export type LinhaTinyPagar = {
  fornecedor: string;
  vencimento: string;
  valor: number;
  situacao: "aberto" | "pago" | "parcial" | "cancelado";
  documento: string | null;
  conta: string | null;
  valor_pago: number;
  pagamento: string | null;
};

const comparavel = (v: Celula) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const COLUNAS = {
  vencimento: "data de vencimento",
  situacao: "situacao",
  valor: "valor",
  fornecedor: "fornecedor",
  documento: "numero do documento",
  conta: "conta",
  valor_pago: "valor pago",
  pagamento: "data de pagamento",
} as const;

// "19/10/2026", "2026-10-19" ou data da planilha → "2026-10-19".
export function dataPlanilha(v: Celula): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const t = String(v ?? "").trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

export function numeroPlanilha(v: Celula): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v ?? "").replace(/[R$\s]/g, "");
  if (!t) return 0;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : 0;
}

function situacao(v: Celula): LinhaTinyPagar["situacao"] {
  const s = comparavel(v);
  if (s.startsWith("cancel")) return "cancelado";
  if (s.startsWith("parcial")) return "parcial";
  if (s.startsWith("pag") || s.startsWith("liquid") || s.startsWith("quit")) return "pago";
  return "aberto";
}

export type LeituraTinyPagar = { linhas: LinhaTinyPagar[]; ignoradas: number; erro?: string };

export function lerPlanilhaTinyPagar(dados: Celula[][]): LeituraTinyPagar {
  const cab = dados.slice(0, 15).findIndex((l) => l.some((c) => comparavel(c) === COLUNAS.vencimento));
  if (cab < 0) return { linhas: [], ignoradas: 0, erro: 'Não achei a coluna "Data de vencimento". Use a planilha de contas a pagar exportada do Tiny.' };
  const nomes = dados[cab].map(comparavel);
  const col = Object.fromEntries(Object.entries(COLUNAS).map(([k, n]) => [k, nomes.indexOf(n)])) as Record<keyof typeof COLUNAS, number>;
  const faltam = (["situacao", "valor", "fornecedor"] as const).filter((k) => col[k] < 0);
  const rotulos = { situacao: "Situação", valor: "Valor", fornecedor: "Fornecedor" };
  if (faltam.length) return { linhas: [], ignoradas: 0, erro: `Faltam as colunas: ${faltam.map((k) => rotulos[k]).join(", ")}.` };

  const linhas: LinhaTinyPagar[] = [];
  let ignoradas = 0;
  for (const l of dados.slice(cab + 1)) {
    if (!l.some((c) => String(c ?? "").trim())) continue;
    const pega = (k: keyof typeof COLUNAS) => (col[k] < 0 ? null : l[col[k]]);
    const vencimento = dataPlanilha(pega("vencimento"));
    const valor = Math.round(numeroPlanilha(pega("valor")) * 100) / 100;
    const fornecedor = String(pega("fornecedor") ?? "").trim();
    if (!vencimento || !(valor > 0) || !fornecedor) {
      ignoradas++;
      continue;
    }
    linhas.push({
      fornecedor,
      vencimento,
      valor,
      situacao: situacao(pega("situacao")),
      documento: String(pega("documento") ?? "").trim() || null,
      conta: String(pega("conta") ?? "").trim() || null,
      valor_pago: Math.round(numeroPlanilha(pega("valor_pago")) * 100) / 100,
      pagamento: dataPlanilha(pega("pagamento")),
    });
  }
  return { linhas, ignoradas };
}
