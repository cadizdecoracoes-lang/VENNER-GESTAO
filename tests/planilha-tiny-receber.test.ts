// Testes da leitura da planilha de contas a receber exportada do Tiny.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lerPlanilhaTinyReceber } from "../src/lib/planilha-tiny-receber.ts";

// Mesmas colunas da exportação do Tiny (out/2026).
const CABECALHO = ["Data de vencimento", "Situação", "Valor", "Nome do cliente", "Documento Origem", "Forma de recebimento",
  "Categoria financeira", "Conta", "Data de recebimento", "Data de emissão", "Saldo", "Recebido"];

test("planilha do Tiny: recebido com data e conta, aberto e parcial", () => {
  const r = lerPlanilhaTinyReceber([
    CABECALHO,
    ["13/10/2026", "Pago", 2900, "GABRIELA DOS SANTOS", null, "Pix", "TRANSFERÊNCIA RECEBIDA", "Banco Itaú", "14/10/2026", "13/10/2026", 0, 2900],
    ["20/11/2026", "Aberto", "1.284,88", "AKL COMERCIO", "000442", "Boleto", "VENDAS", null, null, "20/10/2026", 1284.88, 0],
    ["01/11/2026", "Parcial", 500, "JR", null, "", "", "Sicoob", "01/11/2026", "01/10/2026", 200, 300],
    ["01/10/2026", "Cancelada", 10, "Fulano", null, "", "", null, null, "", 0, 0],
    [null, null, null, null, null, null, null, null, null, null, null, null],
    ["", "Pago", 10, "", null, "", "", null, null, "", 0, 0],
  ]);
  assert.equal(r.erro, undefined);
  assert.equal(r.linhas.length, 4);
  assert.equal(r.ignoradas, 1);
  assert.deepEqual(r.linhas[0], {
    cliente: "GABRIELA DOS SANTOS", vencimento: "2026-10-13", valor: 2900, situacao: "pago", documento: null,
    conta: "Banco Itaú", valor_recebido: 2900, recebimento: "2026-10-14",
  });
  assert.equal(r.linhas[1].situacao, "aberto");
  assert.equal(r.linhas[1].valor, 1284.88);
  assert.equal(r.linhas[1].documento, "000442");
  assert.equal(r.linhas[2].situacao, "parcial");
  assert.equal(r.linhas[2].valor_recebido, 300);
  assert.equal(r.linhas[3].situacao, "cancelado");
});

test("planilha errada: avisa a coluna que falta", () => {
  assert.match(lerPlanilhaTinyReceber([["Data de vencimento", "Valor"]]).erro ?? "", /Situação, Nome do cliente/);
  assert.match(lerPlanilhaTinyReceber([["x"]]).erro ?? "", /Data de vencimento/);
});
