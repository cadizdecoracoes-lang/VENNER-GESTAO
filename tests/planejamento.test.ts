// Testes do cálculo de necessidade de materiais e da fila de produção.
// Rodam com: npm test (node --test, sem dependências).
import assert from "node:assert/strict";
import { test } from "node:test";
import { filaProducao, necessidadeMateriais, type DadosPlanejamento } from "../src/lib/planejamento.ts";

const item = (id: string, tipo: string, saldo: number, extra: Partial<{ estoque_minimo: number; prazo_reposicao_dias: number }> = {}) => ({
  id,
  codigo: id,
  descricao: id,
  tipo,
  unidade: "UN",
  prazo_reposicao_dias: extra.prazo_reposicao_dias ?? 0,
  estoque_minimo: extra.estoque_minimo ?? 0,
  custo_medio: 0,
  saldo,
});

// PA = 1 SC + 2 MP-A; SC = 3 MP-B (10% de perda).
function dados(): DadosPlanejamento {
  return {
    itens: [
      item("PA", "produto_acabado", 1),
      item("SC", "subconjunto", 2),
      item("MPA", "materia_prima", 10, { estoque_minimo: 5, prazo_reposicao_dias: 7 }),
      item("MPB", "materia_prima", 9),
    ],
    fichas: [
      {
        item_id: "PA",
        quantidade_base: 1,
        componentes: [
          { componente_id: "SC", quantidade: 1, perda_percentual: 0 },
          { componente_id: "MPA", quantidade: 2, perda_percentual: 0 },
        ],
        operacoes: [{ posto_id: "MONT", tempo_setup_min: 30, tempo_execucao_min: 60 }],
      },
      {
        item_id: "SC",
        quantidade_base: 1,
        componentes: [{ componente_id: "MPB", quantidade: 3, perda_percentual: 10 }],
        operacoes: [{ posto_id: "CORTE", tempo_setup_min: 0, tempo_execucao_min: 30 }],
      },
    ],
    postos: [
      { id: "MONT", nome: "Montagem", capacidade_horas_dia: 8 },
      { id: "CORTE", nome: "Corte", capacidade_horas_dia: 8 },
    ],
    pedidos: [],
  };
}
const pedido = (
  numero: number,
  qtd: number,
  extra: Partial<{ prazo_entrega: string; valor: number; prioridade: number; prazo_recebimento_dias: number }> = {},
) => ({
  id: `p${numero}`,
  numero,
  empresa_id: "e",
  cliente: "c",
  data_pedido: "2026-09-01",
  prazo_entrega: extra.prazo_entrega ?? "2026-10-30",
  prazo_recebimento_dias: extra.prazo_recebimento_dias ?? 30,
  prioridade: extra.prioridade ?? 0,
  etapa: "Confirmado",
  etapa_ordem: 30,
  itens: [{ item_id: "PA", quantidade: qtd, valor_total: extra.valor ?? qtd * 100 }],
});

test("necessidade desconta o estoque em cada nível da estrutura", () => {
  const d = dados();
  d.pedidos = [pedido(1, 6, { prazo_entrega: "2026-10-30" })];
  const linhas = new Map(necessidadeMateriais(d, "2026-10-19").map((l) => [l.item.id, l]));
  // 6 PA - 1 em estoque = 5 a produzir; SC: 5 - 2 = 3; MPA: 5 x 2 = 10 (tem 10); MPB: 3 x 3 x 1,1 = 9,9 (tem 9).
  assert.equal(linhas.get("PA")!.falta, 5);
  assert.equal(linhas.get("SC")!.necessidade, 5);
  assert.equal(linhas.get("SC")!.falta, 3);
  assert.equal(linhas.get("MPA")!.falta, 0);
  assert.equal(linhas.get("MPA")!.sugestao, 5, "repõe o estoque mínimo");
  assert.equal(linhas.get("MPA")!.data_limite, "2026-10-23", "prazo do pedido menos 7 dias de reposição");
  assert.equal(linhas.get("MPB")!.falta, 0.9);
  assert.deepEqual(linhas.get("MPB")!.pedidos, [1]);
});

test("fila põe primeiro quem tem material e respeita atraso e prioridade", () => {
  const d = dados();
  d.pedidos = [
    pedido(1, 2, { prazo_entrega: "2026-10-25" }),
    pedido(2, 20, { prazo_entrega: "2026-08-20" }), // 60 dias de atraso, mas falta material
    pedido(3, 1, { prazo_entrega: "2026-12-01", prioridade: 2 }),
  ];
  const fila = filaProducao(d, "2026-10-19");
  assert.deepEqual(
    fila.map((f) => [f.pedido.numero, f.pode_produzir]),
    [
      [3, true],
      [1, true],
      [2, false],
    ],
  );
  const bloqueado = fila[2];
  assert.equal(bloqueado.dias_atraso, 60);
  assert.ok(bloqueado.faltas.some((f) => f.item.id === "MPA"));
  assert.ok(bloqueado.motivos.some((m) => m.startsWith("60 dias de atraso")));
  assert.equal(fila[0].atendido_estoque, true, "1 PA em estoque atende o pedido 3");
  assert.ok(fila[1].previsao, "pedido com material tem previsão");
});

test("pedido bloqueado não reserva material de quem vem depois", () => {
  const d = dados();
  d.pedidos = [pedido(1, 50, { prazo_entrega: "2026-08-01" }), pedido(2, 2, { prazo_entrega: "2026-11-30" })];
  const fila = filaProducao(d, "2026-10-19");
  assert.equal(fila[0].pedido.numero, 2);
  assert.equal(fila[0].pode_produzir, true);
  assert.equal(fila[1].pode_produzir, false);
});
