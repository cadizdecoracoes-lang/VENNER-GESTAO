// Testes da leitura do Tiny: conversão das respostas da API e uma leitura
// completa com o Tiny e o banco simulados.
import assert from "node:assert/strict";
import { test } from "node:test";
import { categoria, contato, data, pedido, produto, titulo } from "../supabase/functions/_shared/tiny/normalizar.ts";
import { horarioTiny, lerTiny } from "../supabase/functions/_shared/tiny/robo.ts";
import type { Lote } from "../supabase/functions/_shared/tiny/tipos.ts";

test("datas do Tiny em qualquer formato", () => {
  assert.equal(data("2026-10-05"), "2026-10-05");
  assert.equal(data("2026-10-05 10:00:00"), "2026-10-05");
  assert.equal(data("05/10/2026"), "2026-10-05");
  assert.equal(data("0000-00-00"), null);
  assert.equal(data(null), null);
});

test("horário de Brasília no formato dos filtros", () => {
  assert.equal(horarioTiny(new Date("2026-10-23T12:00:00Z")), "2026-10-23 09:00:00");
  assert.equal(horarioTiny(new Date("2026-10-23T12:00:00Z"), -5), "2026-10-23 08:55:00");
});

test("contato com endereço", () => {
  const c = contato({ id: 7, nome: " Loja X ", cpfCnpj: "12.345.678/0001-90", inscricaoEstadual: "ISENTO", endereco: { municipio: "Recife", uf: "PE", cep: "50.000-000" } });
  assert.equal(c?.nome, "Loja X");
  assert.equal(c?.documento, "12.345.678/0001-90");
  assert.equal(c?.cidade, "Recife");
  assert.equal(c?.ie, "ISENTO");
  assert.equal(contato({ nome: "sem id" }), null);
});

test("título pago pega a conta e a data do último recebimento", () => {
  const t = titulo(
    { id: 1, situacao: "pago", data: "2026-10-01", dataVencimento: "2026-10-10", valor: 100, valorPago: 0, saldo: 0, historico: "", numeroDocumento: "000446",
      cliente: { id: 9, nome: "C" }, categoria: { id: 5, descricao: "VENDA" } },
    [{ data: "2026-10-09", idConta: "501", valorPago: 40 }, { data: "2026-10-11", idConta: "502", valorPago: 60 }],
  );
  assert.equal(t?.situacao, "pago");
  assert.equal(t?.valor_pago, 100);
  assert.equal(t?.liquidacao, "2026-10-11");
  assert.equal(t?.conta_id, 502);
  assert.equal(t?.descricao, "Documento 000446");
  assert.equal(t?.categoria_id, 5);
});

test("título parcial e cancelado", () => {
  assert.equal(titulo({ id: 2, situacao: "aberto", dataVencimento: "2026-11-01", valor: 100, valorPago: 30, saldo: 70 }, [])?.situacao, "parcial");
  assert.equal(titulo({ id: 3, situacao: "cancelada", dataVencimento: "2026-11-01", valor: 100 }, [])?.situacao, "cancelado");
  assert.equal(titulo({ id: 4, situacao: "aberto", valor: 100 }, []), null);
});

test("categorias: grupo vira tipo; NÃO USAR inativa; grupo que faltava é encaixado", () => {
  assert.deepEqual(categoria({ id: 1, descricao: "VENDA DISTRIBUIDOR", grupo: "Recebimento" }), {
    id: 1, descricao: "VENDA DISTRIBUIDOR", grupo: "RECEBIMENTO", tipo: "receita", ativa: true,
  });
  assert.equal(categoria({ id: 2, descricao: "TARIFA - NÃO USAR", grupo: "BANCARIO" })?.ativa, false);
  assert.equal(categoria({ id: 3, descricao: "Custas cartorárias", grupo: "" })?.grupo, "ADMINISTRATIVO");
  assert.equal(categoria({ id: 4, descricao: "Nova", grupo: null })?.grupo, "SEM GRUPO");
});

test("pedido: parcelas, nota, canal da loja e itens", () => {
  const p = pedido(
    {
      id: 100, numeroPedido: 301, data: "2026-10-01", dataPrevista: "2026-10-20", situacao: 3, valorFrete: 50, valorDesconto: "10,50",
      cliente: { id: 7, nome: "Cliente" }, vendedor: { id: 1, nome: "CRISTIANE" }, notaFiscal: { numero: "000446" },
      pagamento: { condicaoPagamento: null, parcelas: [{ dias: 30 }, { dias: 60 }] },
      ecommerce: { id: null, nome: null }, transportador: { nome: "Transp" },
      itens: [
        { produto: { id: 3001, sku: "10001", descricao: "Kit", tipo: "P" }, quantidade: 5, valorUnitario: 7.5 },
        { produto: { id: null, sku: null }, quantidade: 1, valorUnitario: 1 },
      ],
    },
    "2026-10-23",
  );
  assert.equal(p?.numero, "301");
  assert.equal(p?.canal, "venda_direta");
  assert.equal(p?.condicao, "30/60");
  assert.equal(p?.prazo_dias, 45);
  assert.equal(p?.desconto, 10.5);
  assert.equal(p?.nota, "000446");
  assert.equal(p?.itens.length, 1);
  const loja = pedido({ id: 101, numeroPedido: 5, ecommerce: { nome: "Mercado Livre", numeroPedidoEcommerce: "2000123" }, cliente: { id: 8 } }, "2026-10-23");
  assert.equal(loja?.canal, "mercado_livre");
  assert.equal(loja?.numero_loja, "2000123");
  assert.equal(loja?.data, "2026-10-23");
});

test("produto: matéria-prima, unidade, peso e preço", () => {
  assert.deepEqual(
    produto({ id: 9, sku: "MP1", descricao: "Resina", tipo: "M", unidade: "kg", ncm: "3901.10.10", dimensoes: { pesoBruto: 0, pesoLiquido: 1.2 }, precos: { preco: 0 } }),
    { produto_id: 9, sku: "MP1", descricao: "Resina", tipo_item: "materia_prima", unidade: "KG", ncm: "3901.10.10", peso: 1.2, preco: null },
  );
});

// Leitura completa com o Tiny e o banco simulados.
test("leitura: renova o acesso, lista, lê pendentes e grava um lote só", async () => {
  const chamadas: string[] = [];
  const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  const supabase = {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      if (nome === "robo_tiny_inicio")
        return {
          data: {
            empresa_id: "e", access_token: "velho", refresh_token: "r1", expira_em: "2026-10-23T12:01:00Z",
            client_id: "cid", client_secret: "seg", ler_pagar: false, estado: { cadastros_em: "2026-10-23T11:00:00Z" },
            pendentes: [{ tipo: "receber", id: 1 }, { tipo: "pedido", id: 100 }, { tipo: "produto", id: 404 }],
          },
          error: null,
        };
      return { data: { ok: true }, error: null };
    },
  };
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    chamadas.push(u.replace("https://api.tiny.com.br/public-api/v3", ""));
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (u.includes("/token")) {
      assert.match(String(init?.body), /grant_type=refresh_token/);
      return json({ access_token: "novo", refresh_token: "r2", expires_in: 14400 });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer novo");
    if (u.includes("/contas-receber/1/recebimentos")) return json([{ data: "2026-10-12", idConta: "501", valorPago: 10 }]);
    if (u.includes("/contas-receber/1")) return json({ id: 1, situacao: "pago", data: "2026-10-01", dataVencimento: "2026-10-10", valor: 10, valorPago: 10, cliente: { id: 9 } });
    if (u.includes("/contas-receber?")) return json({ itens: [{ id: 2, situacao: "aberto", valor: 5 }], paginacao: { total: 1 } });
    if (u.includes("/pedidos/100")) return json({ id: 100, numeroPedido: 301, cliente: { id: 9 }, itens: [] });
    if (u.includes("/pedidos?")) return json({ itens: [] });
    if (u.includes("/produtos/404")) return json({}, 404);
    if (u.includes("/produtos?")) return json({ itens: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) });
    throw new Error(`inesperado ${u}`);
  }) as typeof fetch;
  try {
    const r = await lerTiny(supabase as never, "int", "chave", 40, new Date("2026-10-23T12:00:00Z"));
    assert.equal(r.erro, undefined);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(rpcs.map((r) => r.nome), ["robo_tiny_inicio", "robo_tiny_tokens", "robo_tiny_aplicar"]);
  assert.equal(rpcs[1].args.acesso, "novo");
  const lote = rpcs[2].args.lote as Lote;
  assert.equal(lote.receber[0].conta_id, 501);
  assert.equal(lote.pedidos[0].numero, "301");
  assert.deepEqual(lote.removidos, [{ tipo: "produto", id: 404 }]);
  assert.equal(lote.listados.filter((l) => l.tipo === "produto").length, 200);
  assert.equal(lote.estado.receber?.desde, "2026-10-23 08:55:00");
  assert.equal(lote.estado.produtos?.offset, 200);
  assert.equal(lote.contas, undefined, "cadastros só uma vez por dia");
  assert.ok(chamadas.some((c) => c.startsWith("/contas-receber?dataAtualizacao=2025-12-01")));
  assert.ok(!chamadas.some((c) => c.startsWith("/contas-pagar")), "contas a pagar desligado");
});
