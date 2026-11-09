// Testes das regras do contas a pagar: status, parcelado/recorrente e pagamento.
// Rodam com: npm test (node --test, sem dependências).
import assert from "node:assert/strict";
import { test } from "node:test";
import { gerarLancamentos, proximaData, somarMeses, statusDoTitulo, totalPago } from "../src/lib/contas-pagar.ts";

test("status: vencido, a vencer (hoje conta como a vencer), pago e cancelado", () => {
  const hoje = "2026-11-09";
  assert.equal(statusDoTitulo({ situacao: "aberto", vencimento: "2026-11-08" }, hoje), "vencido");
  assert.equal(statusDoTitulo({ situacao: "aberto", vencimento: "2026-11-09" }, hoje), "a_vencer");
  assert.equal(statusDoTitulo({ situacao: "pago", vencimento: "2025-01-01" }, hoje), "pago");
  assert.equal(statusDoTitulo({ situacao: "cancelado", vencimento: "2025-01-01" }, hoje), "cancelado");
});

test("somarMeses mantém o dia e cai no último dia dos meses curtos", () => {
  assert.equal(somarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(somarMeses("2026-11-15", 2), "2027-01-15");
});

test("parcelada divide o total; centavos que sobram vão na 1ª", () => {
  const l = gerarLancamentos({ tipo: "parcelada", valor: 100, vencimento: "2026-11-10", quantidade: 3, intervalo: "mensal" });
  assert.deepEqual(
    l.map((x) => [x.parcela, x.valor, x.vencimento]),
    [
      ["1/3", 33.34, "2026-11-10"],
      ["2/3", 33.33, "2026-12-10"],
      ["3/3", 33.33, "2027-01-10"],
    ],
  );
  assert.equal(l.reduce((s, x) => s + x.valor * 100, 0), 10000);
});

test("recorrente repete o mesmo valor no intervalo escolhido", () => {
  const l = gerarLancamentos({ tipo: "recorrente", valor: 8858.75, vencimento: "2026-11-05", quantidade: 3, intervalo: "quinzenal" });
  assert.deepEqual(
    l.map((x) => [x.parcela, x.valor, x.vencimento]),
    [
      ["rec. 1/3", 8858.75, "2026-11-05"],
      ["rec. 2/3", 8858.75, "2026-11-20"],
      ["rec. 3/3", 8858.75, "2026-12-05"],
    ],
  );
});

test("única ignora a quantidade", () => {
  assert.deepEqual(gerarLancamentos({ tipo: "unica", valor: 10, vencimento: "2026-11-10", quantidade: 5, intervalo: "mensal" }), [
    { parcela: null, valor: 10, vencimento: "2026-11-10" },
  ]);
});

test("intervalos semanal e anual", () => {
  assert.equal(proximaData("2026-11-10", "semanal", 2), "2026-11-24");
  assert.equal(proximaData("2028-02-29", "anual", 1), "2029-02-28");
});

test("total pago soma juros e multa e tira o desconto", () => {
  assert.equal(totalPago({ principal: 1000, juros: 12.5, multa: 20, desconto: 0.1 }), 1032.4);
  assert.equal(totalPago({ principal: 1000 }), 1000);
});
