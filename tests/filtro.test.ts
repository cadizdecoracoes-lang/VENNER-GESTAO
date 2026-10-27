// Testes do filtro das listas: tipo das colunas, datas brasileiras e as
// sugestões a partir de duas letras.
// Rodam com: npm test (node --test, sem dependências).
import assert from "node:assert/strict";
import { test } from "node:test";
import { contem, dataDaCelula, intervaloDoMes, juntarColunas, montarColunas, sugerir, tipoDaColuna } from "../src/lib/filtro.ts";

test("data da célula no formato brasileiro", () => {
  assert.equal(dataDaCelula("27/10/2026"), "2026-10-27");
  assert.equal(dataDaCelula(" 01/02/2026 14:30"), "2026-02-01");
  assert.equal(dataDaCelula("12/2026"), null);
  assert.equal(dataDaCelula("Nota 000446"), null);
});

test("tipo da coluna: data, número (valor) e texto", () => {
  assert.equal(tipoDaColuna(["27/10/2026", "—", "01/11/2026"]), "data");
  assert.equal(tipoDaColuna(["R$ 1.234,56", "-R$ 10,00", "R$ 0,00"]), "numero");
  assert.equal(tipoDaColuna(["12,5%", "3,000"]), "numero");
  // Código e nº do pedido servem para achar o registro: ficam como texto.
  assert.equal(tipoDaColuna(["10001", "10002"]), "texto");
  assert.equal(tipoDaColuna(["COFERPOL", "ADIANTE RECEBÍVEIS"]), "texto");
  assert.equal(tipoDaColuna([]), "texto");
});

test("contem: sem acento e CNPJ só pelos números", () => {
  assert.ok(contem("ADIANTE RECEBÍVEIS", "recebiveis"));
  assert.ok(contem("12.345.678/0001-90", "12345678"));
  assert.ok(contem("12.345.678/0001-90", "345.678"));
  assert.ok(!contem("Tecidos Miguel", "12"));
});

const colunas = montarColunas(
  ["Vencimento", "Fornecedor", "Valor", ""],
  [
    ["19/10/2026", "COFERPOL INDUSTRIA DE TUBOS", "R$ 43.397,92", "Editar"],
    ["15/10/2026", "ADIANTE RECEBÍVEIS", "R$ 433,98", "Editar"],
    ["20/10/2026", "COFERPOL INDUSTRIA DE TUBOS", "R$ 1.000,00", "Editar"],
    ["21/10/2026", "AÇOS COFRE", "R$ 10,00", "Editar"],
  ],
);

test("montar colunas: ignora a de ações e conta os valores", () => {
  assert.deepEqual(
    colunas.map((c) => [c.rotulo, c.tipo]),
    [
      ["Vencimento", "data"],
      ["Fornecedor", "texto"],
      ["Valor", "numero"],
    ],
  );
  assert.deepEqual(colunas[1].valores.find(([v]) => v.startsWith("COFERPOL")), ["COFERPOL INDUSTRIA DE TUBOS", 2]);
});

test("sugerir: a partir de duas letras, começo do nome primeiro", () => {
  assert.deepEqual(sugerir(colunas, "c"), []);
  const s = sugerir(colunas, "co");
  assert.deepEqual(
    s.map((x) => x.valor),
    ["COFERPOL INDUSTRIA DE TUBOS", "AÇOS COFRE"],
  );
  assert.equal(s[0].quantidade, 2);
  assert.equal(s[0].coluna, "Fornecedor");
  // Datas e valores não viram sugestão.
  assert.deepEqual(sugerir(colunas, "10"), []);
  assert.deepEqual(sugerir(colunas, "acos").map((x) => x.valor), ["AÇOS COFRE"]);
});

test("juntar colunas de várias tabelas (uma por empresa)", () => {
  const outra = montarColunas(["Fornecedor"], [["ADIANTE RECEBÍVEIS"], ["NOVO"]]);
  const juntas = juntarColunas([colunas, outra]);
  const fornecedor = juntas.find((c) => c.rotulo === "Fornecedor")!;
  assert.deepEqual(fornecedor.valores.find(([v]) => v === "ADIANTE RECEBÍVEIS"), ["ADIANTE RECEBÍVEIS", 2]);
  assert.equal(fornecedor.valores.length, 4);
});

test("intervalo do mês", () => {
  assert.deepEqual(intervaloDoMes("2026-10-27", 0), { de: "2026-10-01", ate: "2026-10-31" });
  assert.deepEqual(intervaloDoMes("2026-01-15", -1), { de: "2025-12-01", ate: "2025-12-31" });
});
