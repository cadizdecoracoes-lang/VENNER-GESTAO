// Testes do leitor de extrato em PDF por banco (BB, Bradesco, Itaú, Sicoob, C6).
// As linhas imitam o que sai do PDF de cada banco (posição x de cada pedaço),
// com nomes e valores inventados: os extratos reais não ficam no repositório.
// Rodam com: npm test (node --test, sem dependências).
import assert from "node:assert/strict";
import { test } from "node:test";
import { agruparLinhas, corrigirUmDigito, detectarBanco, lerDinheiro, lerExtratoPdf, type LinhaPdf } from "../src/lib/extrato-pdf.ts";

// Monta as linhas: cada linha é uma lista de [x, texto] (ou [x, texto, confiança do OCR]).
function pdf(...linhas: ([number, string] | [number, string, number])[][]): LinhaPdf[] {
  return linhas.map((itens, y) => ({ pagina: 1, y: y * 10, itens: itens.map(([x, t, c]) => ({ x, t, ...(c === undefined ? {} : { c }) })) }));
}
// Linha de OCR: texto corrido, um pedaço só.
const ocr = (...linhas: string[]) => pdf(...linhas.map((t) => [[40, t] as [number, string]]));

test("valor em reais com as marcas de sinal dos bancos", () => {
  assert.deepEqual(lerDinheiro("6,00 D"), { v: 6, sinal: -1 });
  assert.deepEqual(lerDinheiro("743,93 C"), { v: 743.93, sinal: 1 });
  assert.deepEqual(lerDinheiro("-1.300,00"), { v: 1300, sinal: -1 });
  assert.deepEqual(lerDinheiro("3.000,00-"), { v: 3000, sinal: -1 });
  assert.deepEqual(lerDinheiro("-R$ 2.292,41"), { v: 2292.41, sinal: -1 });
  assert.deepEqual(lerDinheiro("R$ 25.641,00"), { v: 25641, sinal: 0 });
  assert.deepEqual(lerDinheiro("18,43C"), { v: 18.43, sinal: 1 });
  assert.equal(lerDinheiro("10.201"), null);
  assert.equal(lerDinheiro("2.152.986.017.019"), null);
});

test("agrupa pedaços na mesma altura e ordena da esquerda para a direita", () => {
  const l = agruparLinhas([
    { pagina: 1, x: 200, y: 100.5, t: "Pix" },
    { pagina: 1, x: 50, y: 100, t: "02/01/2026" },
    { pagina: 1, x: 50, y: 120, t: "seguinte" },
    { pagina: 2, x: 50, y: 100, t: "outra página" },
  ]);
  assert.equal(l.length, 3);
  assert.deepEqual(
    l[0].itens.map((i) => i.t),
    ["02/01/2026", "Pix"],
  );
});

const CAB_BB = [
  [139, "Ag. origem"],
  [192, "Lote"],
  [218, "Histórico"],
  [414, "Documento"],
  [487, "Valor R$"],
  [534, "Saldo"],
] as [number, string][];

test("Banco do Brasil: C/D, complemento na linha de baixo, Rende Fácil e saldo final", () => {
  const linhas = pdf(
    [[24, "05/08/2026, 09:51"], [317, "Banco do Brasil"]],
    [[46, "Agência"], [120, "1234-5"]],
    [[46, "Conta corrente"], [120, "99999-X"], [200, "EMPRESA TESTE LTDA"]],
    CAB_BB,
    [[49, "30/12/2025"], [149, "0000"], [189, "00000"], [221, "000 Saldo Anterior"], [528, "100,00 C"]],
    [[49, "02/01/2026"], [93, "02/01/2026"], [149, "0000"], [189, "13105"], [221, "144 Pix - Enviado"], [427, "10.201"], [490, "60,00 D"]],
    [[221, "02/01 13:59 Fornecedor Alfa"]],
    [[49, "05/01/2026"], [93, "05/01/2026"], [149, "0000"], [189, "14020"], [221, "624 Cobrança"], [379, "110.051.000.009.995"], [482, "743,93 C"]],
    [[49, "05/01/2026"], [93, "05/01/2026"], [149, "0000"], [189, "00000"], [221, "798 BB Rende Fácil"], [431, "9.903"], [476, "783,93 D"], [528, "0,00 C"]],
    [[221, "Rende Facil"]],
    [[24, "https://autoatendimento.bb.com.br/..."], [560, "1/2"]],
    [[49, "31/01/2026"], [149, "0000"], [189, "00000"], [221, "999 S A L D O"], [528, "0,00 C"]],
    [[46, "Transação efetuada com sucesso por: FULANO"]],
  );
  assert.equal(detectarBanco(linhas), "bb");
  const r = lerExtratoPdf(linhas);
  assert.equal(r.banco, "Banco do Brasil");
  assert.deepEqual(r.conta, { banco: "Banco do Brasil", agencia: "1234-5", numero: "99999-X" });
  assert.equal(r.linhas.length, 3);
  assert.deepEqual(
    r.linhas.map((l) => [l.data, l.valor, l.descricao, l.documento]),
    [
      ["2026-01-02", -60, "Pix - Enviado · Fornecedor Alfa", "10.201"],
      ["2026-01-05", 743.93, "Cobrança", "110.051.000.009.995"],
      ["2026-01-05", -783.93, "BB Rende Fácil · Rende Facil", "9.903"],
    ],
  );
  assert.equal(r.linhas[2].aplicacao, true);
  assert.equal(r.linhas[2].saldo, 0);
  assert.equal(r.saldoInicial, 100);
  assert.equal(r.saldoFinal, 0);
  assert.ok(r.avisos.some((a) => a.startsWith("Conferido")));
});

test("Bradesco: lançamento em três linhas, débito com '-', ignora 'Últimos Lançamentos'", () => {
  const cab = [
    [11, "Data"],
    [71, "Lançamento"],
    [236, "Dcto."],
    [301, "Crédito (R$)"],
    [391, "Débito (R$)"],
    [483, "Saldo (R$)"],
  ] as [number, string][];
  const linhas = pdf(
    [[10, "Extrato Mensal / Por Período"]],
    [[10, "01851"], [80, "0072010"], [300, "-337,00"], [400, "-337,00"]],
    [[10, "Extrato de: Ag:"], [60, "1851"], [80, "CC:"], [100, "0072010"], [120, "-"], [125, "0"]],
    cab,
    [[8, "31/12/2025"], [68, "SALDO ANTERIOR"], [509, "-11,91"]],
    [[68, "LIQUIDACAO DE COBRANCA"]],
    [[8, "06/01/2026"], [233, "9072010"], [325, "1.471,75"], [501, "1.459,84"]],
    [[68, "VALOR DISPONIVEL"]],
    [[68, "ENCARGOS DESCOBERTO CC"], [233, "260106"], [425, "-0,41"], [501, "1.459,43"]],
    [[68, "PIX ENVIADO"]],
    [[233, "1353043"], [410, "-1.300,00"], [507, "159,43"]],
    [[68, "DES: CLIENTE BETA 06/01"]],
    [[68, "PIX ENVIADO"]],
    [[233, "1515101"], [425, "-5,00"], [507, "154,43"]],
    [[68, "DES: CLIENTE GAMA 06/01"]],
    [[10, "Total"], [325, "1.471,75"], [410, "-1.305,41"], [501, "154,43"]],
    [[10, "Últimos Lançamentos"]],
    cab,
    [[8, "05/08/2026"], [233, "10626"], [425, "-168,50"], [501, "-168,50"]],
  );
  assert.equal(detectarBanco(linhas), "bradesco");
  const r = lerExtratoPdf(linhas);
  assert.deepEqual(
    r.linhas.map((l) => [l.data, l.valor, l.descricao, l.documento, l.saldo]),
    [
      ["2026-01-06", 1471.75, "LIQUIDACAO DE COBRANCA · VALOR DISPONIVEL", "9072010", 1459.84],
      ["2026-01-06", -0.41, "ENCARGOS DESCOBERTO CC", "260106", 1459.43],
      ["2026-01-06", -1300, "PIX ENVIADO · DES: CLIENTE BETA 06/01", "1353043", 159.43],
      ["2026-01-06", -5, "PIX ENVIADO · DES: CLIENTE GAMA 06/01", "1515101", 154.43],
    ],
  );
  assert.equal(r.conta.agencia, "1851");
  assert.equal(r.conta.numero, "0072010-0");
  assert.equal(r.saldoInicial, -11.91);
  assert.equal(r.saldoFinal, 154.43);
  assert.ok(r.avisos.some((a) => a.startsWith("Conferido")));
});

test("Itaú: data só no primeiro do dia, saída com '-', legenda à esquerda e saldos da aplicação ignorados", () => {
  const linhas = pdf(
    [[407, "extrato"], [427, "mensal"], [466, "ag 7908 cc 12345-6"], [514, "jan 2026"], [538, "001|002"]],
    [[56, "A = agendamento"]],
    [[150, "data"], [208, "descrição"], [357, "entradas R$"], [426, "saídas R$"], [521, "saldo R$"]],
    [[69, "pela Bolsa de Valores"], [150, "30/12"], [208, "Saldo anterior"], [527, "143,28-"]],
    [[56, "C = crédito a compensar"]],
    [[150, "02/01"], [208, "PIX ENVIADO FULANO"], [431, "3.000,00-"]],
    [[56, "G = aplicação programada"]],
    [[208, "PIX TRANSF CLIENTE02/01"], [375, "3.500,00"]],
    [[208, "JUROS LIMITE DA CONTA"], [436, "166,47-"], [521, "190,25"]],
    [[150, "06/01"], [208, "Res Aplic Aut Mais"], [372, "1.000,00"]],
    [[208, "Apl Aplic Aut Mais"], [432, "1.189,25-"], [537, "1,00"]],
    [[210, "SALDO APLIC AUT MAIS"], [519, "1.189,25"]],
    [[210, "(-) Saldo a liberar"], [523, "3.775,00"]],
    [[210, "Saldo em C/C"], [537, "1,00"]],
    [[210, "Saldo final"], [523, "1.190,25"]],
    [[58, "06/01"], [131, "31.868,28"], [219, "0,00"], [528, "31.868,28"]],
  );
  assert.equal(detectarBanco(linhas), "itau");
  const r = lerExtratoPdf(linhas);
  assert.deepEqual(
    r.linhas.map((l) => [l.data, l.valor, l.descricao, !!l.aplicacao]),
    [
      ["2026-01-02", -3000, "PIX ENVIADO FULANO", false],
      ["2026-01-02", 3500, "PIX TRANSF CLIENTE02/01", false],
      ["2026-01-02", -166.47, "JUROS LIMITE DA CONTA", false],
      ["2026-01-06", 1000, "Res Aplic Aut Mais", true],
      ["2026-01-06", -1189.25, "Apl Aplic Aut Mais", true],
    ],
  );
  assert.deepEqual(r.conta, { banco: "Itaú", agencia: "7908", numero: "12345-6" });
  assert.equal(r.saldoInicial, -143.28);
  assert.equal(r.saldoFinal, 1);
  assert.ok(r.avisos.some((a) => a.startsWith("Conferido")));
});

test("Sicoob por OCR: dia mais novo primeiro, C/D na linha de baixo, DOC e mês corrigido pelo período", () => {
  const linhas = ocr(
    "SICOOB",
    "SISTEMA DE COOPERATIVAS DE CRÉDITO DO BRASIL",
    "COOP.: 5004-0 / SICOOB TESTE",
    "CONTA: 1.234.567-8 / EMPRESA TESTE LTDA",
    "PERÍODO: 01/06/2026 - 30/06/2026",
    "HISTÓRICO DE MOVIMENTAÇÃO",
    "DATA HISTÓRICO VALOR",
    "23/08 SALDODODIA 18,43C",
    "23/06 —PIXEMIT.OUT IF-MSM 3.500,00",
    "D",
    "Pagamento Pix",
    "FORNECEDOR ALFA",
    "DOC.: Pix",
    "23/06 TARIFA COBRANÇA 3,30D",
    "DOC.: 4518038",
    "23/06 CRÉD.LIQ.COBRANÇA 3.521,73",
    "Cc",
    "DOC.: 4515382",
    "05/06 SALDO DO DIA 0,00C",
    "05/0868 —DEB.PARC.SUBS/INTEG 100,00D",
    "05/06 PIX RECEB.OUTRA IF 100,00C",
    "Recebimento Pix",
    "CLIENTE BETA",
    "05/06 SALDO BLOQ.ANTERIOR 0,00*",
    "05/06 SALDO ANTERIOR 0,00C",
    "RESUMO",
    "(+) SALDO EM CONTA: 18,43C",
  );
  assert.equal(detectarBanco(linhas), "sicoob");
  const r = lerExtratoPdf(linhas, { ocr: true });
  assert.deepEqual(
    r.linhas.map((l) => [l.data, l.valor, l.descricao, l.documento]),
    [
      ["2026-06-05", 100, "PIX RECEB.OUTRA IF · CLIENTE BETA", null],
      ["2026-06-05", -100, "DEB.PARC.SUBS/INTEG", null],
      ["2026-06-23", 3521.73, "CRÉD.LIQ.COBRANÇA", "4515382"],
      ["2026-06-23", -3.3, "TARIFA COBRANÇA", "4518038"],
      ["2026-06-23", -3500, "PIXEMIT.OUT IF-MSM · FORNECEDOR ALFA", null],
    ],
  );
  assert.equal(r.conta.numero, "1.234.567-8");
  assert.equal(r.saldoInicial, 0);
  assert.equal(r.saldoFinal, 18.43);
  assert.ok(r.avisos[0].includes("imagem"));
  assert.ok(r.avisos.some((a) => a.includes("ajustadas")));
  assert.ok(r.avisos.some((a) => a.startsWith("Conferido")));
});

test("C6 por OCR: ano pelo saldo do dia, sinal pelo tipo e correção de um dígito que fecha o dia", () => {
  const linhas = pdf(
    [[40, "Data Data Tipo Descrição Valor"]],
    [[40, "Saldo do dia 11/12/25 R$ 1.000,00"]],
    [[40, "12/12 12/12 Saída PIX Pix enviado para FORNECEDOR ALFA -R$ 200,00"]],
    [[40, "13/12 15/12 Saída P X Pix enviado para LANCHONETE -R$ 50,00"]],
    [[40, "Saldo do dia 15/12/25 R$ 750,00"]],
    [[40, "Janeiro 2026 (01/01/2026 - 31/01/2026) Entradas: R$ 1.501,50 Saídas: R$ 0,00"]],
    [[40, "06/01 06/01 Entrada PIX Pix recebido de CLIENTE BETA R$ 1.500,00"]],
    // "R$ 1,50" lido como "R$11,50", com pouca confiança.
    [
      [40, "06/01 06/01 Entrada PIX Pix recebido de CLIENTE GAMA"],
      [500, "R$11,50", 16],
    ],
    [[40, "Saldo do dia 06/01/26 R$ 2.251,50"]],
  );
  assert.equal(detectarBanco(linhas), "c6");
  const r = lerExtratoPdf(linhas, { ocr: true });
  assert.deepEqual(
    r.linhas.map((l) => [l.data, l.valor, l.descricao, !!l.conferir]),
    [
      ["2025-12-12", -200, "Pix enviado para FORNECEDOR ALFA", false],
      ["2025-12-15", -50, "Pix enviado para LANCHONETE", false],
      ["2026-01-06", 1500, "Pix recebido de CLIENTE BETA", false],
      ["2026-01-06", 1.5, "Pix recebido de CLIENTE GAMA", true],
    ],
  );
  assert.equal(r.saldoInicial, 1000);
  assert.equal(r.saldoFinal, 2251.5);
  assert.ok(r.avisos.some((a) => /^Corrigimos R\$\s11,50 para R\$\s1,50/.test(a)));
  assert.ok(r.avisos.some((a) => a.startsWith("Conferido")));
});

test("correção de um dígito só vale para valor lido por OCR", () => {
  const a = { data: "2026-01-01", descricao: "a", documento: null, valor: 11.5, saldo: null, id_banco: null };
  assert.equal(corrigirUmDigito([a], 10), null);
  assert.equal(a.valor, 11.5);
});

test("banco não reconhecido cai na leitura geral", () => {
  const r = lerExtratoPdf(ocr("EXTRATO", "05/10/2026 PAGAMENTO ENERGIA 305,10 D 1.194,90"));
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].valor, -305.1);
  assert.ok(r.avisos[0].startsWith("Banco não reconhecido"));
});

test("C6: dia que não fecha e mais de uma correção possível fica marcado, sem mexer", () => {
  const linhas = pdf(
    [[40, "Saldo do dia 05/01/26 R$ 100,00"]],
    [[40, "06/01 06/01 Entrada PIX Pix recebido de CLIENTE A R$ 11,50"]],
    [[40, "06/01 06/01 Entrada PIX Pix recebido de CLIENTE B R$ 11,50"]],
    [[40, "Saldo do dia 06/01/26 R$ 113,00"]],
  );
  const r = lerExtratoPdf(linhas, { ocr: true });
  assert.deepEqual(
    r.linhas.map((l) => [l.valor, !!l.conferir]),
    [
      [11.5, true],
      [11.5, true],
    ],
  );
  assert.ok(r.avisos.some((a) => a.startsWith("O saldo do dia não fecha em 06/01")));
});
