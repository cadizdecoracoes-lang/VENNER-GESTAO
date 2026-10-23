// Testes da leitura dos holerites em PDF (posições como as do PDF da folha)
// e da prévia da importação.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lerPaginasHolerite, resumirImportacao, valorBr, type HoleriteArquivo, type Peca } from "../src/lib/holerite.ts";

// Um recibo como o sistema da folha desenha: topo em `y`, eventos [código, descrição, referência, valor, desconto?].
function recibo(y: number, tipo: string, mes: string, func: [string, string, string, string], eventos: [string, string, string, string, boolean][], totais: [string, string, string], salario: string): Peca[] {
  const p = (x: number, dy: number, s: string): Peca => ({ x, y: y - dy, s });
  const pecas = [
    p(38, 0, "EMPRESA DE SERVICOS TESTE LTDA"), p(434, 1, "RECIBO DE PAGAMENTO"),
    p(38, 11, "RUA TESTE 100"), p(263, 11, "SAO PAULO - SP"), p(483, 11, tipo),
    p(38, 22, "22.333.444/0001-55"), p(480, 22, mes),
    p(54, 33, "Código"), p(82, 33, "Nome"), p(299, 33, "Cbo"), p(335, 33, "Empresa"), p(547, 33, "Folha"),
    p(63, 45, func[0]), p(82, 45, func[1]), p(301, 45, func[2]), p(548, 45, "1"),
    p(82, 56, func[3]),
    p(33, 69, "Código"), p(67, 69, "Descrição"), p(284, 69, "Referência"), p(441, 69, "Vencimentos"), p(530, 69, "Descontos"),
    p(439, 233, "Total Vencimentos"), p(524, 233, "Total Descontos"),
    p(467, 241, totais[0]), p(555, 241, totais[1]),
    p(449, 254, "Total Liquido -->"), p(546, 253, totais[2]),
    p(75, 265, "Salario Base"), p(202, 265, "Sal.Contr.INSS"), p(282, 265, "Base Calculo FGTS"), p(368, 265, "FGTS do MES"),
    p(441, 265, "Base Calculo IRRF"), p(527, 265, "Faixa IRRF"),
    p(78, 275, salario), p(211, 275, "2.000,00"), p(298, 275, "2.000,00"), p(378, 275, "160,00"), p(455, 275, "2.000,00"), p(535, 275, "*****"),
    p(129, 300, "Assinatura"),
  ];
  eventos.forEach(([cod, desc, ref, valor, desconto], i) => {
    const dy = 81 + i * 9;
    pecas.push(p(54, dy, cod), p(68, dy, desc), p(desconto ? 555 : 466, dy, valor));
    if (ref) pecas.push(p(309, dy, ref));
  });
  return pecas;
}

const mensal = (y: number) =>
  recibo(y, "MENSAL", "Março/2026", ["160", "FULANO DE TAL", "784205", "OPERADOR DE MAQUINA"], [
    ["1", "Salário", "30,00", "2.000,00", false],
    ["17", "Horas Extras 50%", "2,50", "34,09", false],
    ["11", "INSS Sobre Salário", "7,50", "152,56", true],
    ["12", "Adiantamento Anterior", "", "800,00", true],
  ], ["2.034,09", "952,56", "1.081,53"], "2.000,00");

test("valores no formato brasileiro", () => {
  assert.equal(valorBr("1.980,87"), 1980.87);
  assert.equal(valorBr("*****"), 0);
  assert.equal(valorBr("9,90"), 9.9);
});

test("lê o recibo pelas posições e junta as duas vias da página", () => {
  const { holerites, avisos } = lerPaginasHolerite([[...mensal(755), ...mensal(376)]], "03-2026 mensal.pdf");
  assert.deepEqual(avisos, []);
  assert.equal(holerites.length, 1);
  const h = holerites[0];
  assert.equal(h.empregador_cnpj, "22333444000155");
  assert.equal(h.empregador_nome, "EMPRESA DE SERVICOS TESTE LTDA");
  assert.equal(h.tipo, "mensal");
  assert.equal(h.competencia, "2026-03");
  assert.equal(h.matricula, "160");
  assert.equal(h.nome, "FULANO DE TAL");
  assert.equal(h.cbo, "784205");
  assert.equal(h.cargo, "OPERADOR DE MAQUINA");
  assert.deepEqual(
    h.eventos.map((e) => [e.codigo, e.referencia, e.valor, e.natureza]),
    [["1", 30, 2000, "provento"], ["17", 2.5, 34.09, "provento"], ["11", 7.5, 152.56, "desconto"], ["12", null, 800, "desconto"]],
  );
  assert.equal(h.total_proventos, 2034.09);
  assert.equal(h.total_descontos, 952.56);
  assert.equal(h.liquido, 1081.53);
  assert.equal(h.salario_base, 2000);
  assert.equal(h.fgts, 160);
});

test("adiantamento e aviso quando os eventos não fecham com os totais", () => {
  const vale = recibo(755, "ADTO", "Janeiro/2026", ["69", "CICLANA", "414140", "AUXILIAR"], [["20", "Adiantamento Crédito", "40,00", "800,00", false]], ["800,00", "*****", "800,00"], "2.000,00");
  const errado = recibo(376, "MENSAL", "Janeiro/2026", ["70", "BELTRANO", "414140", "AUXILIAR"], [["1", "Salário", "30,00", "100,00", false]], ["200,00", "*****", "200,00"], "2.000,00");
  const { holerites, avisos } = lerPaginasHolerite([[...vale, ...errado]], "jan.pdf");
  assert.equal(holerites.length, 2);
  assert.equal(holerites[0].tipo, "adiantamento");
  assert.equal(holerites[0].total_descontos, 0);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /jan\.pdf, página 1: os eventos de BELTRANO não somam/);
});

test("prévia: novos, mudanças, já importados e quem ficou sem holerite no último mês", () => {
  const base = { empregador_nome: "EMPRESA", empregador_cnpj: "22333444000155", cbo: null, eventos: [], total_proventos: 0, total_descontos: 0,
    base_inss: 0, base_fgts: 0, fgts: 0, base_irrf: 0, arquivo: "x.pdf" };
  const h = (matricula: string, nome: string, competencia: string, tipo: string, cargo: string, salario: number, liquido = 100): HoleriteArquivo =>
    ({ ...base, matricula, nome, competencia, tipo, cargo, salario_base: salario, liquido });
  const lote = [
    h("1", "ANA", "2026-08", "mensal", "AUXILIAR", 2000),
    h("1", "ANA", "2026-09", "mensal", "OPERADORA", 2500),
    h("1", "ANA", "2026-09", "adiantamento", "OPERADORA", 2500),
    h("2", "BIA", "2026-08", "mensal", "AUXILIAR", 2000),
    h("3", "CAIO", "2026-09", "mensal", "AUXILIAR", 1900),
  ];
  const empresas = [{ id: "e1", cnpj: "22333444000155", nome: "Prestadora" }];
  const funcionarios = [
    { id: "f1", empresa_id: "e1", matricula: "1", nome: "ANA", cargo: "AUXILIAR", salario_base: 2000, ativo: true },
    { id: "f9", empresa_id: "e1", matricula: "9", nome: "DIEGO", cargo: "AUXILIAR", salario_base: 2000, ativo: true },
  ];
  const meses = [{ empresa_id: "e1", competencia: "2026-08-01", tipo: "mensal", matriculas: ["1", "9"] }];
  const [g] = resumirImportacao(lote, empresas, funcionarios, meses);
  assert.equal(g.empresa?.id, "e1");
  assert.equal(g.ultimoMes, "2026-09");
  assert.deepEqual(g.novos.map((n) => n.matricula), ["2", "3"]);
  assert.deepEqual(g.mudancas.map((m) => m.depois), ["OPERADORA", "salário 2500,00"]);
  assert.equal(g.meses.find((m) => m.competencia === "2026-08" && m.tipo === "mensal")?.jaImportados, 1);
  assert.deepEqual(
    g.semHoleriteNoUltimoMes.map((s) => [s.nome, s.ultimo]),
    [["BIA", "2026-08"], ["DIEGO", "2026-08"]],
  );

  // Lote mais antigo que o banco não sugere desligar ninguém.
  const antigos = resumirImportacao([h("1", "ANA", "2026-07", "mensal", "AUXILIAR", 1800)], empresas, funcionarios, meses);
  assert.deepEqual(antigos[0].semHoleriteNoUltimoMes, []);
  assert.deepEqual(antigos[0].mudancas, []);

  // CNPJ que não está cadastrado fica sem empresa.
  assert.equal(resumirImportacao([{ ...lote[0], empregador_cnpj: "11111111000111" }], empresas, funcionarios, meses)[0].empresa, null);
});
