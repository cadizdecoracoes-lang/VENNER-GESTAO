// Leitura do extrato bancário (OFX, planilha Excel/CSV ou texto do PDF) e
// sugestão de conciliação com os títulos de pagar e receber.
// Sem dependências do Next, para rodar também nos testes (node --test).
import { diasEntre } from "./datas.ts";
import { lerData, lerValor, type Celula } from "./plataformas/planilha.ts";

export type LinhaExtrato = {
  data: string;
  descricao: string;
  documento: string | null;
  // Positivo = entrou na conta; negativo = saiu.
  valor: number;
  saldo: number | null;
  // Identificação do lançamento no banco (FITID do OFX), quando houver.
  id_banco: string | null;
  // A leitura não teve certeza se é entrada ou saída (PDF sem C/D).
  sinalIncerto?: boolean;
  // PDF lido por imagem (OCR) ou dia cujo saldo não fecha: conferir a linha.
  conferir?: boolean;
  // Aplicação/resgate automático do banco (ex.: BB Rende Fácil).
  aplicacao?: boolean;
};

export type ExtratoLido = {
  linhas: LinhaExtrato[];
  saldoFinal: number | null;
  // Saldo antes do primeiro lançamento, quando o extrato informa.
  saldoInicial?: number | null;
  conta: { banco: string | null; agencia: string | null; numero: string | null };
  avisos: string[];
  // Banco reconhecido no PDF (leitor próprio do layout).
  banco?: string | null;
};

const arred2 = (n: number) => Math.round(n * 100) / 100;

function semAcento(t: unknown): string {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Linhas de saldo que alguns bancos misturam com os lançamentos.
const LINHA_DE_SALDO = /^(saldo|s a l d o|sdo\b|saldo anterior|saldo do dia|saldo final|saldo bloqueado|saldo disponivel|total)/;
export function ehLinhaDeSaldo(descricao: string): boolean {
  return LINHA_DE_SALDO.test(semAcento(descricao));
}

// ---------------------------------------------------------------------------
// OFX (Money/Quicken): padrão que quase todo banco brasileiro exporta.
// ---------------------------------------------------------------------------
function tag(bloco: string, nome: string): string | null {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() || null : null;
}

function valorOfx(t: string | null): number {
  if (!t) return 0;
  const limpo = t.replace(/\s/g, "");
  // Alguns bancos mandam "-305,10".
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return Number.isFinite(n) ? arred2(n) : 0;
}

function dataOfx(t: string | null): string | null {
  const m = t?.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function lerOfx(texto: string): ExtratoLido {
  const avisos: string[] = [];
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  const linhas: LinhaExtrato[] = [];
  for (const b of blocos) {
    const data = dataOfx(tag(b, "DTPOSTED"));
    const valor = valorOfx(tag(b, "TRNAMT"));
    if (!data || !valor) continue;
    const memo = tag(b, "MEMO");
    const nome = tag(b, "NAME");
    const descricao = [nome, memo && memo !== nome ? memo : null].filter(Boolean).join(" · ") || tag(b, "TRNTYPE") || "Sem descrição";
    linhas.push({
      data,
      descricao,
      documento: tag(b, "CHECKNUM") ?? tag(b, "REFNUM"),
      valor,
      saldo: null,
      id_banco: tag(b, "FITID"),
    });
  }
  if (!linhas.length) avisos.push("Nenhum lançamento encontrado no arquivo OFX.");
  const saldo = texto.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i);
  return {
    linhas,
    saldoFinal: saldo ? valorOfx(saldo[1]) : null,
    conta: { banco: tag(texto, "BANKID"), agencia: tag(texto, "BRANCHID"), numero: tag(texto, "ACCTID") },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Planilha (Excel ou CSV exportado pelo internet banking)
// ---------------------------------------------------------------------------
export const CAMPOS_EXTRATO = {
  data: "Data",
  descricao: "Descrição / histórico",
  documento: "Documento",
  valor: "Valor (com sinal)",
  credito: "Crédito (entrada)",
  debito: "Débito (saída)",
  natureza: "C/D",
  saldo: "Saldo",
} as const;
export type CampoExtrato = keyof typeof CAMPOS_EXTRATO;
export type MapaExtrato = Partial<Record<CampoExtrato, number>>;

const NOMES: Record<CampoExtrato, RegExp> = {
  data: /^(data|dt|data (do )?lanc|data mov|dia)/,
  descricao: /(historico|descri|lancamento|memo|detalhe)/,
  documento: /(documento|^doc|n.? ?doc|dcto|^numero|^n.?$)/,
  credito: /(credito|entrada|^cr$)/,
  debito: /(debito|saida|^db$|^deb$)/,
  natureza: /^(d\/c|c\/d|tipo|natureza|dc|cd)$/,
  saldo: /^saldo/,
  valor: /^(valor|vlr|montante|quantia)/,
};

export function mapearColunasExtrato(cabecalho: Celula[]): MapaExtrato {
  const mapa: MapaExtrato = {};
  const usadas = new Set<number>();
  // Ordem importa: "Valor" fica por último para não pegar "Saldo" ou "Crédito".
  for (const campo of ["data", "descricao", "documento", "credito", "debito", "natureza", "saldo", "valor"] as CampoExtrato[]) {
    const i = cabecalho.findIndex((c, n) => !usadas.has(n) && NOMES[campo].test(semAcento(c)));
    if (i >= 0) {
      mapa[campo] = i;
      usadas.add(i);
    }
  }
  return mapa;
}

// Primeira linha que tem "data" e alguma coluna de valor.
export function acharCabecalhoExtrato(linhas: Celula[][]): number {
  return linhas.slice(0, 40).findIndex((l) => {
    const m = mapearColunasExtrato(l);
    return m.data !== undefined && (m.valor !== undefined || m.credito !== undefined || m.debito !== undefined);
  });
}

// Valor de célula com o sinal que os bancos usam: "-305,10", "305,10-",
// "(305,10)" ou "305,10 D" são saídas.
export function valorCelula(c: Celula): number {
  if (typeof c === "number") return c;
  const t = String(c ?? "").replace(/\s/g, "");
  const v = Math.abs(lerValor(t.replace(/-$/, "")));
  return /^-|-$|^\(.*\)$|D$/i.test(t) ? -v : v;
}

export function lerPlanilhaExtrato(linhas: Celula[][], inicio: number, mapa: MapaExtrato): ExtratoLido {
  const avisos: string[] = [];
  const vazio = { linhas: [], saldoFinal: null, conta: { banco: null, agencia: null, numero: null } };
  if (mapa.data === undefined) return { ...vazio, avisos: ["Escolha a coluna da data."] };
  if (mapa.valor === undefined && mapa.credito === undefined && mapa.debito === undefined)
    return { ...vazio, avisos: ["Escolha a coluna do valor (ou as de crédito e débito)."] };

  const pegar = (l: Celula[], c: CampoExtrato) => (mapa[c] === undefined ? undefined : l[mapa[c]!]);
  const saida: LinhaExtrato[] = [];
  let saldoFinal: number | null = null;
  let semData = 0;
  for (const l of linhas.slice(inicio)) {
    const descricao = String(pegar(l, "descricao") ?? "").trim();
    const saldo = mapa.saldo !== undefined && String(pegar(l, "saldo") ?? "").trim() !== "" ? arred2(valorCelula(pegar(l, "saldo"))) : null;
    if (saldo !== null) saldoFinal = saldo;
    if (ehLinhaDeSaldo(descricao)) continue;
    let valor = mapa.valor !== undefined ? valorCelula(pegar(l, "valor")) : 0;
    if (!valor && (mapa.credito !== undefined || mapa.debito !== undefined)) {
      const c = Math.abs(valorCelula(pegar(l, "credito")));
      const d = Math.abs(valorCelula(pegar(l, "debito")));
      valor = c - d;
    }
    const natureza = semAcento(pegar(l, "natureza"));
    if (natureza.startsWith("d")) valor = -Math.abs(valor);
    else if (natureza.startsWith("c")) valor = Math.abs(valor);
    valor = arred2(valor);
    if (!valor) continue;
    const data = lerData(pegar(l, "data") ?? null);
    if (!data) {
      semData++;
      continue;
    }
    const documento = String(pegar(l, "documento") ?? "").trim() || null;
    saida.push({ data, descricao: descricao || "Sem descrição", documento, valor, saldo, id_banco: null });
  }
  if (semData) avisos.push(`${semData} linha(s) com valor e sem data foram ignoradas.`);
  if (!saida.length) avisos.push("Nenhum lançamento encontrado com as colunas escolhidas.");
  return { linhas: saida, saldoFinal, conta: { banco: null, agencia: null, numero: null }, avisos };
}

// ---------------------------------------------------------------------------
// PDF: o texto vem em linhas (agrupadas pela altura na página). Cada banco tem
// um layout; aqui vale a regra comum: linha com data no começo e valor no fim.
// A pessoa confere tudo antes de gravar e pode inverter o sinal.
// ---------------------------------------------------------------------------
const DINHEIRO = /(-\s?)?\(?(\d{1,3}(?:\.\d{3})*,\d{2})\)?(\s?-)?(\s?[CD]\b)?/g;
const SAIDA = /(pix (enviado|emitido)|pagamento|pagto|pgto|tarifa|tar\b|debito|saque|compra|iof|juros|enviad|ted env|doc env|boleto|cobranca|aplicacao|taxa|mensalidade|cesta)/;
const ENTRADA = /(recebid|credito|deposito|estorno|resgate|rendimento|devolucao|liberacao|venda|cred )/;

export function lerTextoExtratoPdf(linhasTexto: string[]): ExtratoLido {
  const avisos: string[] = [];
  const todo = linhasTexto.join(" ");
  // Ano das datas sem ano: o mais citado nas datas completas do documento.
  const anos = [...todo.matchAll(/\d{2}\/\d{2}\/(\d{4})/g)].map((m) => m[1]);
  const ano = anos.sort((a, b) => anos.filter((x) => x === b).length - anos.filter((x) => x === a).length)[0] ?? String(new Date().getFullYear());

  const saida: LinhaExtrato[] = [];
  let dataAtual: string | null = null;
  let saldoAnterior: number | null = null;
  let saldoFinal: number | null = null;
  for (const bruta of linhasTexto) {
    const texto = bruta.replace(/\s+/g, " ").trim();
    if (!texto) continue;
    const md = texto.match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\s+(.*)$/);
    let resto = texto;
    if (md) {
      const a = md[3] ? (md[3].length === 2 ? "20" + md[3] : md[3]) : ano;
      dataAtual = `${a}-${md[2]}-${md[1]}`;
      resto = md[4];
    }
    const valores = [...resto.matchAll(DINHEIRO)].filter((m) => m[2]);
    if (!valores.length) continue;
    const descricao = resto
      .slice(0, valores[0].index)
      .replace(/\s+[-–]\s*$/, "")
      .trim();
    const numero = (m: RegExpMatchArray) => {
      const v = lerValor(m[2]);
      const negativo = !!m[1] || !!m[3] || /\(/.test(m[0]) || /D/.test(m[4] ?? "");
      return { v: negativo ? -v : v, marcado: negativo || /C/.test(m[4] ?? "") };
    };
    if (ehLinhaDeSaldo(descricao) || !descricao) {
      const s = numero(valores[valores.length - 1]).v;
      if (ehLinhaDeSaldo(descricao)) {
        saldoAnterior = s;
        saldoFinal = s;
      }
      continue;
    }
    if (!dataAtual) continue;
    const mov = numero(valores[0]);
    const saldo = valores.length > 1 ? numero(valores[valores.length - 1]).v : null;
    let valor = mov.v;
    let incerto = false;
    if (!mov.marcado) {
      // Sem C/D: o saldo da linha diz o sentido; senão, as palavras do histórico.
      if (saldo !== null && saldoAnterior !== null && Math.abs(Math.abs(saldo - saldoAnterior) - Math.abs(valor)) < 0.01) {
        valor = saldo - saldoAnterior < 0 ? -Math.abs(valor) : Math.abs(valor);
      } else {
        const d = semAcento(descricao);
        if (SAIDA.test(d)) valor = -Math.abs(valor);
        else if (ENTRADA.test(d)) valor = Math.abs(valor);
        else {
          valor = -Math.abs(valor);
          incerto = true;
        }
      }
    }
    if (saldo !== null) {
      saldoAnterior = saldo;
      saldoFinal = saldo;
    }
    saida.push({ data: dataAtual, descricao, documento: null, valor: arred2(valor), saldo, id_banco: null, ...(incerto ? { sinalIncerto: true } : {}) });
  }
  if (!saida.length) avisos.push("Não achamos lançamentos no PDF. Se o banco permitir, baixe o extrato em OFX ou Excel.");
  const incertos = saida.filter((l) => l.sinalIncerto).length;
  if (incertos) avisos.push(`${incertos} lançamento(s) sem C/D no PDF: confira se é entrada ou saída.`);
  return { linhas: saida, saldoFinal, conta: { banco: null, agencia: null, numero: null }, avisos };
}

// ---------------------------------------------------------------------------
// Sugestão de conciliação
// ---------------------------------------------------------------------------
export type TituloCandidato = {
  id: string;
  tipo: "pagar" | "receber";
  descricao: string;
  pessoa: string | null;
  // Valor que deve aparecer no extrato: pago/recebido, ou o valor em aberto.
  valor: number;
  // Data do pagamento (pago) ou vencimento (em aberto).
  data: string;
  pago: boolean;
};

export type Sugestao = { titulos: string[]; motivo: string };

function palavras(t: string): Set<string> {
  return new Set(
    semAcento(t)
      .split(/[^a-z0-9]+/)
      .filter((p) => p.length >= 4 && !["ltda", "pagto", "pagamento", "enviado", "recebido", "transf", "boleto"].includes(p)),
  );
}

// Para cada linha pendente, o título de mesmo valor (até R$ 0,01) e mesmo
// sentido mais perto na data: até 3 dias se já está pago, até 10 em aberto.
// O nome do fornecedor/cliente no histórico desempata. Um título só serve a
// uma linha.
export function sugerirConciliacao(linhas: { id: string; data: string; valor: number; descricao: string }[], titulos: TituloCandidato[]) {
  const usados = new Set<string>();
  const resultado = new Map<string, Sugestao>();
  const ordenadas = [...linhas].sort((a, b) => a.data.localeCompare(b.data));
  for (const l of ordenadas) {
    const tipo = l.valor < 0 ? "pagar" : "receber";
    const alvo = Math.abs(l.valor);
    const doHistorico = palavras(l.descricao);
    let melhor: { t: TituloCandidato; pontos: number; dias: number } | null = null;
    for (const t of titulos) {
      if (t.tipo !== tipo || usados.has(t.id) || Math.abs(t.valor - alvo) > 0.01) continue;
      const dias = Math.abs(diasEntre(t.data, l.data));
      if (dias > (t.pago ? 3 : 10)) continue;
      const nome = palavras(`${t.pessoa ?? ""} ${t.descricao}`);
      const comuns = [...nome].filter((p) => doHistorico.has(p)).length;
      const pontos = (t.pago ? 20 : 0) + comuns * 15 - dias * 2;
      if (!melhor || pontos > melhor.pontos) melhor = { t, pontos, dias };
    }
    if (melhor) {
      usados.add(melhor.t.id);
      const quando = melhor.dias === 0 ? "mesmo dia" : `${melhor.dias} dia(s) de diferença`;
      resultado.set(l.id, {
        titulos: [melhor.t.id],
        motivo: `mesmo valor, ${quando}${melhor.t.pago ? ", já baixado nesta conta" : ""}`,
      });
    }
  }
  return resultado;
}
