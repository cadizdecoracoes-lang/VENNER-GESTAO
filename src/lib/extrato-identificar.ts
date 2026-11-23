// Acha a conta bancária (e a empresa) de cada extrato importado, para a tela
// aceitar vários arquivos de uma vez (bancos, contas e meses diferentes).
//
// Do arquivo sai o que ele diz de si: o banco (OFX: BANKID; PDF: o leitor do
// layout; senão o nome do arquivo ou o cabeçalho), a agência, o número da
// conta e o CNPJ do titular. Com isso, nesta ordem:
// 1. CNPJ do arquivo igual ao de uma empresa: só as contas dela entram;
// 2. número da conta igual ao da conta cadastrada ou ao de um arquivo já
//    importado nela (a tela aprende: a maioria das contas vem do Tiny só com
//    o nome);
// 3. o banco: a única conta daquele banco (pelo nome ou pelo código).
// Duas contas possíveis (ex.: a mesma conta cadastrada duas vezes) ou
// nenhuma: a pessoa escolhe só para aquele arquivo.
// Sem dependências do Next, para rodar também nos testes (node --test).
import type { ExtratoLido } from "./extrato.ts";

export type BancoChave =
  | "bb"
  | "bradesco"
  | "itau"
  | "sicoob"
  | "c6"
  | "caixa"
  | "santander"
  | "inter"
  | "nubank"
  | "sicredi"
  | "safra"
  | "btg"
  | "mercadopago"
  | "pagbank"
  | "cora"
  | "stone";

// codigos: número do banco no Banco Central (o OFX manda no BANKID).
// nome: como aparece no nome da conta, do arquivo ou no cabeçalho do extrato.
const BANCOS: { chave: BancoChave; nome: string; codigos: number[]; nomeConta: RegExp }[] = [
  { chave: "sicoob", nome: "Sicoob", codigos: [756], nomeConta: /\bsicoob\b|\bsisbr\b|\bbancoob\b/ },
  { chave: "bb", nome: "Banco do Brasil", codigos: [1], nomeConta: /banco do brasil|\bbb\b/ },
  { chave: "bradesco", nome: "Bradesco", codigos: [237], nomeConta: /bradesco/ },
  { chave: "itau", nome: "Itaú", codigos: [341], nomeConta: /\bitau\b/ },
  { chave: "c6", nome: "C6 Bank", codigos: [336], nomeConta: /\bc6\b/ },
  { chave: "caixa", nome: "Caixa Econômica", codigos: [104], nomeConta: /caixa econ|\bcef\b/ },
  { chave: "santander", nome: "Santander", codigos: [33], nomeConta: /santander/ },
  { chave: "inter", nome: "Inter", codigos: [77], nomeConta: /\b(banco )?inter\b/ },
  { chave: "nubank", nome: "Nubank", codigos: [260], nomeConta: /nubank|nu pagamentos/ },
  { chave: "sicredi", nome: "Sicredi", codigos: [748], nomeConta: /sicredi/ },
  { chave: "safra", nome: "Safra", codigos: [422], nomeConta: /\bsafra\b/ },
  { chave: "btg", nome: "BTG", codigos: [208], nomeConta: /\bbtg\b/ },
  { chave: "mercadopago", nome: "Mercado Pago", codigos: [323], nomeConta: /mercado ?pago/ },
  { chave: "pagbank", nome: "PagBank", codigos: [290], nomeConta: /pagbank|pagseguro/ },
  { chave: "cora", nome: "Cora", codigos: [403], nomeConta: /\bcora\b/ },
  { chave: "stone", nome: "Stone", codigos: [197], nomeConta: /\bstone\b/ },
];

export function nomeDoBanco(chave: BancoChave): string {
  return BANCOS.find((b) => b.chave === chave)!.nome;
}

function semAcento(t: string | null | undefined): string {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_.]/g, " ");
}

// Banco por código ("0341", "341") ou por texto ("Sicoob", "Ext. Venner Sicoob Julho").
export function bancoDe(t: string | null | undefined): BancoChave | null {
  const s = String(t ?? "").trim();
  if (!s) return null;
  if (/^\d{1,4}$/.test(s)) return BANCOS.find((b) => b.codigos.includes(Number(s)))?.chave ?? null;
  const n = semAcento(s);
  return BANCOS.find((b) => b.nomeConta.test(n))?.chave ?? null;
}

// Só os dígitos, sem zeros à esquerda (o dígito verificador "X" sai junto).
export function digitosConta(t: string | null | undefined): string {
  return String(t ?? "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
}

// Mesma conta com ou sem o dígito verificador ("72010-0", "0072010", "720100").
export function mesmoNumero(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digitosConta(a);
  const y = digitosConta(b);
  if (x.length < 4 || y.length < 4) return false;
  return x === y || x.slice(0, -1) === y || y.slice(0, -1) === x;
}

// CNPJs escritos no texto (o Bradesco escreve com um zero a mais: 048.085.200/0001-10).
export function cnpjsDoTexto(texto: string): string[] {
  const achados = new Set<string>();
  for (const m of texto.matchAll(/\b0?\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length === 14) achados.add(d);
    else if (d.length === 15 && d.startsWith("0")) achados.add(d.slice(1));
  }
  return [...achados];
}

// Número da conta escrito no cabeçalho (quando o leitor do arquivo não achou).
function contaDoTexto(texto: string): { agencia: string | null; numero: string | null } {
  const t = semAcento(texto).replace(/\s+/g, " ");
  const numero =
    t.match(/\b(?:conta corrente|c\/c|cc|conta)\s*:?\s*(?:n[o°º]?\s*)?(\d[\d -]{2,14}[\dx])\b/)?.[1] ??
    t.match(/minha conta\s*(\d[\d-]{3,14}[\dx])/)?.[1] ??
    null;
  const agencia = t.match(/\b(?:agencia|ag|cooperativa|coop)\s*:?\s*(\d{3,5})\b/)?.[1] ?? null;
  return { agencia, numero: numero ? numero.replace(/\s+/g, "") : null };
}

export type ContaDoArquivo = { banco: BancoChave | null; agencia: string | null; numero: string | null; cnpjs: string[] };

// nome: nome do arquivo; cabecalho: texto do começo do arquivo (primeiras
// linhas do PDF ou da planilha); lido: o que o leitor do formato achou.
export function contaDoArquivo(nome: string, cabecalho: string, lido: Pick<ExtratoLido, "conta" | "banco"> | null): ContaDoArquivo {
  const doTexto = contaDoTexto(cabecalho);
  const banco = bancoDe(lido?.conta.banco) ?? bancoDe(lido?.banco) ?? bancoDe(nome.replace(/\.[a-z0-9]+$/i, "")) ?? bancoDe(cabecalho.slice(0, 1500));
  return {
    banco,
    agencia: lido?.conta.agencia ?? doTexto.agencia,
    numero: lido?.conta.numero ?? doTexto.numero,
    cnpjs: cnpjsDoTexto(cabecalho),
  };
}

// Guardado na importação (extrato_importacoes.conta_no_arquivo) para a tela
// reconhecer a conta da próxima vez: "banco|agência|conta".
export function guardarConta(c: ContaDoArquivo): string | null {
  if (!c.numero && !c.agencia) return null;
  return [c.banco ?? "", c.agencia ?? "", c.numero ?? ""].join("|");
}
export function lerContaGuardada(t: string | null | undefined): { banco: BancoChave | null; numero: string | null } | null {
  if (!t) return null;
  const [banco, , numero] = t.split("|");
  return { banco: bancoDe(banco) ?? (BANCOS.some((b) => b.chave === banco) ? (banco as BancoChave) : null), numero: numero || null };
}

export type ContaCadastrada = {
  id: string;
  nome: string;
  empresa_id: string;
  banco_codigo: string | null;
  banco_nome: string | null;
  conta: string | null;
  // Números de conta dos arquivos já importados nela.
  vistos: string[];
};

export type Escolha = {
  conta: string | null;
  // Por que esta conta (ou por que a pessoa precisa escolher).
  motivo: string;
  // Contas possíveis quando não deu para decidir sozinho (as melhores primeiro).
  possiveis: string[];
};

function bancoDaConta(c: ContaCadastrada): BancoChave | null {
  return bancoDe(c.banco_codigo) ?? bancoDe(c.banco_nome) ?? bancoDe(c.nome);
}

export function escolherConta(arq: ContaDoArquivo, contas: ContaCadastrada[], empresas: { id: string; cnpj: string | null }[]): Escolha {
  const daEmpresa = new Set(empresas.filter((e) => e.cnpj && arq.cnpjs.includes(digitosConta(e.cnpj).padStart(14, "0"))).map((e) => e.id));
  const base = daEmpresa.size ? contas.filter((c) => daEmpresa.has(c.empresa_id)) : contas;
  const numeros = (c: ContaCadastrada) => [c.conta, ...c.vistos].filter((n): n is string => !!digitosConta(n));
  const peloCnpj = daEmpresa.size ? " e o CNPJ" : "";
  const nomes = (ids: ContaCadastrada[]) => ids.map((c) => c.nome).join(" e ");

  if (arq.numero) {
    const pelaConta = base.filter((c) => numeros(c).some((n) => mesmoNumero(n, arq.numero)));
    if (pelaConta.length === 1) return { conta: pelaConta[0].id, motivo: `pelo número da conta ${arq.numero}${peloCnpj}`, possiveis: [] };
    if (pelaConta.length > 1)
      return { conta: null, motivo: `a conta ${arq.numero} está em ${pelaConta.length} contas (${nomes(pelaConta)}): escolha`, possiveis: pelaConta.map((c) => c.id) };
  }

  if (arq.banco) {
    // Conta do mesmo banco com outro número conhecido é outra conta.
    const doBanco = base.filter(
      (c) => bancoDaConta(c) === arq.banco && !(arq.numero && numeros(c).length && !numeros(c).some((n) => mesmoNumero(n, arq.numero))),
    );
    const banco = nomeDoBanco(arq.banco);
    if (doBanco.length === 1) return { conta: doBanco[0].id, motivo: `pelo banco (${banco})${peloCnpj}`, possiveis: [] };
    if (doBanco.length > 1)
      return { conta: null, motivo: `${doBanco.length} contas do ${banco} (${nomes(doBanco)}): escolha`, possiveis: doBanco.map((c) => c.id) };
    return { conta: null, motivo: `nenhuma conta do ${banco} cadastrada${daEmpresa.size ? " nesta empresa" : ""}: escolha`, possiveis: [] };
  }
  return { conta: null, motivo: "não deu para saber o banco: escolha a conta", possiveis: [] };
}

// Quantos lançamentos do arquivo já estão no sistema, pela mesma regra do
// banco (importar_extrato + marcar_repetidos_extrato): na mesma conta, mesma
// data e mesmo valor vindos de outra importação são o mesmo lançamento; vale
// a maior quantidade que uma única importação trouxe naquele dia e valor.
// existentes: linhas da conta (por importação); o arquivo conta como mais uma.
export function contarRepetidas(
  linhas: { data: string; valor: number }[],
  existentes: { data: string; valor: number; importacao: string }[],
): number {
  const chave = (l: { data: string; valor: number }) => `${l.data}|${Math.round(l.valor * 100)}`;
  const porImportacao = new Map<string, Map<string, number>>();
  for (const e of existentes) {
    const k = chave(e);
    const m = porImportacao.get(k) ?? new Map<string, number>();
    m.set(e.importacao, (m.get(e.importacao) ?? 0) + 1);
    porImportacao.set(k, m);
  }
  const noArquivo = new Map<string, number>();
  for (const l of linhas) if (l.valor) noArquivo.set(chave(l), (noArquivo.get(chave(l)) ?? 0) + 1);
  let repetidas = 0;
  for (const [k, qtd] of noArquivo) {
    const ja = Math.max(0, ...(porImportacao.get(k)?.values() ?? []));
    repetidas += Math.min(qtd, ja);
  }
  return repetidas;
}
