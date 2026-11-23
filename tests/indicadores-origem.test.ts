// Testes da origem dos números da tela de Indicadores
// (src/lib/indicadores-origem.ts): a composição soma exatamente o número da
// tela, e o filtro dos lançamentos pega as mesmas categorias.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classificarCategorias,
  mesesDaMedia,
  montarMeses,
  pontoEquilibrio,
  vazio,
  type AjudaCusto,
  type Categoria,
  type DadosIndicadores,
  type FolhaMes,
} from "../src/lib/indicadores.ts";
import { descreverOrigem, totalDaComposicao, type ContextoOrigem } from "../src/lib/indicadores-origem.ts";

const cat = (id: string, nome: string, tipo: "receita" | "despesa"): Categoria => ({ id, codigo: null, nome, tipo, pai_id: null });
const CATEGORIAS = [
  cat("r1", "Venda de produtos", "receita"),
  cat("tr", "Transferência entre contas", "receita"),
  cat("mp", "Matéria-prima", "despesa"),
  cat("im", "Impostos sobre vendas", "despesa"),
  cat("sa", "Salários", "despesa"),
  cat("al", "Aluguel", "despesa"),
  cat("sv", "Serviços de terceiros", "despesa"),
];

function contexto(folha: FolhaMes[] | null = null): ContextoOrigem {
  const d: DadosIndicadores = vazio("2026-11-16", "2026-09-01", "2026-11-30");
  for (const mes of ["2026-09", "2026-10"]) {
    d.titulos_mes.push(
      { tipo: "receber", mes, categoria_id: "r1", previsto: 100000, realizado: 90000, qtd: 10, tarifas: 0 },
      { tipo: "receber", mes, categoria_id: "tr", previsto: 7000, realizado: 7000, qtd: 1, tarifas: 0 },
      { tipo: "receber", mes, categoria_id: null, previsto: 3000, realizado: 0, qtd: 1, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "mp", previsto: 40000, realizado: 40000, qtd: 5, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "im", previsto: 10000, realizado: 10000, qtd: 1, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "sa", previsto: 30000, realizado: 30000, qtd: 20, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "al", previsto: 20000, realizado: 20000, qtd: 1, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: "sv", previsto: 6000, realizado: 6000, qtd: 2, tarifas: 0 },
      { tipo: "pagar", mes, categoria_id: null, previsto: 500, realizado: 0, qtd: 1, tarifas: 0 },
    );
    d.pedidos_mes.push({ mes, canal: "venda_direta", entrada_qtd: 10, entrada_valor: 150000, saida_qtd: 6, saida_valor: 90000, ciclo_dias: 300 });
  }
  // Ajuda de custo de 2.000 lançada em "Serviços de terceiros" (despesa fixa).
  const ajuda: AjudaCusto[] = [{ mes: "2026-10", pessoa: "Pessoa A", categoria_id: "sv", categoria: "Serviços de terceiros", valor: 2000, qtd: 1 }];
  const classes = classificarCategorias(CATEGORIAS);
  const linhas = montarMeses(d, classes, folha, { beneficios: [], ajuda });
  const mesesMedia = mesesDaMedia(linhas.map((l) => l.mes), d.hoje);
  const pe = pontoEquilibrio(linhas, d.hoje, 15000);
  return { dados: d, linhas, mesesMedia, classes, categorias: CATEGORIAS, folha, beneficios: [], ajuda, pe, folhaAlvo: 15000 };
}

test("a composição de cada linha soma o número da tela, mês a mês", () => {
  const ctx = contexto();
  const conferir = (chave: string, valor: (m: string) => number) => {
    for (const mes of ["2026-09", "2026-10"]) {
      const o = descreverOrigem(chave, ctx, mes, undefined);
      assert.ok(o?.composicao, chave);
      assert.equal(totalDaComposicao(o.composicao, o.meses), valor(mes), `${chave} em ${mes}`);
    }
  };
  const linha = (mes: string) => ctx.linhas.find((l) => l.mes === mes)!;
  conferir("receita", (m) => linha(m).receita);
  conferir("grupo:variaveis", (m) => linha(m).variaveis);
  conferir("grupo:fixas", (m) => linha(m).fixas);
  conferir("classe:folha", (m) => linha(m).porClasse.folha);
  conferir("classe:fixa", (m) => linha(m).porClasse.fixa);
  conferir("caixa:recebido", (m) => linha(m).recebido);
  conferir("caixa:pago", (m) => linha(m).pago);
  conferir("pedidos:entrada", (m) => linha(m).entradaPedidos);
});

test("ajuda de custo de outra categoria aparece saindo da despesa fixa e entrando na folha", () => {
  const ctx = contexto();
  const fixa = descreverOrigem("classe:fixa", ctx, "2026-10", undefined)!;
  const folha = descreverOrigem("classe:folha", ctx, "2026-10", undefined)!;
  assert.equal(fixa.composicao?.find((l) => l.sub === "ajuda")?.porMes["2026-10"], -2000);
  assert.equal(folha.composicao?.find((l) => l.sub === "ajuda")?.porMes["2026-10"], 2000);
  // Sem categoria conta como despesa fixa.
  assert.equal(fixa.composicao?.find((l) => l.sub === "sem")?.porMes["2026-10"], 500);
});

test("filtro dos lançamentos: mesmas categorias da linha, sem categoria só nas fixas", () => {
  const ctx = contexto();
  const fixa = descreverOrigem("classe:fixa", ctx, undefined, undefined)!;
  assert.deepEqual(fixa.filtro, { fonte: "titulos", tipo: "pagar", base: "vencimento", categorias: ["al", "sv"], sem_categoria: true });
  const variaveis = descreverOrigem("grupo:variaveis", ctx, undefined, undefined)!;
  assert.deepEqual(variaveis.filtro, { fonte: "titulos", tipo: "pagar", base: "vencimento", categorias: ["mp", "im"], sem_categoria: false });
  // Receita: tudo do contas a receber menos as transferências.
  assert.deepEqual(descreverOrigem("receita", ctx, undefined, undefined)!.filtro, {
    fonte: "titulos",
    tipo: "receber",
    base: "vencimento",
    excluir_categorias: ["tr"],
  });
  // Uma linha escolhida restringe os lançamentos a ela.
  assert.deepEqual(descreverOrigem("classe:fixa", ctx, undefined, "al")!.filtro, { fonte: "titulos", tipo: "pagar", base: "vencimento", categorias: ["al"] });
  assert.deepEqual(descreverOrigem("classe:fixa", ctx, undefined, "ajuda")!.filtro, { fonte: "titulos", tipo: "pagar", base: "vencimento", ajuda: true });
});

test("média usa os meses fechados; mês escolhido usa só ele", () => {
  const ctx = contexto();
  assert.deepEqual(descreverOrigem("receita", ctx, "media", undefined)!.meses, ["2026-09", "2026-10"]);
  assert.deepEqual(descreverOrigem("receita", ctx, "2026-10", undefined)!.meses, ["2026-10"]);
  assert.deepEqual(descreverOrigem("receita", ctx, undefined, undefined)!.meses, ["2026-09", "2026-10", "2026-11"]);
  assert.equal(descreverOrigem("aberto:pagar:vence_30", ctx, undefined, undefined)!.meses.length, 0);
});

test("contas do ponto de equilíbrio fecham com o número da tela", () => {
  const ctx = contexto();
  const ultimo = (chave: string) => descreverOrigem(chave, ctx, "media", undefined)!.calculo!.at(-1)!.valor;
  assert.equal(ultimo("calc:ponto"), ctx.pe.pontoAtual);
  assert.equal(ultimo("calc:ponto_alvo"), ctx.pe.pontoAlvo);
  assert.equal(ultimo("calc:margem"), ctx.pe.margem);
  assert.equal(ultimo("calc:pedidos_alvo"), ctx.pe.pedidosNecessarios);
  assert.equal(ultimo("calc:fixos_alvo"), ctx.pe.fixasSemFolha + ctx.pe.folhaAlvo);
  // Cada termo com origem leva a outra origem que existe.
  for (const chave of ["calc:ponto", "calc:margem", "calc:producao", "calc:resultado"])
    for (const t of descreverOrigem(chave, ctx, "media", undefined)!.calculo!) if (t.origem) assert.ok(descreverOrigem(t.origem, ctx, "media", undefined), t.origem);
});

test("folha com holerites: composição por setor + benefícios + ajuda; linha escolhida pela chave", () => {
  const folha: FolhaMes[] = [
    { empresa_id: "e", competencia: "2026-10-01", setor: "producao", funcionarios: 5, custo: 12000 },
    { empresa_id: "e", competencia: "2026-10-01", setor: "administrativo", funcionarios: 2, custo: 6000 },
  ];
  const ctx = contexto(folha);
  const o = descreverOrigem("folha", ctx, "2026-10", undefined)!;
  assert.equal(totalDaComposicao(o.composicao!, o.meses), ctx.linhas.find((l) => l.mes === "2026-10")!.folhaTotal);
  assert.deepEqual(o.filtro, { fonte: "folha", partes: ["holerites", "vt", "va", "ajuda"] });
  const vt = descreverOrigem("folha::vt", ctx, "2026-10", undefined)!;
  assert.equal(vt.sub, "vt");
  assert.deepEqual(vt.filtro, { fonte: "folha", partes: ["vt"] });
});

test("chave desconhecida não abre nada", () => {
  assert.equal(descreverOrigem("outra:coisa", contexto(), undefined, undefined), null);
});
