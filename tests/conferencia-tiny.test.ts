// Testes da conferência com o Tiny (tela) e da nota fiscal lida da listagem do Tiny.
import assert from "node:assert/strict";
import { test } from "node:test";
import { notaTiny } from "../supabase/functions/_shared/tiny/normalizar.ts";
import { chaveDiferenca, escolhidosPorModulo, linkRegistro, type Diferenca } from "../src/lib/conferencia-tiny.ts";

test("nota fiscal da listagem do Tiny", () => {
  const n = notaTiny({
    id: 77,
    tipo: "S",
    numero: "000123",
    serie: "1",
    chaveAcesso: "3526 1112 3456 7800 0199 5500 1000 0001 2310 0000 1234",
    situacao: "6",
    dataEmissao: "2026-11-12 10:00:00",
    cliente: { nome: "CLIENTE", cpfCnpj: "12.345.678/0001-99" },
    valor: "1.234,50",
    origem: { id: "55", tipo: "venda" },
    ecommerce: { numeroPedidoEcommerce: "ML-1" },
  });
  assert.deepEqual(n, {
    id: 77,
    tipo: "S",
    numero: "123",
    serie: "1",
    chave: "35261112345678000199550010000001231000001234",
    situacao: 6,
    emissao: "2026-11-12",
    contato_nome: "CLIENTE",
    contato_documento: "12.345.678/0001-99",
    valor: 1234.5,
    origem_tipo: "venda",
    origem_id: "55",
    pedido_ecommerce: "ML-1",
  });
  assert.equal(notaTiny({ id: 1, tipo: "X" }), null);
  assert.equal(notaTiny({ tipo: "E" }), null);
  assert.equal(notaTiny({ id: 2, tipo: "e", chaveAcesso: "123" })?.chave, null);
});

const base: Diferenca = {
  empresa_id: "e",
  modulo: "pagar",
  problema: "diferente",
  campos: "valor",
  motivo: null,
  corrigivel: true,
  tiny_id: 10,
  referencia: null,
  tiny_situacao: null,
  tiny_valor: null,
  tiny_data: null,
  venner_id: "v1",
  venner_situacao: null,
  venner_valor: null,
  venner_data: "2026-12-10",
};

test("escolhidos agrupados por módulo, sem repetir e só os que têm correção", () => {
  const lista: Diferenca[] = [
    base,
    { ...base, problema: "sobra_aqui" },
    { ...base, tiny_id: 11, venner_id: "v2", corrigivel: false },
    { ...base, modulo: "pedidos", tiny_id: 20, venner_id: "p1" },
    { ...base, modulo: "compras", tiny_id: 30, venner_id: null },
  ];
  const escolhidos = new Set(lista.map(chaveDiferenca));
  escolhidos.delete(chaveDiferenca(lista[4]));
  assert.deepEqual(escolhidosPorModulo(lista, escolhidos), { pagar: [10], pedidos: [20] });
});

test("link para o registro daqui", () => {
  assert.equal(linkRegistro(base), "/financeiro/pagar?de=2026-12-10&ate=2026-12-10&por=vencimento&ver=v1");
  assert.equal(linkRegistro({ ...base, modulo: "receber" }), "/financeiro/receber?de=2026-12-10&ate=2026-12-10&por=vencimento");
  assert.equal(linkRegistro({ ...base, modulo: "receber", venner_data: null }), "/financeiro/receber");
  assert.equal(linkRegistro({ ...base, modulo: "compras" }), "/compras/pedidos/pedido?id=v1");
  assert.equal(linkRegistro({ ...base, venner_id: null }), null);
});
