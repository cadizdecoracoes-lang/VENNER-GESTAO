// Leitura do extrato bancário em PDF, com um leitor para o layout de cada banco
// (Banco do Brasil, Bradesco, Itaú, Sicoob e C6). O PDF chega aqui já em
// linhas: cada linha tem os pedaços de texto com a posição na página (x em
// pontos, da esquerda). Vale tanto para o texto do PDF quanto para o texto
// reconhecido por OCR quando o PDF é só imagem ("Imprimir > Salvar como PDF").
// Banco não reconhecido cai na leitura comum (lerTextoExtratoPdf).
// Sem dependências do Next, para rodar também nos testes (node --test).
import { lerTextoExtratoPdf, type ExtratoLido, type LinhaExtrato } from "./extrato.ts";

// c: confiança do OCR (0 a 100), só quando o texto veio da leitura de imagem.
export type ItemPdf = { x: number; t: string; c?: number };
export type LinhaPdf = { pagina: number; y: number; itens: ItemPdf[] };
export type Banco = "bb" | "bradesco" | "itau" | "sicoob" | "c6";

export const NOME_BANCO: Record<Banco, string> = {
  bb: "Banco do Brasil",
  bradesco: "Bradesco",
  itau: "Itaú",
  sicoob: "Sicoob",
  c6: "C6 Bank",
};

const arred2 = (n: number) => Math.round(n * 100) / 100;

function semAcento(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function textoLinha(l: LinhaPdf): string {
  return l.itens
    .map((i) => i.t)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// Junta os pedaços de texto em linhas pela altura (y cresce para baixo) e
// ordena cada linha da esquerda para a direita.
export function agruparLinhas(itens: { pagina: number; x: number; y: number; t: string; c?: number }[], tolerancia = 2.5): LinhaPdf[] {
  const ordenados = itens.filter((i) => i.t.trim()).sort((a, b) => a.pagina - b.pagina || a.y - b.y || a.x - b.x);
  const linhas: LinhaPdf[] = [];
  let atual: LinhaPdf | null = null;
  for (const i of ordenados) {
    if (!atual || atual.pagina !== i.pagina || Math.abs(i.y - atual.y) > tolerancia) {
      atual = { pagina: i.pagina, y: i.y, itens: [] };
      linhas.push(atual);
    }
    atual.itens.push({ x: i.x, t: i.t.trim(), ...(i.c === undefined ? {} : { c: i.c }) });
  }
  for (const l of linhas) l.itens.sort((a, b) => a.x - b.x);
  return linhas;
}

export function detectarBanco(linhas: LinhaPdf[]): Banco | null {
  const t = semAcento(linhas.slice(0, 80).map(textoLinha).join("\n"));
  if (/sicoob|sisbr/.test(t)) return "sicoob";
  if (/banco do brasil|bb\.com\.br|bb rende facil/.test(t)) return "bb";
  if (/bradesco|extrato mensal \/ por periodo/.test(t)) return "bradesco";
  if (/c6 ?bank|data contabil|saldo do dia \d{2}\/\d{2}\/\d{2}\b/.test(t)) return "c6";
  if (/itau|extrato mensal ag \d+ cc|aplic aut mais|sispag/.test(t)) return "itau";
  return null;
}

// ---------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------
// Valor em reais com as marcas de sinal que os bancos usam: "-1.300,00",
// "3.000,00-", "6,00 D", "18,43C", "-R$ 2.292,41". sinal: -1 saída, 1 entrada
// marcada (C), 0 sem marca.
const DINHEIRO = /^(?:[-–—]\s*)?(?:R\$\s*)?(?:[-–—]\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\s*-?\s*[CD*]?$/i;
export function lerDinheiro(t: string): { v: number; sinal: -1 | 0 | 1 } | null {
  const s = t.trim().replace(/\s+/g, " ");
  if (!DINHEIRO.test(s)) return null;
  const n = s.match(/\d{1,3}(?:\.\d{3})*,\d{2}/)![0];
  const v = Number(n.replace(/\./g, "").replace(",", "."));
  const negativo = /^[-–—]|[-–—]\s*(R\$)?\s*\d|,\d{2}\s*-|D$/i.test(s);
  return { v, sinal: negativo ? -1 : /C$/i.test(s) ? 1 : 0 };
}

// Último valor em reais no fim do texto (para linhas reconhecidas por OCR).
const DINHEIRO_NO_FIM = /((?:[-–—]\s*)?(?:R\$\s*)?(?:[-–—]\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\s*-?\s*[CD*]?)\s*$/i;

// Ano das datas sem ano (dd/mm): o do período do extrato; mês bem depois do
// fim do período é do ano anterior (o "saldo anterior" de dezembro).
function anoDaData(mes: number, ref: { ano: number; mes: number }): number {
  return mes > ref.mes + 1 ? ref.ano - 1 : ref.ano;
}

const iso = (ano: number, mes: number, dia: number) => `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

// Aplicação e resgate automáticos (BB Rende Fácil, Aplic Aut Mais do Itaú,
// Invest Fácil do Bradesco): o banco tira e põe o dinheiro sozinho. A tela
// oferece tirar essas linhas da importação de uma vez.
const APLICACAO = /(rende facil|^(apl|res)\.? aplic aut|aplic\.? ?invest facil|resg\.? ?invest facil|^aplicacao automatica|^resgate automatico)/;
export function ehAplicacaoAutomatica(descricao: string): boolean {
  return APLICACAO.test(semAcento(descricao));
}

type Montagem = {
  linhas: LinhaExtrato[];
  saldoInicial: number | null;
  saldoFinal: number | null;
  conta: ExtratoLido["conta"];
  avisos: string[];
};

function nova(data: string, descricao: string, valor: number, extra: Partial<LinhaExtrato> = {}): LinhaExtrato {
  const d = descricao.replace(/\s+/g, " ").trim() || "Sem descrição";
  return {
    data,
    descricao: d,
    documento: null,
    valor: arred2(valor),
    saldo: null,
    id_banco: null,
    ...(ehAplicacaoAutomatica(d) ? { aplicacao: true } : {}),
    ...extra,
  };
}

function complementar(l: LinhaExtrato | undefined, texto: string) {
  const t = texto.replace(/\s+/g, " ").trim();
  if (!l || !t) return;
  l.descricao = `${l.descricao} · ${t}`;
}

// Confere saldo anterior + lançamentos = saldo final e fecha a leitura.
function fechar(m: Montagem, banco: Banco, ocr: boolean): ExtratoLido {
  const { linhas, saldoInicial, saldoFinal, avisos } = m;
  // Extrato do mais novo para o mais velho: vira em ordem de data.
  if (linhas.length > 1 && linhas[0].data > linhas[linhas.length - 1].data) linhas.reverse();
  if (ocr) {
    avisos.unshift(
      `Este PDF é uma imagem (foi "impresso" como PDF): o texto foi reconhecido pela leitura de imagem e pode ter erro. Confira datas e valores, ou baixe o PDF ou o OFX direto do internet banking.`,
    );
  }
  if (saldoInicial !== null && saldoFinal !== null && linhas.length) {
    if (ocr) {
      const corrigida = corrigirUmDigito(linhas, arred2(saldoInicial + linhas.reduce((s, l) => s + l.valor, 0) - saldoFinal));
      if (corrigida) avisos.push(corrigida);
    }
    const soma = linhas.reduce((s, l) => s + l.valor, 0);
    const diferenca = arred2(saldoInicial + soma - saldoFinal);
    if (Math.abs(diferenca) >= 0.01) {
      avisos.push(
        `A soma não fecha com o saldo do extrato: saldo anterior ${dinheiroBr(saldoInicial)} + lançamentos ${dinheiroBr(soma)} deveria dar ${dinheiroBr(saldoFinal)} (diferença de ${dinheiroBr(diferenca)}). Confira as linhas marcadas e os sinais.`,
      );
    } else avisos.push(`Conferido: saldo anterior ${dinheiroBr(saldoInicial)} + lançamentos = saldo final ${dinheiroBr(saldoFinal)}.`);
  }
  if (!linhas.length) avisos.push(`Não achamos lançamentos neste extrato do ${NOME_BANCO[banco]}. Se o banco permitir, baixe o extrato em OFX ou Excel.`);
  const incertos = linhas.filter((l) => l.sinalIncerto).length;
  if (incertos) avisos.push(`${incertos} lançamento(s) sem C/D: confira se é entrada ou saída.`);
  return { linhas, saldoFinal, saldoInicial, conta: { ...m.conta, banco: NOME_BANCO[banco] }, avisos, banco: NOME_BANCO[banco] };
}

// Valor como estava escrito no PDF (para a correção de um dígito do OCR).
const valorLido = new WeakMap<LinhaExtrato, string>();
// Linhas cujo valor o OCR leu com pouca confiança.
const duvidosas = new WeakSet<LinhaExtrato>();

// O OCR costuma errar um dígito só (6 por 8, "R$ 1,50" lido "R$11,50"). Se o
// saldo não fecha por "diferenca" e existe uma única linha em que trocar,
// tirar ou pôr um dígito fecha a conta, corrige essa linha e a marca para
// conferir. Mais de uma saída possível: não mexe.
export function corrigirUmDigito(linhas: LinhaExtrato[], diferenca: number): string | null {
  if (Math.abs(diferenca) < 0.01) return null;
  const achadas: { l: LinhaExtrato; v: number }[] = [];
  for (const l of linhas) {
    const lido = valorLido.get(l);
    if (!lido) continue;
    const alvo = arred2(Math.abs(l.valor - diferenca));
    if (Math.sign(l.valor - diferenca) !== Math.sign(l.valor)) continue;
    const digitos = lido.replace(/\D/g, "");
    const variantes = new Set<string>();
    for (let i = 0; i < digitos.length; i++) {
      variantes.add(digitos.slice(0, i) + digitos.slice(i + 1));
      for (let d = 0; d <= 9; d++) {
        variantes.add(digitos.slice(0, i) + d + digitos.slice(i + 1));
        variantes.add(digitos.slice(0, i) + d + digitos.slice(i));
      }
    }
    if ([...variantes].some((v) => v.length >= 3 && Number(v) / 100 === alvo)) achadas.push({ l, v: alvo });
  }
  // Mais de uma saída: vale a única entre as que o OCR leu com pouca confiança.
  const escolha = achadas.length === 1 ? achadas : achadas.filter((a) => duvidosas.has(a.l));
  if (escolha.length !== 1) return null;
  const { l, v } = escolha[0];
  const antes = Math.abs(l.valor);
  l.valor = l.valor < 0 ? -v : v;
  l.conferir = true;
  return `Corrigimos ${dinheiroBr(antes)} para ${dinheiroBr(v)} em ${l.data.split("-").reverse().join("/")} (${l.descricao}) para o saldo fechar: confira no PDF.`;
}

// Confiança baixa do OCR no valor da linha.
function valorDuvidoso(l: LinhaPdf): boolean {
  return l.itens.some((i) => i.c !== undefined && i.c < 50 && /\d,\d/.test(i.t));
}

const dinheiroBr = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Posição (x) de cada coluna, lida no cabeçalho da tabela.
function colunas(l: LinhaPdf, nomes: Record<string, RegExp>): Record<string, number> | null {
  const achadas: Record<string, number> = {};
  for (const [campo, re] of Object.entries(nomes)) {
    const i = l.itens.find((it) => re.test(semAcento(it.t)));
    if (!i) return null;
    achadas[campo] = i.x;
  }
  return achadas;
}

// ---------------------------------------------------------------------------
// Banco do Brasil (autoatendimento > Extrato de conta corrente)
// Dt. balancete | Dt. movimento | Ag. origem | Lote | Histórico | Documento | Valor R$ | Saldo
// Valor com C/D; a linha de baixo completa o histórico (nome do Pix, pagador).
// ---------------------------------------------------------------------------
function lerBB(linhas: LinhaPdf[]): Montagem {
  const m: Montagem = { linhas: [], saldoInicial: null, saldoFinal: null, conta: { banco: null, agencia: null, numero: null }, avisos: [] };
  let col: Record<string, number> | null = null;
  let ultima: LinhaExtrato | undefined;
  let fim = false;
  for (const l of linhas) {
    const texto = textoLinha(l);
    const ag = texto.match(/^Ag[eê]ncia\s+(\d+-?[\dXx]?)/i);
    if (ag) m.conta.agencia = ag[1];
    const cc = texto.match(/^Conta corrente\s+(\d[\d.-]*[\dXx])/i);
    if (cc) m.conta.numero = cc[1];
    col = colunas(l, { historico: /^historico/, valor: /^valor/, saldo: /^saldo$/ }) ?? col;
    if (!col || fim) continue;
    const [primeiro, ...resto] = l.itens;
    const data = primeiro.t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!data) {
      // Complemento do histórico: começa na coluna do histórico e não tem valor.
      if (primeiro.x >= col.historico - 15 && primeiro.x < col.valor - 60 && !l.itens.some((i) => lerDinheiro(i.t))) {
        complementar(ultima, texto.replace(/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s+/, ""));
      }
      continue;
    }
    const valores = resto.filter((i) => i.x >= col!.valor - 30 && lerDinheiro(i.t));
    const saldoItem = valores.find((i) => i.x >= col!.saldo - 15);
    const movItem = valores.find((i) => i.x < col!.saldo - 15);
    const historico = resto.find((i) => /[a-z]/i.test(i.t) && i.x >= col!.historico - 15 && i.x < col!.valor - 30);
    const descricao = (historico?.t ?? "").replace(/^\d{3}\s+/, "");
    const saldo = saldoItem ? lerDinheiro(saldoItem.t)! : null;
    if (/^saldo|^s a l d o/i.test(semAcento(descricao))) {
      const v = saldo ?? (movItem ? lerDinheiro(movItem.t) : null);
      if (v) {
        const valor = v.sinal < 0 ? -v.v : v.v;
        if (/anterior/i.test(descricao)) m.saldoInicial = valor;
        else {
          m.saldoFinal = valor;
          fim = /^s a l d o$/i.test(descricao.trim());
        }
      }
      ultima = undefined;
      continue;
    }
    if (!movItem) continue;
    const v = lerDinheiro(movItem.t)!;
    const documento = resto.find((i) => i.x > (historico?.x ?? 0) && i.x < col!.valor - 30 && /^[\d.]+$/.test(i.t))?.t ?? null;
    const [, dia, mes, ano] = data;
    ultima = nova(iso(+ano, +mes, +dia), descricao, v.sinal < 0 ? -v.v : v.v, {
      documento,
      saldo: saldo ? (saldo.sinal < 0 ? -saldo.v : saldo.v) : null,
      ...(v.sinal === 0 ? { sinalIncerto: true } : {}),
    });
    m.linhas.push(ultima);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Bradesco (Net Empresa > Extrato Mensal / Por Período)
// Data | Lançamento | Dcto. | Crédito (R$) | Débito (R$) | Saldo (R$)
// O lançamento pode ocupar 3 linhas: título em cima, valores no meio e
// complemento embaixo ("DES: FULANO 06/01"). Débito vem com "-".
// ---------------------------------------------------------------------------
function lerBradesco(linhas: LinhaPdf[]): Montagem {
  const m: Montagem = { linhas: [], saldoInicial: null, saldoFinal: null, conta: { banco: null, agencia: null, numero: null }, avisos: [] };
  let col: Record<string, number> | null = null;
  let dataAtual: string | null = null;
  let ultima: LinhaExtrato | undefined;
  let soltas: string[] = [];
  const largar = () => {
    for (const t of soltas) complementar(ultima, t);
    soltas = [];
  };
  for (const l of linhas) {
    const texto = textoLinha(l);
    const cc = texto.match(/Ag:\s*(\d+)\s*\|?\s*CC:\s*(\d+)\s*-?\s*(\d)?/i);
    if (cc) {
      m.conta.agencia = cc[1];
      m.conta.numero = cc[3] ? `${cc[2]}-${cc[3]}` : cc[2];
    }
    if (!col) {
      col = colunas(l, { lancamento: /^lancamento/, credito: /^credito/, debito: /^debito/, saldo: /^saldo/ });
      continue;
    }
    if (/^total\b/i.test(texto)) {
      largar();
      break;
    }
    if (colunas(l, { lancamento: /^lancamento/, saldo: /^saldo/ })) continue;
    const valores = l.itens.filter((i) => i.x >= col!.credito - 40 && lerDinheiro(i.t));
    if (!valores.length) {
      if (l.itens[0].x >= col.lancamento - 15) soltas.push(texto);
      continue;
    }
    const d = l.itens[0].t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (d) dataAtual = iso(+d[3], +d[2], +d[1]);
    const proprio = l.itens
      .filter((i) => i.x >= col!.lancamento - 15 && i.x < col!.credito - 40 && /[a-z]/i.test(i.t))
      .map((i) => i.t)
      .join(" ");
    const saldoItem = valores.find((i) => i.x >= col!.saldo - 15);
    const movItem = valores.find((i) => i.x < col!.saldo - 15);
    const saldo = saldoItem ? lerDinheiro(saldoItem.t)! : null;
    const saldoValor = saldo ? (saldo.sinal < 0 ? -saldo.v : saldo.v) : null;
    let descricao = proprio;
    if (!proprio) {
      descricao = soltas.pop() ?? "";
    }
    largar();
    if (/^saldo anterior/i.test(descricao)) {
      m.saldoInicial = saldoValor;
      ultima = undefined;
      continue;
    }
    if (!movItem || !dataAtual) continue;
    const v = lerDinheiro(movItem.t)!;
    // Débito vem com "-"; sem sinal, a coluna diz.
    const negativo = v.sinal < 0 || (v.sinal === 0 && Math.abs(movItem.x - col.debito) < Math.abs(movItem.x - col.credito));
    const documento = l.itens.find((i) => i.x >= col!.lancamento && i.x < col!.credito - 40 && /^\d+$/.test(i.t))?.t ?? null;
    ultima = nova(dataAtual, descricao, negativo ? -v.v : v.v, { documento, saldo: saldoValor });
    if (saldoValor !== null) m.saldoFinal = saldoValor;
    m.linhas.push(ultima);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Itaú (extrato mensal)
// data | descrição | entradas R$ | saídas R$ | saldo R$
// Data só na primeira linha do dia; saída termina com "-". A coluna da
// esquerda tem a legenda das siglas e é ignorada.
// ---------------------------------------------------------------------------
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function lerItau(linhas: LinhaPdf[]): Montagem {
  const m: Montagem = { linhas: [], saldoInicial: null, saldoFinal: null, conta: { banco: null, agencia: null, numero: null }, avisos: [] };
  let ref: { ano: number; mes: number } | null = null;
  let col: Record<string, number> | null = null;
  let dataAtual: string | null = null;
  let saldoCC: number | null = null;
  let fim = false;
  for (const l of linhas) {
    const texto = textoLinha(l);
    const cab = semAcento(texto).match(/ag (\d+) cc ([\d.-]+)\s*\|?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w* (\d{4})/);
    if (cab) {
      m.conta.agencia = cab[1];
      m.conta.numero = cab[2];
      ref = { ano: +cab[4], mes: MES_CURTO.indexOf(cab[3]) + 1 };
    }
    const c = colunas(l, { data: /^data$/, descricao: /^descricao/, entradas: /^entradas/, saidas: /^saidas/, saldo: /^saldo/ });
    if (c) {
      col = c;
      continue;
    }
    if (!col || fim) continue;
    const itens = l.itens.filter((i) => i.x >= col!.data - 10);
    if (!itens.length) continue;
    let resto = itens;
    const d = itens[0].x < col.descricao - 10 ? itens[0].t.match(/^(\d{2})\/(\d{2})$/) : null;
    if (d) {
      const ano = ref ? anoDaData(+d[2], ref) : new Date().getFullYear();
      dataAtual = iso(ano, +d[2], +d[1]);
      resto = itens.slice(1);
    }
    const descricao = resto
      .filter((i) => i.x < col!.entradas - 20 && !lerDinheiro(i.t))
      .map((i) => i.t)
      .join(" ")
      .trim();
    const valores = resto.filter((i) => i.x >= col!.entradas - 20 && lerDinheiro(i.t));
    if (!valores.length) continue;
    const saldoItem = valores.find((i) => i.x >= col!.saldo - 15);
    const movItem = valores.find((i) => i.x < col!.saldo - 15);
    const saldo = saldoItem ? lerDinheiro(saldoItem.t)! : null;
    const saldoValor = saldo ? (saldo.sinal < 0 ? -saldo.v : saldo.v) : null;
    const d2 = semAcento(descricao);
    if (/^saldo anterior/.test(d2)) {
      m.saldoInicial = saldoValor ?? (movItem ? lerDinheiro(movItem.t)!.v : null);
      continue;
    }
    if (/^saldo em c\/c/.test(d2)) {
      saldoCC = saldoValor ?? (movItem ? lerDinheiro(movItem.t)!.v : null);
      continue;
    }
    if (/^saldo final$/.test(d2)) {
      fim = true;
      continue;
    }
    // Saldo da aplicação automática, saldo a liberar etc.: informação, não lançamento.
    if (/^(saldo|\(-\) saldo|sdo\b)/.test(d2)) continue;
    if (!movItem || !dataAtual) continue;
    const v = lerDinheiro(movItem.t)!;
    const negativo = v.sinal < 0 || (v.sinal === 0 && Math.abs(movItem.x - col.saidas) < Math.abs(movItem.x - col.entradas));
    m.linhas.push(nova(dataAtual, descricao, negativo ? -v.v : v.v, { saldo: saldoValor }));
    if (saldoValor !== null) saldoCC = saldoValor;
  }
  m.saldoFinal = saldoCC;
  return m;
}

// ---------------------------------------------------------------------------
// Sicoob (SISBR > Extrato conta corrente)
// DATA | HISTÓRICO | VALOR (com C/D, às vezes o C/D cai na linha de baixo).
// Lista do dia mais novo para o mais velho; as linhas abaixo completam o
// histórico (nome, CNPJ) e "DOC.:" é o documento.
// ---------------------------------------------------------------------------
const SAIDA_SICOOB = /(deb|emit|tarifa|pagto|pagamento|pag\.|saque|compra|iof|juros|envi|tar\.)/;
const ENTRADA_SICOOB = /(cred|receb|deposito|estorno|resgate|rendimento|devol|liq\.? ?cobranca)/;

function lerSicoob(linhas: LinhaPdf[], ocr: boolean): Montagem {
  const m: Montagem = { linhas: [], saldoInicial: null, saldoFinal: null, conta: { banco: null, agencia: null, numero: null }, avisos: [] };
  let periodo: { ano: number; mesIni: number; mesFim: number } | null = null;
  let dentro = false;
  let ultima: LinhaExtrato | undefined;
  let saldoDia: { data: string; v: number }[] = [];
  let datasCorrigidas = 0;
  for (const l of linhas) {
    const texto = textoLinha(l);
    const sem = semAcento(texto);
    const p = sem.match(/periodo:?\s*(\d{2})\/(\d{2})\/(\d{4})\s*[-a]\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (p) periodo = { ano: +p[6], mesIni: +p[2], mesFim: +p[5] };
    const cc = texto.match(/CONTA:?\s*([\d.]+-[\dXx])/i);
    if (cc) m.conta.numero = cc[1];
    const coop = texto.match(/COOP\.?:?\s*(\d+-?\d?)/i);
    if (coop) m.conta.agencia = coop[1];
    if (/historico/.test(sem) && /valor/.test(sem)) {
      dentro = true;
      continue;
    }
    if (!dentro) continue;
    if (/^resumo\b/.test(sem)) break;
    // OCR às vezes lê "23/06 —", "05/0868": dia/mês no começo, o resto é histórico.
    const md = texto.match(/^(\d{2})\/(\d{2})\d*\s*[—–-]*\s*(.*)$/);
    const valorFim = texto.match(DINHEIRO_NO_FIM);
    if (md && valorFim) {
      let mes = +md[2];
      const dia = +md[1];
      if (periodo && (mes < periodo.mesIni || mes > periodo.mesFim)) {
        if (periodo.mesIni === periodo.mesFim) {
          mes = periodo.mesIni;
          datasCorrigidas++;
        }
      }
      const ano = periodo ? periodo.ano - (mes > periodo.mesFim ? 1 : 0) : new Date().getFullYear();
      const data = iso(ano, mes, dia);
      const historico = md[3].slice(0, md[3].length - valorFim[0].length).trim();
      const v = lerDinheiro(valorFim[1])!;
      const h = semAcento(historico);
      // OCR junta palavras ("SALDODODIA"): compara sem espaços.
      const hj = h.replace(/[^a-z]/g, "");
      if (/^saldo/.test(hj)) {
        const valor = v.sinal < 0 ? -v.v : v.v;
        if (/^saldododia/.test(hj)) saldoDia.push({ data, v: valor });
        else if (/^saldoanterior/.test(hj)) m.saldoInicial = valor;
        ultima = undefined;
        continue;
      }
      let sinal = v.sinal;
      if (sinal === 0) sinal = SAIDA_SICOOB.test(h) ? -1 : ENTRADA_SICOOB.test(h) ? 1 : 0;
      ultima = nova(data, historico, sinal < 0 ? -v.v : v.v, sinal === 0 ? { sinalIncerto: true } : {});
      if (valorDuvidoso(l)) {
        ultima.conferir = true;
        duvidosas.add(ultima);
      }
      valorLido.set(ultima, valorFim[1]);
      m.linhas.push(ultima);
      continue;
    }
    if (!ultima) continue;
    // C/D que caiu sozinho na linha de baixo.
    if (/^[CD][a-z]?$/i.test(texto) || (ocr && texto.length <= 3 && !/\d/.test(texto))) {
      const letra = texto[0].toUpperCase();
      if (letra === "D") ultima.valor = -Math.abs(ultima.valor);
      else if (letra === "C") ultima.valor = Math.abs(ultima.valor);
      if (letra === "C" || letra === "D") delete ultima.sinalIncerto;
      continue;
    }
    const doc = texto.match(/^DOC\.?:+\s*(.+)$/i);
    if (doc) {
      if (!/^pix$/i.test(doc[1].trim())) ultima.documento = doc[1].trim();
      continue;
    }
    if (/^(pagamento|recebimento) pix$/i.test(texto)) continue;
    complementar(ultima, texto);
  }
  // Saldo final: o "saldo do dia" da data mais nova.
  saldoDia = saldoDia.sort((a, b) => b.data.localeCompare(a.data));
  m.saldoFinal = saldoDia[0]?.v ?? null;
  if (datasCorrigidas) m.avisos.push(`${datasCorrigidas} data(s) lidas fora do período do extrato foram ajustadas para o mês do período: confira.`);
  return m;
}

// ---------------------------------------------------------------------------
// C6 Bank (app/internet banking > extrato)
// Data lançamento | Data contábil | Tipo | Descrição | Valor ("-R$ 1.900,00")
// Entre os dias vem "Saldo do dia dd/mm/aa R$ x": serve para achar o ano e
// para conferir cada dia.
// ---------------------------------------------------------------------------
const TIPO_C6 =
  /^(sa[ií]da (p\s?i?\s?x|ted|doc)|entrada (p\s?i?\s?x|ted|doc)|entradas|sa[ií]das|pagamento em lote|pagamento|outros gastos|outras entradas|transfer[eê]ncia|tarifas?|estorno|rendimentos?|aplica[cç][aã]o|resgate|boleto|d[eé]bito autom[aá]tico|compra no d[eé]bito)\s+/i;
const SAIDA_C6 = /^(sa[ií]das?|pagamento|outros gastos|tarifa|aplica|boleto|d[eé]bito|compra)/i;
const ENTRADA_C6 = /^(entradas?|outras entradas|estorno|rendimento|resgate)/i;
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function lerC6(linhas: LinhaPdf[]): Montagem {
  const m: Montagem = { linhas: [], saldoInicial: null, saldoFinal: null, conta: { banco: null, agencia: null, numero: null }, avisos: [] };
  // Ano de cada mês, pelos "Saldo do dia dd/mm/aa" e pelos títulos "Janeiro 2026".
  const anoDoMes = new Map<number, number>();
  for (const l of linhas) {
    const s = semAcento(textoLinha(l));
    for (const x of s.matchAll(/saldo do dia (\d{2})\/(\d{2})\/(\d{2,4})/g)) anoDoMes.set(+x[2], x[3].length === 2 ? 2000 + +x[3] : +x[3]);
    const t = s.match(/^(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) (\d{4})/);
    if (t) anoDoMes.set(MESES.indexOf(t[1]) + 1, +t[2]);
  }
  const ano = (mes: number) => anoDoMes.get(mes) ?? [...anoDoMes.values()][0] ?? new Date().getFullYear();
  const cc = linhas.map(textoLinha).join(" ").match(/conta:?\s*(\d[\d.-]+\d)/i);
  if (cc) m.conta.numero = cc[1];

  let grupo: LinhaExtrato[] = [];
  let saldoAntes: number | null = null;
  const diasErrados: string[] = [];
  for (const l of linhas) {
    const texto = textoLinha(l);
    const sem = semAcento(texto);
    const saldo = sem.match(/saldo do dia (\d{2})\/(\d{2})\/(\d{2,4})\D+([-–—]?\s*(?:r\$\s*)?[-–—]?\s*\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (saldo) {
      const v = lerDinheiro(saldo[4].replace(/r\$/, "R$"))!;
      const valor = v.sinal < 0 ? -v.v : v.v;
      if (saldoAntes === null) m.saldoInicial = valor;
      else if (grupo.length) {
        const diferenca = () => arred2(saldoAntes! + grupo.reduce((s, x) => s + x.valor, 0) - valor);
        const corrigida = corrigirUmDigito(grupo, diferenca());
        if (corrigida) m.avisos.push(corrigida);
        if (Math.abs(diferenca()) >= 0.01) {
          for (const x of grupo) x.conferir = true;
          diasErrados.push(`${saldo[1]}/${saldo[2]}`);
        } else for (const x of grupo) delete x.sinalIncerto; // o dia fechou: o sentido está certo
      }
      if (grupo.length) grupo[grupo.length - 1].saldo = valor;
      saldoAntes = valor;
      m.saldoFinal = valor;
      grupo = [];
      continue;
    }
    const e = texto.match(/^(\d{2})\/(\d{2})\s+(?:(\d{2})\/(\d{2})\s+)?(.*)$/);
    const valorFim = texto.match(DINHEIRO_NO_FIM);
    if (!e || !valorFim || !/R\$/i.test(valorFim[1])) continue;
    // Data contábil (a do saldo do dia); sem ela, a do lançamento.
    const dia = +(e[3] ?? e[1]);
    const mes = +(e[4] ?? e[2]);
    const meio = e[5].slice(0, e[5].length - valorFim[0].length).trim();
    const tipo = meio.match(TIPO_C6);
    const descricao = tipo ? meio.slice(tipo[0].length).trim() || tipo[1] : meio;
    const v = lerDinheiro(valorFim[1])!;
    let negativo = v.sinal < 0;
    let incerto = false;
    if (v.sinal === 0 && tipo) negativo = SAIDA_C6.test(tipo[1]) && !ENTRADA_C6.test(tipo[1]);
    else if (v.sinal === 0) incerto = true;
    // O tipo desmente o sinal (OCR perdeu ou inventou o "-"): fica para conferir.
    const contradiz = tipo && ((negativo && ENTRADA_C6.test(tipo[1])) || (!negativo && SAIDA_C6.test(tipo[1])));
    const linha = nova(iso(ano(mes), mes, dia), descricao, negativo ? -v.v : v.v, {
      ...(incerto ? { sinalIncerto: true } : {}),
      ...(contradiz || valorDuvidoso(l) ? { conferir: true } : {}),
    });
    if (valorDuvidoso(l)) duvidosas.add(linha);
    valorLido.set(linha, valorFim[1]);
    grupo.push(linha);
    m.linhas.push(linha);
  }
  if (diasErrados.length) m.avisos.push(`O saldo do dia não fecha em ${diasErrados.join(", ")}: confira as linhas marcadas desses dias.`);
  return m;
}

// ---------------------------------------------------------------------------
// Entrada: escolhe o leitor pelo banco do PDF.
// ---------------------------------------------------------------------------
export function lerExtratoPdf(linhas: LinhaPdf[], opcoes: { ocr?: boolean } = {}): ExtratoLido {
  const ocr = !!opcoes.ocr;
  const banco = detectarBanco(linhas);
  if (!banco) {
    const r = lerTextoExtratoPdf(linhas.map(textoLinha));
    if (ocr) {
      r.avisos.unshift("Este PDF é uma imagem: o texto foi reconhecido pela leitura de imagem e pode ter erro. Confira datas e valores.");
    }
    r.avisos.unshift("Banco não reconhecido: usamos a leitura geral. Confira cada linha.");
    return r;
  }
  const m =
    banco === "bb"
      ? lerBB(linhas)
      : banco === "bradesco"
        ? lerBradesco(linhas)
        : banco === "itau"
          ? lerItau(linhas)
          : banco === "sicoob"
            ? lerSicoob(linhas, ocr)
            : lerC6(linhas);
  return fechar(m, banco, ocr);
}
