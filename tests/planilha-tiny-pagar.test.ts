// Testes da leitura da planilha de contas a pagar exportada do Tiny.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lerPlanilhaTinyPagar } from "../src/lib/planilha-tiny-pagar.ts";

const CABECALHO = ["Data de vencimento", "Situação", "Valor", "Fornecedor", "Número do documento", "Categoria financeira", "Conta",
  "Valor pago", "Data de emissão", "Data de pagamento"];

test("planilha do Tiny: situação, data do pagamento e conta", () => {
  const r = lerPlanilhaTinyPagar([
    CABECALHO,
    ["19/10/2026", "Aberto", 43397.92, "COFERPOL LTDA", null, "COMPRAS - AÇO", null, 0, "16/10/2026", null],
    ["10/09/2026", "Pago", "1.200,50", "IMOBILIARIA X", "07/21", "ALUGUEL", "Venner C6 BANK", 1200.5, "01/09/2026", "12/09/2026"],
    ["28/09/2026", "Parcial", 500, "JR METALIZACAO", "10/19", "", "Caixa", 355, "22/12/2025", null],
    ["01/10/2026", "Cancelada", 10, "Fulano", null, "", null, 0, "", null],
    [null, null, null, null, null, null, null, null, null, null],
    ["", "Pago", 10, "", null, "", null, 0, "", null],
  ]);
  assert.equal(r.erro, undefined);
  assert.equal(r.linhas.length, 4);
  assert.equal(r.ignoradas, 1);
  assert.deepEqual(r.linhas[1], {
    fornecedor: "IMOBILIARIA X", vencimento: "2026-09-10", valor: 1200.5, situacao: "pago", documento: "07/21",
    conta: "Venner C6 BANK", valor_pago: 1200.5, pagamento: "2026-09-12",
  });
  assert.equal(r.linhas[0].situacao, "aberto");
  assert.equal(r.linhas[2].situacao, "parcial");
  assert.equal(r.linhas[3].situacao, "cancelado");
});

test("planilha errada avisa", () => {
  assert.match(lerPlanilhaTinyPagar([["Nome", "Valor"]]).erro ?? "", /Data de vencimento/);
  assert.match(lerPlanilhaTinyPagar([["Data de vencimento", "Valor"]]).erro ?? "", /Situação, Fornecedor/);
});
