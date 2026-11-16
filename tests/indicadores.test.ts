// Testes das regras da tela de Indicadores (src/lib/indicadores.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calcularPrazos,
  classificarCategorias,
  condicaoDaPessoa,
  diagnosticar,
  diasDaCondicao,
  mesesDaMedia,
  mesesEntre,
  montarMeses,
  ondeEstaOProblema,
  pontoEquilibrio,
  porCanal,
  vazio,
  type Categoria,
  type DadosIndicadores,
} from "../src/lib/indicadores.ts";

const cat = (id: string, nome: string, tipo: "receita" | "despesa", pai_id: string | null = null): Categoria => ({
  id,
  codigo: null,
  nome,
  tipo,
  pai_id,
});

test("categorias do Tiny viram grupos de gestão pelo nome (filha, depois mãe)", () => {
  const c = classificarCategorias([
    cat("r", "Receitas", "receita"),
    cat("r1", "Vendas de produtos", "receita", "r"),
    cat("rt", "Transferência entre contas", "receita"),
    cat("cp", "Custos de produção", "despesa"),
    cat("mp", "Matéria-prima e embalagens", "despesa", "cp"),
    cat("mo", "Mão de obra da produção", "despesa", "cp"),
    cat("en", "Energia", "despesa", "cp"),
    cat("pe", "Despesas com pessoal", "despesa"),
    cat("vt", "Vale transporte", "despesa", "pe"),
    cat("ou", "Outros", "despesa", "pe"),
    cat("im", "Simples Nacional - DAS", "despesa"),
    cat("co", "Comissões de vendedores", "despesa"),
    cat("fr", "Frete sobre vendas", "despesa"),
    cat("ju", "Juros bancários", "despesa"),
    cat("al", "Aluguel", "despesa"),
    cat("mq", "Compra de máquinas e equipamentos", "despesa"),
  ]);
  assert.equal(c.get("r1"), "receita");
  assert.equal(c.get("rt"), "transferencia");
  assert.equal(c.get("mp"), "materia_prima");
  assert.equal(c.get("mo"), "folha");
  assert.equal(c.get("en"), "fixa");
  assert.equal(c.get("vt"), "folha");
  assert.equal(c.get("ou"), "folha", "sem palavra conhecida, herda da mãe");
  assert.equal(c.get("im"), "deducao");
  assert.equal(c.get("co"), "variavel");
  assert.equal(c.get("fr"), "variavel");
  assert.equal(c.get("ju"), "financeiro");
  assert.equal(c.get("al"), "fixa");
  assert.equal(c.get("mq"), "investimento");
});

test("prazo em dias a partir da condição de pagamento", () => {
  assert.equal(diasDaCondicao("30/60/90"), 60);
  assert.equal(diasDaCondicao("28 dd"), 28);
  assert.equal(diasDaCondicao("À vista"), 0);
  assert.equal(diasDaCondicao("3x"), 60);
  assert.equal(diasDaCondicao("30 60"), 45);
  assert.equal(diasDaCondicao("boleto"), null);
  assert.equal(diasDaCondicao(null), null);
});

test("meses do período e meses da média (sem o mês pela metade)", () => {
  assert.deepEqual(mesesEntre("2026-11-01", "2027-01-31"), ["2026-11", "2026-12", "2027-01"]);
  assert.deepEqual(mesesDaMedia(["2026-09", "2026-10", "2026-11"], "2026-11-16"), ["2026-09", "2026-10"]);
  assert.deepEqual(mesesDaMedia(["2026-11"], "2026-11-16"), ["2026-11"]);
});

// Dois meses fechados: receita 100 mil; MP 40 mil; impostos 10 mil; folha
// 30 mil; aluguel 20 mil. Margem 50%; fixos sem folha 20 mil.
function dadosExemplo(): DadosIndicadores {
  const d = vazio("2026-11-16", "2026-09-01", "2026-11-30");
  for (const mes of ["2026-09", "2026-10"]) {
    d.titulos_mes.push(
      { tipo: "receber", mes, categoria_id: "r1", previsto: 100000, realizado: 90000, qtd: 10, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "mp", previsto: 40000, realizado: 40000, qtd: 5, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "im", previsto: 10000, realizado: 10000, qtd: 1, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "vt", previsto: 30000, realizado: 30000, qtd: 20, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "al", previsto: 20000, realizado: 20000, qtd: 1, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "rt", previsto: 5000, realizado: 5000, qtd: 1, tarifas: 0 },
    );
    d.pedidos_mes.push({ mes, canal: "venda_direta", entrada_qtd: 10, entrada_valor: 150000, saida_qtd: 6, saida_valor: 90000, ciclo_dias: 300 });
  }
  d.pedidos_etapa.push({
    etapa_id: "e1",
    nome: "Confirmado pelo cliente",
    fase: "producao",
    ordem: 30,
    qtd: 12,
    valor: 180000,
    dias_na_etapa: 20,
    idade_media: 50,
    idade_maxima: 90,
    atrasados: 6,
    valor_atrasado: 90000,
    atraso_medio: 15,
  });
  d.aberto.push(
    { tipo: "receber", faixa: "vence_30", valor: 60000, qtd: 6, dias_valor: 60000 * 20 },
    { tipo: "receber", faixa: "vencido_1_30", valor: 20000, qtd: 2, dias_valor: null },
    { tipo: "pagar", faixa: "vence_30", valor: 30000, qtd: 6, dias_valor: 30000 * 10 },
  );
  d.baixas_90d = { receber: 180000, pagar: 90000 };
  d.condicoes.push(
    { tipo: "receber", pessoa_id: "c1", condicao: "30/60/90", dias_parcelas: null, dias_pedido: null, valor: 100000 },
    { tipo: "receber", pessoa_id: "c1", condicao: "à vista", dias_parcelas: null, dias_pedido: null, valor: 20000 },
    { tipo: "pagar", pessoa_id: "f1", condicao: "28", dias_parcelas: null, dias_pedido: null, valor: 50000 },
    { tipo: "pagar", pessoa_id: "f1", condicao: null, dias_parcelas: 14, dias_pedido: null, valor: 50000 },
  );
  d.pontualidade.push({ tipo: "receber", qtd: 10, valor: 100000, em_dia: 7, valor_atrasado: 30000, dias_atraso_valor: 30000 * 12 });
  return d;
}

const CATEGORIAS = [
  cat("r1", "Venda de produtos", "receita"),
  cat("rt", "Transferência entre contas", "despesa"),
  cat("mp", "Matéria-prima", "despesa"),
  cat("im", "Impostos sobre vendas", "despesa"),
  cat("vt", "Salários", "despesa"),
  cat("al", "Aluguel", "despesa"),
];

test("resultado do mês: receita − variáveis − fixos, sem transferências", () => {
  const d = dadosExemplo();
  const linhas = montarMeses(d, classificarCategorias(CATEGORIAS), null);
  assert.equal(linhas.length, 3);
  const set = linhas[0];
  assert.equal(set.receita, 100000);
  assert.equal(set.variaveis, 50000);
  assert.equal(set.fixas, 50000);
  assert.equal(set.resultado, 0);
  assert.equal(set.pago, 100000, "transferência não entra no pago");
  assert.equal(linhas[2].receita, 0);
});

test("ponto de equilíbrio com a folha atual e com a folha de 15 mil", () => {
  const d = dadosExemplo();
  const linhas = montarMeses(d, classificarCategorias(CATEGORIAS), null);
  const pe = pontoEquilibrio(linhas, d.hoje, 15000);
  assert.equal(pe.meses, 2);
  assert.equal(pe.margem, 0.5);
  assert.equal(pe.fixasSemFolha, 20000);
  assert.equal(pe.folhaAtual, 30000);
  assert.equal(pe.origemFolha, "contas_pagar");
  assert.equal(pe.pontoAtual, 100000);
  assert.equal(pe.pontoAlvo, 70000);
  assert.equal(pe.falta, 0);
  assert.equal(pe.ticketMedio, 15000);
  assert.ok(Math.abs(pe.aumentoProducao! - (70000 / 90000 - 1)) < 1e-9);
});

test("folha dos holerites substitui a do contas a pagar", () => {
  const d = dadosExemplo();
  const folha = ["2026-09-01", "2026-10-01"].flatMap((competencia) => [
    { empresa_id: "a", competencia, setor: "producao", funcionarios: 10, custo: 30000 },
    { empresa_id: "a", competencia, setor: "administrativo", funcionarios: 5, custo: 15000 },
  ]);
  const linhas = montarMeses(d, classificarCategorias(CATEGORIAS), folha);
  assert.equal(linhas[0].folhaHolerite, 45000);
  assert.equal(linhas[0].funcionariosProducao, 10);
  assert.equal(linhas[2].folhaHolerite, null, "mês sem holerite fica vazio");
  const pe = pontoEquilibrio(linhas, d.hoje, 15000);
  assert.equal(pe.origemFolha, "holerites");
  assert.equal(pe.folhaAtual, 45000);
  assert.equal(pe.pontoAtual, 130000);
});

test("margem negativa: sem ponto de equilíbrio", () => {
  const d = vazio("2026-11-16", "2026-10-01", "2026-10-31");
  d.titulos_mes.push(
    { tipo: "receber", mes: "2026-10", categoria_id: "r1", previsto: 10000, realizado: 0, qtd: 1, tarifas: 0 },
    { tipo: "pagar", mes: "2026-10", categoria_id: "mp", previsto: 12000, realizado: 0, qtd: 1, tarifas: 0 },
  );
  const linhas = montarMeses(d, classificarCategorias(CATEGORIAS), null);
  const pe = pontoEquilibrio(linhas, d.hoje, 15000);
  assert.ok(pe.margem! < 0);
  assert.equal(pe.pontoAlvo, null);
  const diag = diagnosticar({ dados: d, linhas, pe, prazos: calcularPrazos(d) });
  assert.ok(diag.some((p) => p.titulo.startsWith("Margem negativa") && p.gravidade === "critico"));
});

test("prazos de recebimento × pagamento", () => {
  const p = calcularPrazos(dadosExemplo());
  assert.equal(p.receber.aberto, 80000);
  assert.equal(p.receber.vencido, 20000);
  assert.equal(p.receber.pelaMedia, 40);
  assert.equal(p.receber.condicao, (60 * 100000 + 0 * 20000) / 120000);
  assert.equal(p.receber.aVencer, 20);
  assert.equal(p.receber.emDia, 0.7);
  assert.equal(p.receber.atrasoMedio, 12);
  assert.equal(p.pagar.condicao, 21, "parcelas do pedido têm prioridade sobre o texto");
  assert.equal(p.ciclo, 50 - 21);
});

test("condição principal de cada cliente pelo valor dos pedidos", () => {
  const c = condicaoDaPessoa(dadosExemplo(), "receber", "c1");
  assert.equal(c.condicao, "30/60/90");
  assert.equal(c.pedidos, 2);
  assert.equal(c.dias, 50);
});

test("canais: B2B com dados, e-commerce vazio aguardando", () => {
  const canais = porCanal(dadosExemplo());
  const b2b = canais.find((c) => c.canal === "venda_direta")!;
  assert.equal(b2b.pedidos, 20);
  assert.equal(b2b.ticket, 15000);
  assert.equal(canais.find((c) => c.canal === "mercado_livre")!.temDados, false);
});

test("diagnóstico aponta a produção como o problema", () => {
  const d = dadosExemplo();
  const linhas = montarMeses(d, classificarCategorias(CATEGORIAS), null);
  const pe = pontoEquilibrio(linhas, d.hoje, 15000);
  const diag = diagnosticar({ dados: d, linhas, pe, prazos: calcularPrazos(d) });
  const producao = diag.find((p) => p.titulo === "A produção não acompanha as vendas")!;
  assert.equal(producao.gravidade, "critico", "sai 60% do que entra");
  assert.match(producao.texto, /60%/);
  const fila = diag.find((p) => p.titulo === "Fila de pedidos na fábrica")!;
  assert.equal(fila.gravidade, "critico", "2 meses de fila");
  assert.equal(diag.find((p) => p.titulo === "Pedidos com entrega atrasada")!.gravidade, "critico");
  assert.equal(diag[0].gravidade, "critico", "críticos primeiro");
  assert.deepEqual(ondeEstaOProblema(diag), { area: "Produção", criticos: diag.filter((p) => p.gravidade === "critico").length });
});

test("sem dados: diagnóstico avisa em vez de inventar", () => {
  const d = vazio("2026-11-16", "2026-10-01", "2026-10-31");
  const linhas = montarMeses(d, new Map(), null);
  const pe = pontoEquilibrio(linhas, d.hoje, 15000);
  const diag = diagnosticar({ dados: d, linhas, pe, prazos: calcularPrazos(d) });
  assert.ok(diag.every((p) => p.gravidade === "sem_dados"));
  assert.equal(ondeEstaOProblema(diag).area, null);
});

test("folha completa: holerites + VT + auxílio + ajuda de custo (em outra categoria)", () => {
  const d = dadosExemplo();
  // Ajuda de custo de 3 mil por mês lançada em "Aluguel" (categoria errada).
  const ajuda = ["2026-09", "2026-10"].map((mes) => ({ mes, pessoa: "Pessoa A", categoria_id: "al", categoria: "Aluguel", valor: 3000, qtd: 1 }));
  const folha = ["2026-09-01", "2026-10-01"].map((competencia) => ({ empresa_id: "a", competencia, setor: "producao", funcionarios: 10, custo: 30000 }));
  const beneficios = ["2026-09-01", "2026-10-01"].flatMap((competencia) => [
    { empresa_id: "a", competencia, tipo: "vt" as const, setor: "producao", pessoas: 10, valor: 4000 },
    { empresa_id: "a", competencia, tipo: "va" as const, setor: "sem_setor", pessoas: 5, valor: 1000 },
  ]);
  const linhas = montarMeses(d, classificarCategorias(CATEGORIAS), folha, { beneficios, ajuda });
  const set = linhas[0];
  assert.equal(set.porClasse.fixa, 17000, "ajuda sai do aluguel");
  assert.equal(set.porClasse.folha, 33000, "e entra na folha do contas a pagar");
  assert.equal(set.vt, 4000);
  assert.equal(set.va, 1000);
  assert.equal(set.folhaTotal, 38000);
  assert.equal(set.folhaProducao, 34000, "VT da produção entra na folha da produção");
  assert.equal(linhas[2].folhaTotal, null);
  const pe = pontoEquilibrio(linhas, d.hoje, 15000);
  assert.equal(pe.folhaAtual, 38000);
  assert.equal(pe.fixasSemFolha, 17000);
});
