// Testes da leitura das vendas do Mercado Livre e da Shopee (planilha e API).
// Rodam com: npm test (node --test, sem dependências).
import assert from "node:assert/strict";
import { test } from "node:test";
import { acharCabecalho, lerData, lerValor, lerVendas, mapearColunas } from "../src/lib/plataformas/planilha.ts";
import { converterPedidoML } from "../src/lib/plataformas/mercado-livre.ts";
import { converterPedidoShopee } from "../src/lib/plataformas/shopee.ts";
import { diasDaCondicao, dividirParcelas } from "../src/lib/parcelas.ts";

test("valores e datas no formato brasileiro", () => {
  assert.equal(lerValor("R$ 1.234,56"), 1234.56);
  assert.equal(lerValor("-12,5"), -12.5);
  assert.equal(lerValor(""), 0);
  assert.equal(lerValor(42), 42);
  assert.equal(lerData("15/10/2026 14:32"), "2026-10-15");
  assert.equal(lerData("2026-10-15 14:32"), "2026-10-15");
  assert.equal(lerData("15 de outubro de 2026 14:32 hs."), "2026-10-15");
  assert.equal(lerData("5 de março de 2026"), "2026-03-05");
  assert.equal(lerData(new Date("2026-10-15T00:00:00Z")), "2026-10-15");
  assert.equal(lerData("ontem"), null);
});

// Planilha do Mercado Livre: linhas de título antes do cabeçalho, valores com sinal.
const planilhaML = [
  ["Vendas", null, null],
  ["Período: outubro", null, null],
  [
    "N.º de venda",
    "Data da venda",
    "Estado",
    "Unidades",
    "Receita por produtos (BRL)",
    "Tarifa de venda e impostos (BRL)",
    "Tarifas de envio (BRL)",
    "Total (BRL)",
    "# de anúncio",
    "Título do anúncio",
    "Comprador",
  ],
  ["2000001", "15 de outubro de 2026 10:00 hs.", "Entregue", 2, "250,00", "-30,00", "-10,00", "210,00", "MLB123", "Kit", "Ana"],
  ["2000002", "16 de outubro de 2026 11:00 hs.", "Cancelada pelo comprador", 1, "100,00", "0", "0", "0", "MLB123", "Kit", "Bia"],
  ["2000003", "16 de outubro de 2026 12:00 hs.", "Pacote de 2 produtos", null, null, null, null, null, null, null, "Caio"],
  ["2000003", "16 de outubro de 2026 12:00 hs.", "Entregue", 1, "80,00", "-8,00", "0", "72,00", "MLB200", "Cadeira", "Caio"],
  ["2000003", "16 de outubro de 2026 12:00 hs.", "Entregue", 1, "20,00", "-2,00", "0", "18,00", "MLB300", "Almofada", "Caio"],
];

test("planilha do Mercado Livre", () => {
  const cab = acharCabecalho(planilhaML, "mercado_livre");
  assert.equal(cab, 2);
  const mapa = mapearColunas(planilhaML[cab], "mercado_livre");
  assert.deepEqual(mapa, {
    numero: 0,
    data: 1,
    situacao: 2,
    codigo: 8,
    titulo: 9,
    quantidade: 3,
    valor: 4,
    tarifas: 5,
    frete: 6,
    liquido: 7,
    comprador: 10,
  });
  const { vendas, ignoradas, problemas } = lerVendas(planilhaML, cab + 1, mapa, 15);
  assert.equal(ignoradas, 1);
  assert.deepEqual(problemas, []);
  assert.deepEqual(vendas[0], {
    numero: "2000001",
    data: "2026-10-15",
    liberacao: "2026-10-30",
    comprador: "Ana",
    valor: 250,
    tarifas: 40,
    itens: [{ codigo: "MLB123", titulo: "Kit", quantidade: 2, valor: 250 }],
  });
  // Pacote: a linha de resumo fica de fora e os produtos viram uma venda só.
  assert.equal(vendas[1].numero, "2000003");
  assert.equal(vendas[1].valor, 100);
  assert.equal(vendas[1].tarifas, 10);
  assert.deepEqual(
    vendas[1].itens.map((i) => i.codigo),
    ["MLB200", "MLB300"],
  );
});

test("planilha da Shopee", () => {
  const linhas = [
    [
      "ID do pedido",
      "Status do pedido",
      "Data de criação do pedido",
      "Nome do Produto",
      "Número de referência SKU",
      "Quantidade",
      "Subtotal do produto",
      "Taxa de comissão",
      "Taxa de serviço",
      "Nome de usuário (comprador)",
    ],
    ["2610ABC", "Concluído", "2026-10-15 09:12", "Banqueta", "BQ-01", "3", "300,00", "36,00", "6,00", "dani"],
    ["2610XYZ", "Cancelado", "2026-10-15 09:30", "Banqueta", "BQ-01", "1", "100,00", "0", "0", "edu"],
  ];
  const mapa = mapearColunas(linhas[0], "shopee");
  assert.equal(mapa.codigo, 4);
  const { vendas, ignoradas } = lerVendas(linhas, 1, mapa, 7);
  assert.equal(ignoradas, 1);
  assert.deepEqual(vendas, [
    {
      numero: "2610ABC",
      data: "2026-10-15",
      liberacao: "2026-10-22",
      comprador: "dani",
      valor: 300,
      tarifas: 42,
      itens: [{ codigo: "BQ-01", titulo: "Banqueta", quantidade: 3, valor: 300 }],
    },
  ]);
});

test("planilha sem as colunas essenciais pede a escolha", () => {
  const r = lerVendas([["x"], ["1"]], 1, { numero: 0 }, 0);
  assert.equal(r.vendas.length, 0);
  assert.match(r.problemas[0], /Data da venda/);
});

test("pedido da API do Mercado Livre", () => {
  const pedido = {
    id: 2000009,
    status: "paid",
    date_created: "2026-10-15T10:00:00.000-04:00",
    buyer: { nickname: "ANA123" },
    order_items: [{ item: { id: "MLB123", title: "Kit" }, quantity: 2, unit_price: 125, sale_fee: 15 }],
    payments: [{ status: "approved", money_release_date: "2026-11-01T00:00:00.000-04:00" }],
  };
  assert.deepEqual(converterPedidoML(pedido, 15, 12.5), {
    numero: "2000009",
    data: "2026-10-15",
    liberacao: "2026-11-01",
    comprador: "ANA123",
    valor: 250,
    tarifas: 42.5,
    itens: [{ codigo: "MLB123", titulo: "Kit", quantidade: 2, valor: 250 }],
  });
  assert.equal(converterPedidoML({ ...pedido, payments: [] }, 15)?.liberacao, "2026-10-30");
  assert.equal(converterPedidoML({ ...pedido, status: "cancelled" }, 15), null);
});

test("pedido da API da Shopee", () => {
  const pedido = {
    order_sn: "2610ABC",
    order_status: "COMPLETED",
    create_time: Date.parse("2026-10-15T12:00:00Z") / 1000,
    buyer_username: "dani",
    item_list: [
      { item_id: 9, item_name: "Banqueta", item_sku: "BQ", model_sku: "BQ-01", model_quantity_purchased: 3, model_discounted_price: 100 },
    ],
  };
  const v = converterPedidoShopee(pedido, { escrow_amount: 258 }, 7);
  assert.equal(v?.data, "2026-10-15");
  assert.equal(v?.liberacao, "2026-10-22");
  assert.equal(v?.tarifas, 42);
  assert.equal(v?.itens[0].codigo, "BQ-01");
  assert.equal(converterPedidoShopee(pedido, null, 7)?.tarifas, 0);
  assert.equal(converterPedidoShopee({ ...pedido, order_status: "CANCELLED" }, null, 7), null);
});

test("parcelas pela condição de pagamento", () => {
  assert.deepEqual(diasDaCondicao("30/60/90", 0), [30, 60, 90]);
  assert.deepEqual(diasDaCondicao("28 e 56 dias", 0), [28, 56]);
  assert.deepEqual(diasDaCondicao("À vista", 0), [0]);
  assert.deepEqual(diasDaCondicao(null, 45), [45]);
  assert.deepEqual(dividirParcelas(100, [30, 60, 90], "2026-10-01"), [
    { valor: 33.33, vencimento: "2026-10-31" },
    { valor: 33.33, vencimento: "2026-11-30" },
    { valor: 33.34, vencimento: "2026-12-30" },
  ]);
});
