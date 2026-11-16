// Testes da leitura do VT (planilha) e do auxílio-alimentação (PDF do portal
// Caixa). Nomes e CPFs fictícios.
import assert from "node:assert/strict";
import { test } from "node:test";
import { competenciaDoArquivo, lerAbaVT, lerTextoVA, mesDoTexto, valorBr } from "../src/lib/beneficios.ts";

test("valores e meses", () => {
  assert.equal(valorBr("R$585,10"), 585.1);
  assert.equal(valorBr(363.8), 363.8);
  assert.equal(valorBr("1.234,56"), 1234.56);
  assert.equal(valorBr("FÉRIAS"), null);
  assert.equal(mesDoTexto("VT AGOSTO "), 8);
  assert.equal(mesDoTexto("VT março"), 3);
  assert.equal(mesDoTexto("V A Mes 09"), 9);
  assert.equal(competenciaDoArquivo("V A Mes 09.pdf", "2026-11-16"), "2026-09-01");
  assert.equal(competenciaDoArquivo("V A Mes 12.pdf", "2026-01-10"), "2025-12-01");
});

test("aba do VT: período, total, férias e anotações; sem PIX", () => {
  const lote = lerAbaVT(
    "VT SETEMBRO ",
    [
      ["FUNCIONARIOS", "CPF:", "CONTA - PIX ", "VT  DO DIA 03/09/2026 ATÉ O DIA 01/10/2026 TOTAL DE DIAS  20 DIAS ", "TOTAL ", null],
      [" FULANA DE TAL ", "111.222.333-44", "fulana@exemplo.com", 240, 240, null],
      ["BELTRANO SILVA", 1234567890, 11999999999, "FÉRIAS ", 0, null],
      ["CICRANA SOUZA", "555.666.777-88", "x", 147.62, 268.4, "FÉRIAS 11 DIAS DE VT "],
      ["SEM CPF NOVATA", null, "pix", 240, 240, "ok"],
      [null, null, null, null, 728.4, null],
    ],
    "VT.xlsx",
    2026,
  )!;
  assert.equal(lote.tipo, "vt");
  assert.equal(lote.competencia, "2026-09-01");
  assert.equal(lote.linhas.length, 4, "linha do total fica de fora");
  const [a, b, c, d] = lote.linhas;
  assert.deepEqual([a.nome, a.cpf, a.valor, a.periodo_de, a.periodo_ate, a.observacao], ["FULANA DE TAL", "11122233344", 240, "2026-09-03", "2026-10-01", null]);
  assert.equal(b.cpf, "01234567890", "CPF numérico recupera o zero");
  assert.equal(b.valor, 0);
  assert.equal(b.observacao, "FÉRIAS");
  assert.equal(c.valor, 268.4, "vale o TOTAL");
  assert.match(c.observacao!, /FÉRIAS 11 DIAS/);
  assert.equal(d.cpf, null);
  assert.equal(d.observacao, null, "ok não vira observação");
  assert.ok(!JSON.stringify(lote).includes("exemplo.com"), "PIX não é lido");
});

test("PDF do auxílio-alimentação: nome, CPF, valor e situação", () => {
  const linhas = [
    "16/11/2026, 10:52 Pedidos | Portal Caixa",
    "RESULTADOS DA BUSCA",
    "Pessoa Um da Silva",
    "Emissão",
    "CPF Matrícula Produto Status Valor",
    "Cartão",
    "111.222.333-44",
    "Auxílio AgendadoNão R$150,00",
    "Local de Centro de Alimentação",
    "Entrega Custo",
    "Empresa exemplo",
    "PESSOA DOIS",
    "Emissão",
    "Produto Status Valor",
    "CPF Matrícula",
    "Cartão",
    "555.666.777-88",
    "Auxílio AgendadoNão R$585,10",
  ];
  const lote = lerTextoVA(linhas, "V A Mes 09.pdf", "2026-09-01")!;
  assert.equal(lote.tipo, "va");
  assert.deepEqual(
    lote.linhas.map((l) => [l.nome, l.cpf, l.valor, l.observacao]),
    [
      ["Pessoa Um da Silva", "11122233344", 150, "Agendado"],
      ["PESSOA DOIS", "55566677788", 585.1, "Agendado"],
    ],
  );
});
