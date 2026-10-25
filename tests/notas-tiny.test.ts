// Testes da nota fiscal de venda pelo Tiny: situações, mensagens de erro e o
// caminho completo (gerar, autorizar, DANFE, XML, contas) com o Tiny e o
// banco simulados.
import assert from "node:assert/strict";
import { test } from "node:test";
import { textoErroTiny } from "../supabase/functions/_shared/tiny/api.ts";
import { cancelarNota, emitirNota, notaDoPedido, situacaoNota } from "../supabase/functions/_shared/tiny/notas.ts";

test("situação da nota no Tiny vira a situação daqui", () => {
  assert.equal(situacaoNota(1), "gerada");
  assert.equal(situacaoNota("6"), "autorizada");
  assert.equal(situacaoNota(7), "autorizada");
  assert.equal(situacaoNota(5), "rejeitada");
  assert.equal(situacaoNota(9), "enviada");
  assert.equal(situacaoNota(3), "cancelada");
  assert.equal(situacaoNota(10), "denegada");
  assert.equal(situacaoNota(null), null);
});

test("nota do pedido em qualquer um dos campos do Tiny", () => {
  assert.equal(notaDoPedido({ notaFiscal: { id: 77 } }), 77);
  assert.equal(notaDoPedido({ idNotaFiscal: 78, notaFiscal: null }), 78);
  assert.equal(notaDoPedido({ idNotaFiscal: 0 }), null);
  assert.equal(notaDoPedido(null), null);
});

test("erro do Tiny junta a mensagem e os campos sem repetir", () => {
  assert.equal(
    textoErroTiny({ mensagem: "Rejeição 539", detalhes: [{ campo: "cliente.ie", mensagem: "IE inválida" }, { mensagem: "Rejeição 539" }] }, "x"),
    "Rejeição 539 · cliente.ie: IE inválida",
  );
  assert.equal(textoErroTiny({}, "padrão"), "padrão");
});

type Chamada = { metodo: string; caminho: string; corpo: unknown };

// Banco e Tiny de mentira. tiny(chamada) devolve [status, corpo].
function simular(acesso: Record<string, unknown>, tiny: (c: Chamada) => [number, unknown]) {
  const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  const arquivos: string[] = [];
  const supabase = {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      if (nome === "nf_venda_acesso") return { data: acesso, error: null };
      if (nome === "nf_venda_gravar") return { data: "nota-uuid", error: null };
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        upload: async (caminho: string) => {
          arquivos.push(caminho);
          return { error: null };
        },
      }),
    },
  };
  const chamadas: Chamada[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const c = {
      metodo: init?.method ?? "GET",
      caminho: String(url).replace("https://api.tiny.com.br/public-api/v3", ""),
      corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    chamadas.push(c);
    const [status, corpo] = tiny(c);
    if (corpo instanceof Uint8Array) return new Response(new Blob([corpo as Uint8Array<ArrayBuffer>]), { status });
    return new Response(corpo === null ? null : JSON.stringify(corpo), { status });
  }) as typeof fetch;
  return { supabase, rpcs, arquivos, chamadas, desfazer: () => (globalThis.fetch = original) };
}

const ACESSO = {
  empresa_id: "empresa-1",
  pedido_tiny: 100,
  access_token: "acesso",
  refresh_token: "renova",
  expira_em: new Date(Date.now() + 3600_000).toISOString(),
  client_id: "cliente",
  client_secret: "segredo",
  lendo: false,
  nota: null,
};

test("emitir: gera a nota do pedido, autoriza, guarda DANFE e XML e lança as contas", async () => {
  let autorizada = false;
  const s = simular(ACESSO, ({ metodo, caminho }) => {
    if (caminho === "/pedidos/100") return [200, { id: 100, notaFiscal: null }];
    if (metodo === "POST" && caminho === "/pedidos/100/gerar-nota-fiscal") return [200, { id: 555, numero: 0, serie: 1 }];
    if (caminho === "/notas/555")
      return [200, autorizada ? { situacao: "6", numero: "000123", serie: "1", chaveAcesso: "3526", valorNotaComImpostos: 1500, dataEmissao: "2026-10-25" } : { situacao: "1" }];
    if (caminho === "/notas/555/emitir") {
      autorizada = true;
      return [200, { id: 555, situacao: 6, chaveAcesso: "3526", linkAcesso: "https://nfe.exemplo/3526", xml: "<nfeProc/>" }];
    }
    if (caminho.startsWith("/notas/555/comprovante")) return [200, new Uint8Array([37, 80, 68, 70])];
    if (caminho === "/notas/555/lancar-contas") return [204, null];
    return [404, {}];
  });
  try {
    const r = await emitirNota(s.supabase as never, "pedido-1", { autorizar: true });
    assert.deepEqual(r, { situacao: "autorizada", numero: "000123", mensagem: null });
  } finally {
    s.desfazer();
  }
  assert.deepEqual(
    s.chamadas.map((c) => `${c.metodo} ${c.caminho}`),
    [
      "GET /pedidos/100",
      "POST /pedidos/100/gerar-nota-fiscal",
      "GET /notas/555",
      "POST /notas/555/emitir",
      "GET /notas/555",
      "GET /notas/555/comprovante?format=pdf",
      "POST /notas/555/lancar-contas",
    ],
  );
  assert.deepEqual(s.chamadas[1].corpo, { modelo: 55 });
  assert.deepEqual(s.chamadas[3].corpo, { enviarEmail: false });
  assert.deepEqual(s.arquivos, ["empresa-1/nota-uuid.xml", "empresa-1/nota-uuid.pdf"]);
  const ultima = s.rpcs.filter((r) => r.nome === "nf_venda_gravar").pop()!.args.dados as Record<string, unknown>;
  assert.equal(ultima.situacao_tiny, 6);
  assert.equal(ultima.contas_lancadas, true);
  assert.equal(ultima.link, "https://nfe.exemplo/3526");
  assert.equal(ultima.mensagem, null);
});

test("emitir: rejeição da SEFAZ fica gravada com o motivo", async () => {
  const s = simular({ ...ACESSO, nota: { id: "nota-uuid", tiny_id: 555, situacao: "gerada", numero: null, contas_lancadas: false } }, ({ caminho }) => {
    if (caminho === "/notas/555/emitir") return [400, { mensagem: "Rejeição 209: IE do destinatário inválida" }];
    if (caminho === "/notas/555") return [200, { situacao: s.chamadas.length > 2 ? "5" : "1" }];
    return [404, {}];
  });
  try {
    const r = await emitirNota(s.supabase as never, "pedido-1", { autorizar: true });
    assert.equal(r.situacao, "rejeitada");
    assert.equal(r.mensagem, "Rejeição 209: IE do destinatário inválida");
  } finally {
    s.desfazer();
  }
  // Nota já existente: não gera outra.
  assert.ok(!s.chamadas.some((c) => c.caminho.includes("gerar-nota-fiscal")));
  const ultima = s.rpcs.filter((r) => r.nome === "nf_venda_gravar").pop()!.args.dados as Record<string, unknown>;
  assert.equal(ultima.situacao_tiny, 5);
});

test("trazer do Tiny: adota a nota emitida lá sem autorizar de novo", async () => {
  const s = simular(ACESSO, ({ caminho }) => {
    if (caminho === "/pedidos/100") return [200, { idNotaFiscal: 556 }];
    if (caminho === "/notas/556") return [200, { situacao: "7", numero: "124" }];
    if (caminho === "/notas/556/xml") return [200, { xmlNfe: "<nfeProc/>" }];
    if (caminho.startsWith("/notas/556/comprovante")) return [200, new Uint8Array([1])];
    if (caminho === "/notas/556/link") return [200, { link: "https://link" }];
    if (caminho === "/notas/556/lancar-contas") return [400, { mensagem: "As contas já foram lançadas" }];
    return [404, {}];
  });
  try {
    const r = await emitirNota(s.supabase as never, "pedido-1", { autorizar: false });
    assert.deepEqual(r, { situacao: "autorizada", numero: "124", mensagem: null });
  } finally {
    s.desfazer();
  }
  assert.ok(!s.chamadas.some((c) => c.caminho.endsWith("/emitir") || c.caminho.includes("gerar-nota-fiscal")));
});

test("cancelar: exige justificativa e estorna as contas", async () => {
  const nota = { id: "nota-uuid", tiny_id: 555, situacao: "autorizada", numero: "123", contas_lancadas: true };
  const s = simular({ ...ACESSO, nota }, ({ caminho }) => {
    if (caminho === "/notas/555/cancelar") return [200, { situacao: 3, cStat: 135, motivo: "Evento registrado" }];
    if (caminho === "/notas/555/xml") return [200, { xmlNfe: "<a/>", xmlCancelamento: "<cancelamento/>" }];
    return [404, {}];
  });
  try {
    await assert.rejects(cancelarNota(s.supabase as never, "pedido-1", "curta"), /15 a 255/);
    const r = await cancelarNota(s.supabase as never, "pedido-1", "Cliente desistiu da compra");
    assert.equal(r.situacao, "cancelada");
  } finally {
    s.desfazer();
  }
  assert.deepEqual(s.chamadas[0].corpo, {
    justificativa: "Cliente desistiu da compra",
    estornarContas: true,
    estornarEstoque: true,
    cancelarVenda: false,
  });
  assert.deepEqual(s.arquivos, ["empresa-1/nota-uuid-cancelamento.xml"]);
});
