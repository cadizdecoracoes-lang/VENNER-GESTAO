// Benefícios pagos fora do holerite (custo e controle da folha): leitura da
// planilha do vale-transporte (uma aba por mês) e do PDF do pedido de
// auxílio-alimentação do portal Caixa Pré-pagos. Funções puras, testadas em
// tests/beneficios.test.ts. Conta e chave PIX da planilha não são lidas.

export type TipoBeneficio = "vt" | "va" | "outro";

export const ROTULO_BENEFICIO: Record<TipoBeneficio, string> = {
  vt: "Vale-transporte",
  va: "Auxílio-alimentação",
  outro: "Outro benefício",
};

export type LinhaBeneficio = {
  nome: string;
  cpf: string | null;
  valor: number;
  dias: number | null;
  periodo_de: string | null;
  periodo_ate: string | null;
  observacao: string | null;
  arquivo: string;
};

export type LoteBeneficio = {
  tipo: TipoBeneficio;
  competencia: string; // AAAA-MM-01
  origem: string; // aba ou arquivo
  linhas: LinhaBeneficio[];
  avisos: string[];
};

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const sem = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function cpfDe(v: unknown): string | null {
  const d = digitos(v);
  if (!d) return null;
  // CPF lido como número perde o zero da frente.
  const c = d.padStart(11, "0");
  return c.length === 11 ? c : null;
}

const dataIso = (dd: string, mm: string, aaaa: string) => `${aaaa}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;

export function valorBr(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const t = String(v ?? "")
    .replace(/R\$\s*/i, "")
    .trim();
  if (!/^-?[\d.]+(,\d+)?$|^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Mês pelo nome ("VT AGOSTO", "Mes 09", "setembro/2026").
export function mesDoTexto(texto: string): number | null {
  const t = sem(texto);
  const i = MESES.findIndex((m) => t.includes(m));
  if (i >= 0) return i + 1;
  const n = t.match(/(?:mes|mês|^|\D)(0?[1-9]|1[0-2])(?:\D|$)/);
  return n ? Number(n[1]) : null;
}

// ---------------------------------------------------------------------------
// Planilha do VT: cada aba é um mês. Cabeçalho com "CPF" e "TOTAL"; a coluna
// do VT traz o período ("VT DO DIA 11/08/2026 ATÉ O DIA 02/09/2026 TOTAL DE
// DIAS 17 DIAS"). Texto na coluna do VT (FÉRIAS, ATESTADO) e as anotações à
// direita viram a observação.
// ---------------------------------------------------------------------------
export function lerAbaVT(nomeAba: string, linhas: unknown[][], arquivo: string, anoPadrao: number): LoteBeneficio | null {
  const avisos: string[] = [];
  const iCab = linhas.findIndex((l) => l.some((c) => /^cpf:?$/i.test(String(c ?? "").trim())));
  if (iCab < 0) return null;
  const cab = linhas[iCab].map((c) => sem(String(c ?? "")).trim());
  const colCpf = cab.findIndex((c) => /^cpf:?$/.test(c));
  const colTotal = cab.findIndex((c) => /^total$/.test(c));
  const colVt = cab.findIndex((c) => c.startsWith("vt"));
  const colPix = cab.findIndex((c) => c.includes("pix") || c.includes("conta"));
  const textoVt = String(linhas[iCab][colVt] ?? "");
  const periodo = sem(textoVt).match(/(\d{1,2})\/(\d{1,2})\/(\d{4}).*?(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const dias = sem(textoVt).match(/total de dias\s*(\d+)/);
  const periodoDe = periodo ? dataIso(periodo[1], periodo[2], periodo[3]) : null;
  const periodoAte = periodo ? dataIso(periodo[4], periodo[5], periodo[6]) : null;
  const mes = mesDoTexto(nomeAba) ?? (periodoDe ? Number(periodoDe.slice(5, 7)) : null);
  if (!mes) {
    avisos.push(`${arquivo} › ${nomeAba.trim()}: não deu para saber o mês pelo nome da aba.`);
    return null;
  }
  let ano = periodoDe ? Number(periodoDe.slice(0, 4)) : anoPadrao;
  // Período que começa em dezembro e aba de janeiro: ano seguinte.
  if (periodoDe && mes < Number(periodoDe.slice(5, 7)) - 6) ano += 1;
  const competencia = `${ano}-${String(mes).padStart(2, "0")}-01`;

  const saida: LinhaBeneficio[] = [];
  for (const l of linhas.slice(iCab + 1)) {
    const nome = String(l[0] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (nome.length < 2 || !/[a-z]/i.test(nome)) continue;
    const total = colTotal >= 0 ? valorBr(l[colTotal]) : null;
    const vt = colVt >= 0 ? valorBr(l[colVt]) : null;
    const notas: string[] = [];
    if (colVt >= 0 && vt === null && String(l[colVt] ?? "").trim()) notas.push(String(l[colVt]).trim());
    const fim = Math.max(colTotal, colVt, colCpf, colPix);
    for (const c of l.slice(fim + 1)) {
      const t = String(c ?? "").trim();
      if (t && /[a-z0-9]/i.test(t) && t.length > 1 && !/^ok$/i.test(t)) notas.push(t);
    }
    if (total !== null && vt !== null && Math.abs(total - vt) > 0.009) notas.push(`na coluna do VT: ${vt.toLocaleString("pt-BR")}`);
    saida.push({
      nome,
      cpf: colCpf >= 0 ? cpfDe(l[colCpf]) : null,
      valor: total ?? vt ?? 0,
      dias: null,
      periodo_de: periodoDe,
      periodo_ate: periodoAte,
      observacao: notas.join(" · ") || null,
      arquivo,
    });
  }
  if (!saida.length) return null;
  if (dias) avisos.push(`${nomeAba.trim()}: período de ${dias[1]} dias úteis.`);
  return { tipo: "vt", competencia, origem: `${arquivo} › ${nomeAba.trim()}`, linhas: saida, avisos };
}

// ---------------------------------------------------------------------------
// PDF do pedido de auxílio do portal Caixa Pré-pagos: para cada pessoa vêm o
// nome, o CPF, o produto, a situação e o valor, e o centro de custo.
// ---------------------------------------------------------------------------
const ROTULOS_VA = /^(emissao|cartao|cpf|matricula|produto|status|valor|local de|entrega|custo|centro de|alimentacao|resultados da busca|pedidos)/;

export function lerTextoVA(linhasPdf: string[], arquivo: string, competencia: string): LoteBeneficio | null {
  const linhas = linhasPdf.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const avisos: string[] = [];
  const saida: LinhaBeneficio[] = [];
  const reCpf = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
  linhas.forEach((linha, i) => {
    const cpf = linha.match(reCpf);
    if (!cpf) return;
    // Nome: a linha de texto mais próxima acima do CPF que não é rótulo.
    let nome: string | null = null;
    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      const t = linhas[j];
      if (reCpf.test(t)) break;
      if (/^[A-Za-zÀ-ÿ'. ]{5,}$/.test(t) && !ROTULOS_VA.test(sem(t))) {
        nome = t;
        break;
      }
    }
    // Valor e situação: na mesma linha do CPF ou logo abaixo.
    const perto = linhas.slice(i, i + 4).join(" ");
    const valor = perto.match(/R\$\s*([\d.]+,\d{2})/);
    const situacao = perto.match(/(Agendado|Emitido|Processado|Pago|Cancelado|Pendente|Liberado)/i);
    if (!nome || !valor) {
      avisos.push(`${arquivo}: CPF ${cpf[0]} sem nome ou valor legível; confira.`);
      return;
    }
    saida.push({
      nome,
      cpf: cpfDe(cpf[0]),
      valor: valorBr(valor[1]) ?? 0,
      dias: null,
      periodo_de: null,
      periodo_ate: null,
      observacao: situacao ? situacao[1][0].toUpperCase() + situacao[1].slice(1).toLowerCase() : null,
      arquivo,
    });
  });
  if (!saida.length) return null;
  return { tipo: "va", competencia, origem: arquivo, linhas: saida, avisos };
}

// Competência sugerida pelo nome do arquivo ("V A Mes 09.pdf" → 2026-09-01).
export function competenciaDoArquivo(nome: string, hoje: string): string {
  const mes = mesDoTexto(nome.replace(/\.[a-z]+$/i, "")) ?? Number(hoje.slice(5, 7));
  const ano = Number(hoje.slice(0, 4)) - (mes > Number(hoje.slice(5, 7)) ? 1 : 0);
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

// Linhas de texto de uma página do PDF, agrupando os pedaços pela altura.
export function linhasDasPecas(pecas: { x: number; y: number; s: string }[]): string[] {
  const grupos: { y: number; pecas: { x: number; s: string }[] }[] = [];
  for (const p of [...pecas].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const g = grupos.find((x) => Math.abs(x.y - p.y) < 3);
    if (g) g.pecas.push(p);
    else grupos.push({ y: p.y, pecas: [p] });
  }
  return grupos.map((g) =>
    g.pecas
      .sort((a, b) => a.x - b.x)
      .map((p) => p.s)
      .join(" "),
  );
}

export async function lerPdfVA(arquivo: File, competencia: string): Promise<LoteBeneficio> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const linhas: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const conteudo = await (await pdf.getPage(p)).getTextContent();
    linhas.push(
      ...linhasDasPecas(
        conteudo.items
          .filter((i) => "str" in i && i.str.trim())
          .map((i) => {
            const t = i as { str: string; transform: number[] };
            return { x: t.transform[4], y: t.transform[5], s: t.str };
          }),
      ),
    );
  }
  const lote = lerTextoVA(linhas, arquivo.name, competencia);
  if (!lote) throw new Error(`${arquivo.name}: nenhuma pessoa com CPF e valor encontrada neste PDF.`);
  return lote;
}

export async function lerPlanilhaVT(arquivo: File, anoPadrao: number): Promise<LoteBeneficio[]> {
  const { default: lerXlsx, readSheetNames } = await import("read-excel-file");
  const abas = await readSheetNames(arquivo);
  const lotes: LoteBeneficio[] = [];
  for (const aba of abas) {
    const linhas = (await lerXlsx(arquivo, { sheet: aba })) as unknown[][];
    const lote = lerAbaVT(aba, linhas, arquivo.name, anoPadrao);
    if (lote) lotes.push(lote);
  }
  if (!lotes.length) throw new Error(`${arquivo.name}: nenhuma aba com a lista de funcionários (coluna CPF) encontrada.`);
  return lotes;
}
