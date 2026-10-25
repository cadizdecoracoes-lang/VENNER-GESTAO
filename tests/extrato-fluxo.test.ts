// Testes da leitura do extrato (OFX, planilha, PDF), da sugestão de
// conciliação e da montagem do fluxo de caixa.
// Rodam com: npm test (node --test, sem dependências).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acharCabecalhoExtrato,
  lerOfx,
  lerPlanilhaExtrato,
  lerTextoExtratoPdf,
  mapearColunasExtrato,
  sugerirConciliacao,
  valorCelula,
} from "../src/lib/extrato.ts";
import { feriado, pascoa, proximoDiaUtil } from "../src/lib/feriados.ts";
import { dataNoFluxo, filtrarPorConta, montarColunas, montarFluxo, type MovimentoFluxo, type SaldoConta } from "../src/lib/fluxo-caixa.ts";

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0341<BRANCHID>0001<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005120000[-3:BRT]<TRNAMT>-305.10<FITID>A1<CHECKNUM>778<MEMO>PAGTO ENERGIA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261007<TRNAMT>500,00<FITID>A2<NAME>TED RECEBIDA<MEMO>CLIENTE X</STMTTRN>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20261007<TRNAMT>0.00<FITID>A3<MEMO>ZERADO</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1194.90<DTASOF>20261031</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test("OFX: lançamentos, sinal, FITID, conta e saldo final", () => {
  const r = lerOfx(OFX);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(r.linhas[0], { data: "2026-10-05", descricao: "PAGTO ENERGIA", documento: "778", valor: -305.1, saldo: null, id_banco: "A1" });
  assert.equal(r.linhas[1].valor, 500);
  assert.equal(r.linhas[1].descricao, "TED RECEBIDA · CLIENTE X");
  assert.equal(r.saldoFinal, 1194.9);
  assert.deepEqual(r.conta, { banco: "0341", agencia: "0001", numero: "12345-6" });
});

test("valores de célula com o sinal dos bancos", () => {
  assert.equal(valorCelula("-305,10"), -305.1);
  assert.equal(valorCelula("305,10-"), -305.1);
  assert.equal(valorCelula("(305,10)"), -305.1);
  assert.equal(valorCelula("1.305,10 D"), -1305.1);
  assert.equal(valorCelula("1.305,10 C"), 1305.1);
  assert.equal(valorCelula(-12), -12);
});

test("planilha: acha o cabeçalho, liga as colunas e pula linhas de saldo", () => {
  const linhas = [
    ["Extrato conta corrente", null, null, null, null],
    ["Data", "Histórico", "Docto.", "Crédito (R$)", "Débito (R$)", "Saldo (R$)"],
    ["30/09/2026", "SALDO ANTERIOR", null, null, null, "1.000,00"],
    ["05/10/2026", "PAGTO ENERGIA", "778", null, "305,10", "694,90"],
    ["07/10/2026", "TED RECEBIDA", null, "500,00", null, "1.194,90"],
    [null, "Total", null, "500,00", "305,10", null],
  ];
  const cab = acharCabecalhoExtrato(linhas);
  assert.equal(cab, 1);
  const mapa = mapearColunasExtrato(linhas[cab]);
  assert.deepEqual(mapa, { data: 0, descricao: 1, documento: 2, credito: 3, debito: 4, saldo: 5 });
  const r = lerPlanilhaExtrato(linhas, cab + 1, mapa);
  assert.deepEqual(
    r.linhas.map((l) => [l.data, l.valor, l.saldo]),
    [
      ["2026-10-05", -305.1, 694.9],
      ["2026-10-07", 500, 1194.9],
    ],
  );
  assert.equal(r.saldoFinal, 1194.9);
});

test("planilha com coluna única de valor e C/D", () => {
  const linhas = [
    ["Data Lançamento", "Descrição", "Valor", "C/D"],
    [new Date("2026-10-06T00:00:00Z"), "TARIFA", "1,50", "D"],
    ["06/10/2026", "PIX RECEBIDO", "80,00", "C"],
  ];
  const r = lerPlanilhaExtrato(linhas, 1, mapearColunasExtrato(linhas[0]));
  assert.deepEqual(r.linhas.map((l) => l.valor), [-1.5, 80]);
  assert.equal(r.linhas[0].data, "2026-10-06");
});

test("PDF: data no começo, valor com C/D ou pelo saldo, ano do documento", () => {
  const r = lerTextoExtratoPdf([
    "Extrato de 01/10/2026 a 31/10/2026",
    "Data Lançamento Valor Saldo",
    "30/09 SALDO ANTERIOR 1.000,00",
    "05/10 PAGTO ENERGIA 305,10 D 694,90",
    "PIX RECEBIDO CLIENTE 80,00 774,90",
    "07/10 TED RECEBIDA 500,00 C 1.274,90",
    "08/10 MOVIMENTO SEM PISTA 10,00",
  ]);
  assert.deepEqual(
    r.linhas.map((l) => [l.data, l.descricao, l.valor, l.sinalIncerto ?? false]),
    [
      ["2026-10-05", "PAGTO ENERGIA", -305.1, false],
      ["2026-10-05", "PIX RECEBIDO CLIENTE", 80, false],
      ["2026-10-07", "TED RECEBIDA", 500, false],
      ["2026-10-08", "MOVIMENTO SEM PISTA", -10, true],
    ],
  );
  assert.equal(r.saldoFinal, 1274.9);
  assert.ok(r.avisos.some((a) => a.includes("sem C/D")));
});

test("sugestão: mesmo valor, data próxima, nome no histórico desempata", () => {
  const s = sugerirConciliacao(
    [
      { id: "L1", data: "2026-10-05", valor: -305.1, descricao: "PAGTO ENERGIA CEMIG" },
      { id: "L2", data: "2026-10-07", valor: 500, descricao: "TED RECEBIDA" },
      { id: "L3", data: "2026-10-20", valor: -99, descricao: "SEM PAR" },
    ],
    [
      { id: "P1", tipo: "pagar", descricao: "Conta de luz", pessoa: "CEMIG DISTRIBUICAO", valor: 305.1, data: "2026-10-06", pago: false },
      { id: "P2", tipo: "pagar", descricao: "Outro", pessoa: "Fornecedor Z", valor: 305.1, data: "2026-10-05", pago: false },
      { id: "R1", tipo: "receber", descricao: "Pedido 10", pessoa: null, valor: 500, data: "2026-10-30", pago: false },
      { id: "P3", tipo: "pagar", descricao: "Longe", pessoa: null, valor: 99, data: "2026-12-01", pago: false },
    ],
  );
  assert.deepEqual(s.get("L1")?.titulos, ["P1"]);
  assert.equal(s.has("L2"), false, "vencimento a mais de 10 dias não sugere");
  assert.equal(s.has("L3"), false);
});

test("feriados nacionais e dia útil", () => {
  assert.equal(pascoa(2026), "2026-04-05");
  assert.equal(feriado("2026-02-17"), "Carnaval");
  assert.equal(feriado("2026-11-20"), "Consciência Negra");
  assert.equal(proximoDiaUtil("2026-10-31"), "2026-11-03", "sábado 31/10 → terça 03/11 (segunda é Finados)");
  assert.equal(dataNoFluxo({ data: "2026-10-31", natureza: "previsto" }, "2026-10-26"), "2026-11-03");
  assert.equal(dataNoFluxo({ data: "2026-10-01", natureza: "atrasado" }, "2026-10-26"), "2026-10-26");
  assert.equal(dataNoFluxo({ data: "2026-10-31", natureza: "realizado" }, "2026-10-26"), "2026-10-31");
});

test("colunas do mês e dos 12 meses", () => {
  const dias = montarColunas("dia", "2026-11-01", "2026-11-30", "2026-11-03");
  assert.equal(dias.length, 30);
  assert.equal(dias[0].titulo, "dom 01");
  assert.equal(dias[1].feriado, "Finados");
  assert.equal(dias[2].hoje, true);
  const meses = montarColunas("mes", "2026-08-01", "2027-07-31", "2026-10-25");
  assert.equal(meses.length, 12);
  assert.equal(meses[2].titulo, "out/26");
  assert.equal(meses[2].hoje, true);
  assert.equal(meses[3].previsto, true);
});

test("fluxo: realizado, previsto, atrasado em hoje, saldo real e projetado", () => {
  const mov = (m: Partial<MovimentoFluxo>): MovimentoFluxo => ({
    data: "2026-10-05",
    tipo: "saida",
    natureza: "realizado",
    categoria_id: "c-luz",
    conta_bancaria_id: "itau",
    empresa_id: "e1",
    valor: 100,
    titulos: 1,
    ...m,
  });
  const f = montarFluxo({
    modo: "dia",
    de: "2026-10-05",
    ate: "2026-10-12",
    hoje: "2026-10-08",
    saldos: [{ conta_bancaria_id: "itau", empresa_id: "e1", nome: "Itaú", data_saldo: "2026-10-05", saldo: 1000 }],
    categorias: [
      { id: "g-adm", codigo: "4", nome: "Despesas", pai_id: null },
      { id: "c-luz", codigo: "4.06", nome: "Energia", pai_id: "g-adm" },
      { id: "g-rec", codigo: "1", nome: "Receitas", pai_id: null },
      { id: "c-venda", codigo: "1.01", nome: "Vendas", pai_id: "g-rec" },
    ],
    movimentos: [
      mov({}),
      mov({ data: "2026-10-06", tipo: "entrada", categoria_id: "c-venda", valor: 500 }),
      mov({ data: "2026-10-07", natureza: "transferencia", categoria_id: null, valor: 200 }),
      mov({ data: "2026-10-01", natureza: "atrasado", conta_bancaria_id: null, valor: 50 }),
      // Sábado 10/10 vai para segunda 12/10? Não: 12/10 é feriado, então sai do período.
      mov({ data: "2026-10-10", natureza: "previsto", conta_bancaria_id: null, valor: 30 }),
      mov({ data: "2026-10-09", natureza: "previsto", tipo: "entrada", categoria_id: null, conta_bancaria_id: null, valor: 70 }),
      mov({ data: "2026-10-09", natureza: "manual", categoria_id: null, conta_bancaria_id: null, valor: 40 }),
    ],
  });
  const linha = (chave: string) => f.linhas.find((l) => l.chave === chave)!;
  // Colunas: 05 06 07 08(hoje) 09 10 11 12
  assert.deepEqual(linha("g:saida:g-adm").valores, [100, 0, 0, 50, 0, 0, 0, 0]);
  assert.deepEqual(linha("c:saida:c-luz").pai, "g:saida:g-adm");
  assert.deepEqual(linha("g:entrada:sem").valores, [0, 0, 0, 0, 70, 0, 0, 0]);
  assert.deepEqual(linha("m:saida").valores, [0, 0, 0, 0, 40, 0, 0, 0]);
  assert.deepEqual(linha("transferencias").valores, [0, 0, -200, 0, 0, 0, 0, 0]);
  // 1000 −100 | +500 | −200 | −50 atrasado | +70 −40
  assert.deepEqual(linha("saldo").valores, [900, 1400, 1200, 1150, 1180, 1180, 1180, 1180]);
  assert.deepEqual(linha("conta:itau").valores, [900, 1400, 1200, 1200, null, null, null, null]);
  assert.deepEqual(f.resumo.menorSaldo, { valor: 1150, data: "2026-10-08" });
  assert.equal(f.resumo.atrasadoPagar, 50);
  assert.equal(f.resumo.entradasPrevistas, 70);
  assert.equal(f.resumo.saidasPrevistas, 90);
  assert.equal(f.previsoes["saida|2026-10-09"], 40);
});

test("fluxo: coluna de comparação com o período anterior", () => {
  const f = montarFluxo({
    modo: "dia",
    de: "2026-11-02",
    ate: "2026-11-03",
    hoje: "2026-11-10",
    saldos: [],
    categorias: [
      { id: "g", codigo: "4", nome: "Despesas", pai_id: null },
      { id: "c", codigo: "4.06", nome: "Energia", pai_id: "g" },
    ],
    movimentos: [{ data: "2026-11-03", tipo: "saida", natureza: "realizado", categoria_id: "c", conta_bancaria_id: null, empresa_id: "e", valor: 120, titulos: 1 }],
    anteriores: [
      { data: "2026-10-03", tipo: "saida", natureza: "realizado", categoria_id: "c", conta_bancaria_id: null, empresa_id: "e", valor: 100, titulos: 1 },
      { data: "2026-10-05", tipo: "entrada", natureza: "realizado", categoria_id: null, conta_bancaria_id: null, empresa_id: "e", valor: 50, titulos: 1 },
    ],
  });
  const l = (k: string) => f.linhas.find((x) => x.chave === k)!;
  assert.equal(l("g:saida:g").anterior, 100);
  assert.equal(l("c:saida:c").anterior, 100);
  assert.equal(l("t:entrada").anterior, 50);
  assert.equal(l("resultado").anterior, -50);
  assert.equal(l("saldo").anterior, undefined);
});

test("fluxo: filtro por conta bancária", () => {
  const mov = (m: Partial<MovimentoFluxo>): MovimentoFluxo => ({
    data: "2026-10-05",
    tipo: "saida",
    natureza: "realizado",
    categoria_id: null,
    conta_bancaria_id: "itau",
    empresa_id: "e1",
    valor: 10,
    titulos: 1,
    ...m,
  });
  const saldo = (id: string, empresa: string): SaldoConta => ({ conta_bancaria_id: id, empresa_id: empresa, nome: id, data_saldo: "2026-10-01", saldo: 0 });
  const movimentos = [
    mov({}),
    mov({ conta_bancaria_id: "bb" }),
    mov({ natureza: "transferencia", conta_bancaria_id: "itau" }),
    mov({ natureza: "previsto", conta_bancaria_id: null }),
    mov({ natureza: "manual", conta_bancaria_id: null }),
    mov({ natureza: "previsto", conta_bancaria_id: null, empresa_id: "e2" }),
  ];
  // e1 tem duas contas: a projeção fica na visão da empresa.
  const duas = filtrarPorConta(movimentos, [saldo("itau", "e1"), saldo("bb", "e1"), saldo("caixa", "e2")], "itau");
  assert.equal(duas.comPrevisto, false);
  assert.deepEqual(duas.movimentos.map((m) => m.natureza), ["realizado", "transferencia"]);
  assert.deepEqual(duas.saldos.map((s) => s.conta_bancaria_id), ["itau"]);
  // Conta única da empresa: o previsto da empresa entra.
  const uma = filtrarPorConta(movimentos, [saldo("itau", "e1"), saldo("caixa", "e2")], "itau");
  assert.equal(uma.comPrevisto, true);
  assert.deepEqual(uma.movimentos.map((m) => m.natureza), ["realizado", "transferencia", "previsto", "manual"]);
  // Conta que a pessoa não enxerga: nada.
  assert.equal(filtrarPorConta(movimentos, [saldo("itau", "e1")], "outra").movimentos.length, 0);
});
