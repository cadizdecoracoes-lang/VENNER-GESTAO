// Testes de como a importação acha a conta de cada extrato (vários arquivos
// de uma vez). Contas e números inventados, no formato dos bancos.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bancoDe,
  cnpjsDoTexto,
  contaDoArquivo,
  contarRepetidas,
  escolherConta,
  guardarConta,
  lerContaGuardada,
  mesmoNumero,
  type ContaCadastrada,
} from "../src/lib/extrato-identificar.ts";

const conta = (id: string, nome: string, extra: Partial<ContaCadastrada> = {}): ContaCadastrada => ({
  id,
  nome,
  empresa_id: "venner",
  banco_codigo: null,
  banco_nome: null,
  conta: null,
  vistos: [],
  ...extra,
});
const CONTAS = [
  conta("brad", "Banco Bradesco"),
  conta("c6as", "Banco C6 A. Serviços"),
  conta("bb", "Banco do Brasil"),
  conta("itau1", "Banco Itaú"),
  conta("itau2", "Itaú"),
  conta("din", "DINHEIRO"),
  conta("tiny", "Tiny · conta não informada"),
  conta("sicoob", "Sicoob"),
  conta("c6", "Venner C6 BANK", { banco_codigo: "336", banco_nome: "C6", conta: "406623570" }),
];
const EMPRESAS = [
  { id: "venner", cnpj: "48085200000110" },
  { id: "ashi", cnpj: "57455984000112" },
];
const sem = { banco: null, agencia: null, numero: null };

test("banco pelo código do OFX, pelo leitor do PDF e pelo nome do arquivo", () => {
  assert.equal(bancoDe("0341"), "itau");
  assert.equal(bancoDe("756"), "sicoob");
  assert.equal(bancoDe("001"), "bb");
  assert.equal(bancoDe("C6 Bank"), "c6");
  assert.equal(bancoDe("Ext. Venner Sicoob Julho 2026"), "sicoob");
  assert.equal(bancoDe("ext. BB Janeiro 2026"), "bb");
  assert.equal(bancoDe("Itau 01 a 16-11"), "itau");
  assert.equal(bancoDe("extrato mensal maio"), null);
});

test("número da conta com ou sem dígito e zeros à esquerda", () => {
  assert.ok(mesmoNumero("0072010-0", "72010"));
  assert.ok(mesmoNumero("0072010-0", "72010-0"));
  assert.ok(mesmoNumero("112563-X", "112563"));
  assert.ok(!mesmoNumero("99312-9", "72010-0"));
  assert.ok(!mesmoNumero("12", "12"));
});

test("CNPJ do titular no cabeçalho, inclusive com o zero a mais do Bradesco", () => {
  assert.deepEqual(cnpjsDoTexto("VENNER INDUSTRIA | CNPJ: 048.085.200/0001-10 | Nome"), ["48085200000110"]);
  assert.deepEqual(cnpjsDoTexto("CNPJ 57.455.984/0001-12"), ["57455984000112"]);
});

test("conta cadastrada com número: vai sozinho, mesmo com outra conta do mesmo banco", () => {
  const arq = contaDoArquivo("Extrato OFX C6.ofx", "", { conta: { banco: "336", agencia: "1", numero: "406623570" } });
  const e = escolherConta(arq, CONTAS, EMPRESAS);
  assert.equal(e.conta, "c6");
});

test("banco com uma conta só: vai pelo banco (vários PDFs do Sicoob)", () => {
  for (const nome of ["Ext. Venner Sicoob Julho 2026.pdf", "Extrato Mensal Sicoob Junho 2026.pdf", "sicoob 01 a 26-10.pdf"]) {
    const arq = contaDoArquivo(nome, "", { conta: { ...sem, numero: "12345-6" }, banco: "Sicoob" });
    const e = escolherConta(arq, CONTAS, EMPRESAS);
    assert.equal(e.conta, "sicoob", nome);
    assert.match(e.motivo, /Sicoob/);
  }
});

test("C6 sem número no arquivo: duas contas do C6, a pessoa escolhe", () => {
  const arq = contaDoArquivo("Ext. mensal C6 Julho 2026.pdf", "", { conta: sem, banco: "C6 Bank" });
  const e = escolherConta(arq, CONTAS, EMPRESAS);
  assert.equal(e.conta, null);
  assert.deepEqual(e.possiveis.sort(), ["c6", "c6as"]);
});

test("C6 com outro número: a conta de número conhecido diferente sai, sobra a outra", () => {
  const arq = contaDoArquivo("c6.pdf", "", { conta: { ...sem, numero: "11112222" }, banco: "C6 Bank" });
  assert.equal(escolherConta(arq, CONTAS, EMPRESAS).conta, "c6as");
});

test("Itaú cadastrado duas vezes: pede a conta; depois de importado uma vez, aprende pelo número", () => {
  const arq = contaDoArquivo("Itau 01 a 16-11.ofx", "", { conta: { banco: "0341", agencia: "7908", numero: "99312-9" } });
  const antes = escolherConta(arq, CONTAS, EMPRESAS);
  assert.equal(antes.conta, null);
  assert.deepEqual(antes.possiveis.sort(), ["itau1", "itau2"]);
  assert.match(antes.motivo, /2 contas do Itaú/);

  const guardada = lerContaGuardada(guardarConta(arq));
  assert.deepEqual(guardada, { banco: "itau", numero: "99312-9" });
  const aprendeu = CONTAS.map((c) => (c.id === "itau2" ? { ...c, vistos: [guardada!.numero!] } : c));
  const depois = escolherConta(arq, aprendeu, EMPRESAS);
  assert.equal(depois.conta, "itau2");
  assert.match(depois.motivo, /número da conta/);
});

test("mesmo número aprendido nas duas contas repetidas: pede a conta", () => {
  const arq = contaDoArquivo("x.ofx", "", { conta: { banco: "341", agencia: null, numero: "99312-9" } });
  const duas = CONTAS.map((c) => (c.id.startsWith("itau") ? { ...c, vistos: ["99312-9"] } : c));
  const e = escolherConta(arq, duas, EMPRESAS);
  assert.equal(e.conta, null);
  assert.equal(e.possiveis.length, 2);
});

test("CNPJ do arquivo de outra empresa: só as contas dela", () => {
  const contas = [...CONTAS, conta("ashi-brad", "Bradesco ASHI", { empresa_id: "ashi" })];
  const venner = contaDoArquivo("bradesco.pdf", "CNPJ: 048.085.200/0001-10", { conta: sem, banco: "Bradesco" });
  assert.equal(escolherConta(venner, contas, EMPRESAS).conta, "brad");
  const ashi = contaDoArquivo("bradesco.pdf", "ASHI | CNPJ 57.455.984/0001-12", { conta: sem, banco: "Bradesco" });
  assert.equal(escolherConta(ashi, contas, EMPRESAS).conta, "ashi-brad");
  const semCnpj = contaDoArquivo("bradesco.pdf", "", { conta: sem, banco: "Bradesco" });
  assert.equal(escolherConta(semCnpj, contas, EMPRESAS).conta, null);
});

test("planilha sem banco reconhecido: pede a conta", () => {
  const arq = contaDoArquivo("extrato.xlsx", "Data | Histórico | Valor", null);
  const e = escolherConta(arq, CONTAS, EMPRESAS);
  assert.equal(e.conta, null);
  assert.match(e.motivo, /não deu para saber o banco/);
});

test("conta lida do cabeçalho quando o leitor não achou", () => {
  const arq = contaDoArquivo("x.csv", "Banco Bradesco | Agência: 1851 | Conta: 0072010-0", null);
  assert.equal(arq.banco, "bradesco");
  assert.equal(arq.agencia, "1851");
  assert.ok(mesmoNumero(arq.numero, "72010-0"));
});

test("já no sistema: mesma data e valor de outra importação, pela maior quantidade numa importação", () => {
  const existentes = [
    { data: "2026-07-01", valor: 100, importacao: "a" },
    { data: "2026-07-02", valor: -5, importacao: "a" },
    { data: "2026-07-02", valor: -5, importacao: "b" },
  ];
  const linhas = [
    { data: "2026-07-01", valor: 100 },
    { data: "2026-07-02", valor: -5 },
    { data: "2026-07-02", valor: -5 },
    { data: "2026-07-03", valor: 40 },
  ];
  // 100 já estava; das duas tarifas só uma estava (cada importação trouxe uma); 40 é nova.
  assert.equal(contarRepetidas(linhas, existentes), 2);
  assert.equal(contarRepetidas(linhas, []), 0);
});
