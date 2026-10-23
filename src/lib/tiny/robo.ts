// Uma leitura do Tiny: renova o acesso, lê o detalhe do que ficou pendente,
// percorre as listagens atrás do que mudou e grava tudo de uma vez no banco.
// Chamada a cada 5 minutos pelo Supabase (rota /integracoes/robo) ou pelo
// botão "Ler agora". A chave do robô é conferida pelo banco em cada chamada.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiTiny, renovarTiny, SemOrcamento } from "./api.ts";
import { assinatura, categoria, contaFinanceira, data, formaSimples, listaPreco, pedido, precosDaLista, produto, titulo, vendedor } from "./normalizar.ts";
import { HISTORICO_DESDE, type Cursor, type EstadoLeitura, type Lote, type TipoFila } from "./tipos.ts";

type Inicio = {
  empresa_id: string;
  access_token: string;
  refresh_token: string | null;
  expira_em: string | null;
  client_id: string | null;
  client_secret: string | null;
  ler_pagar: boolean;
  estado: EstadoLeitura;
  pendentes: { tipo: TipoFila; id: number }[];
};

type Pagina = { itens?: unknown[]; paginacao?: { total?: number } };

const POR_PAGINA = 100;
// Páginas de listagem por leitura (o resto do orçamento vai para os detalhes).
const PAGINAS_POR_LEITURA = 8;

// Horário de Brasília no formato dos filtros do Tiny ("2026-10-23 09:00:00").
export function horarioTiny(agora: Date, minutos = 0): string {
  return new Date(agora.getTime() - 3 * 3600_000 + minutos * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

export type ResultadoLeitura = { chamadas: number; resumo: unknown; erro?: string };

export async function lerTiny(
  supabase: SupabaseClient,
  integracao: string,
  chave: string,
  orcamento = 40,
  agora = new Date(),
): Promise<ResultadoLeitura> {
  const ini = await supabase.rpc("robo_tiny_inicio", { integracao, chave_robo: chave, limite: orcamento });
  if (ini.error) throw new Error(ini.error.message);
  const conta = ini.data as Inicio;
  const estado: EstadoLeitura = structuredClone(conta.estado ?? {});
  const lote: Lote = {
    historico_desde: HISTORICO_DESDE,
    listados: [],
    receber: [],
    pagar: [],
    pedidos: [],
    produtos: [],
    falhas: [],
    removidos: [],
    estado,
  };
  const erros: string[] = [];
  let api: ApiTiny | null = null;

  try {
    if (!conta.client_id || !conta.client_secret) throw new Error("Faltam as chaves do aplicativo do Tiny (Client ID e Client Secret).");
    let token = conta.access_token;
    if (!conta.expira_em || Date.parse(conta.expira_em) < agora.getTime() + 10 * 60_000) {
      if (!conta.refresh_token) throw new Error("O acesso ao Tiny venceu. Ligue a conta de novo.");
      let novo;
      try {
        novo = await renovarTiny(conta.refresh_token, conta.client_id, conta.client_secret);
      } catch {
        throw new Error("O acesso ao Tiny venceu (fica mais de um dia sem leitura?). Ligue a conta de novo.");
      }
      const salvo = await supabase.rpc("robo_tiny_tokens", {
        integracao,
        chave_robo: chave,
        acesso: novo.access_token,
        renovacao: novo.refresh_token,
        expira: novo.expira_em,
      });
      if (salvo.error) throw new Error(salvo.error.message);
      token = novo.access_token;
    }
    api = new ApiTiny(token, orcamento);
    const tiny = api;

    // 1. Contas financeiras e categorias, uma vez por dia.
    if (!estado.cadastros_em || Date.parse(estado.cadastros_em) < agora.getTime() - 20 * 3600_000) {
      try {
        lote.contas = (await todasAsPaginas(tiny, "/contas-financeiras", 2)).map(contaFinanceira).filter((c) => c !== null);
        lote.categorias = (await todasAsPaginas(tiny, "/categorias-receita-despesa", 3)).map(categoria).filter((c) => c !== null);
        estado.cadastros_em = agora.toISOString();
      } catch (e) {
        if (e instanceof SemOrcamento) throw e;
        erros.push(e instanceof Error ? e.message : String(e));
      }
      await lerCadastrosComerciais(tiny, supabase, integracao, chave, erros);
    }

    // 2. Listagens: o que mudou desde a última volta entra na fila.
    let paginas = PAGINAS_POR_LEITURA;
    const listar = async (rotulo: string, f: () => Promise<number>) => {
      if (paginas <= 0) return;
      try {
        paginas -= await f();
      } catch (e) {
        if (e instanceof SemOrcamento) throw e;
        erros.push(`${rotulo}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    await listar("Contas a receber", () =>
      varrer(tiny, lote, "receber", "/contas-receber", "dataAtualizacao", (estado.receber ??= { desde: "2025-12-01 00:00:00", offset: 0 }), agora, 2),
    );
    await listar("Pedidos", () =>
      varrer(tiny, lote, "pedido", "/pedidos", "dataAtualizacao", (estado.pedidos ??= { desde: "2025-01-01 00:00:00", offset: 0 }), agora, 2),
    );
    await listar("Produtos", () =>
      varrer(tiny, lote, "produto", "/produtos", "dataAlteracao", (estado.produtos ??= { desde: "2000-01-01 00:00:00", offset: 0 }), agora, 2, {
        situacao: "A",
      }),
    );
    if (conta.ler_pagar) await listar("Contas a pagar", () => varrerPagar(tiny, lote, estado, agora, 2));

    // 3. Detalhe de cada pendente (das leituras anteriores).
    for (const p of conta.pendentes) {
      if (tiny.restantes() < (p.tipo === "receber" || p.tipo === "pagar" ? 2 : 1)) break;
      try {
        await detalhar(tiny, lote, p.tipo, p.id, agora);
      } catch (e) {
        if (e instanceof SemOrcamento) break;
        lote.falhas.push({ tipo: p.tipo, id: p.id, erro: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      }
    }
  } catch (e) {
    if (!(e instanceof SemOrcamento)) erros.push(e instanceof Error ? e.message : String(e));
  }

  if (erros.length) lote.erro = [...new Set(erros.map((e) => e.replace(/^[^:]+: (?=O Tiny não respondeu)/, "")))].join(" · ").slice(0, 1000);
  const fim = await supabase.rpc("robo_tiny_aplicar", { integracao, chave_robo: chave, lote });
  if (fim.error) throw new Error(fim.error.message);
  return { chamadas: api?.usadas ?? 0, resumo: fim.data, erro: lote.erro };
}

// Vendedores, formas de recebimento e de envio e listas de preço (uma vez por
// dia, junto com as categorias). Cada um à parte: sem permissão de leitura em
// um deles, os outros seguem.
async function lerCadastrosComerciais(api: ApiTiny, supabase: SupabaseClient, integracao: string, chave: string, erros: string[]) {
  const dados: Record<string, unknown[]> = {};
  const ler = async (rotulo: string, f: () => Promise<unknown[]>) => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof SemOrcamento) throw e;
      erros.push(`${rotulo}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const vendedores = await ler("Vendedores", async () => (await todasAsPaginas(api, "/vendedores", 2)).map(vendedor).filter((v) => v !== null));
  if (vendedores) dados.vendedores = vendedores;
  const formas = await ler("Formas de pagamento", async () => (await todasAsPaginas(api, "/formas-pagamento", 1)).map(formaSimples).filter((v) => v !== null));
  if (formas) dados.formas_pagamento = formas;
  const envio = await ler("Formas de envio", async () => (await todasAsPaginas(api, "/formas-envio", 1)).map(formaSimples).filter((v) => v !== null));
  if (envio) dados.formas_envio = envio;
  const listas = await ler("Listas de preço", async () => {
    const todas = (await todasAsPaginas(api, "/listas-precos", 1)).map(listaPreco).filter((l) => l !== null);
    // Preços próprios de cada lista, enquanto houver orçamento nesta leitura.
    for (const l of todas) {
      if (api.restantes() < 5) break;
      const d = await api.ler(`/listas-precos/${l.id}`);
      if (d) l.precos = precosDaLista(d);
    }
    return todas;
  });
  if (listas) dados.listas_preco = listas;
  if (!Object.keys(dados).length) return;
  const r = await supabase.rpc("robo_tiny_cadastros", { integracao, chave_robo: chave, dados });
  if (r.error) erros.push(`Cadastros do comercial: ${r.error.message}`);
}

async function todasAsPaginas(api: ApiTiny, caminho: string, maximo: number): Promise<unknown[]> {
  const itens: unknown[] = [];
  for (let i = 0; i < maximo; i++) {
    const r = await api.ler<Pagina>(caminho, { limit: POR_PAGINA, offset: i * POR_PAGINA });
    const pagina = r?.itens ?? [];
    itens.push(...pagina);
    if (pagina.length < POR_PAGINA) break;
  }
  return itens;
}

// Percorre uma listagem filtrada por data de alteração, retomando de onde parou.
async function varrer(
  api: ApiTiny,
  lote: Lote,
  tipo: TipoFila,
  caminho: string,
  filtro: string,
  cursor: Cursor,
  agora: Date,
  maximo: number,
  extra: Record<string, string> = {},
): Promise<number> {
  let usadas = 0;
  while (usadas < maximo) {
    // Cada volta começa 5 minutos antes, para não perder o que mudou durante a anterior.
    if (cursor.offset === 0) cursor.inicio = horarioTiny(agora, -5);
    const r = await api.ler<Pagina>(caminho, { ...extra, [filtro]: cursor.desde, orderBy: "asc", limit: POR_PAGINA, offset: cursor.offset });
    usadas++;
    const itens = r?.itens ?? [];
    for (const i of itens) {
      const id = Number((i as { id?: unknown }).id);
      if (id) lote.listados.push({ tipo, id, assinatura: assinatura(tipo === "pedido" ? "pedido" : tipo, i) });
    }
    if (itens.length < POR_PAGINA) {
      cursor.desde = cursor.inicio ?? cursor.desde;
      cursor.offset = 0;
      break;
    }
    cursor.offset += POR_PAGINA;
  }
  return usadas;
}

// Contas a pagar não têm filtro por alteração: dá voltas completas (em aberto
// e depois vencimentos de 2026) comparando a assinatura de cada título.
async function varrerPagar(api: ApiTiny, lote: Lote, estado: EstadoLeitura, agora: Date, maximo: number): Promise<number> {
  const c = (estado.pagar ??= { fase: "abertos", offset: 0 });
  let usadas = 0;
  while (usadas < maximo) {
    if (c.fase === "abertos" && c.offset === 0) c.inicio = agora.toISOString();
    const filtros = c.fase === "abertos" ? { situacao: "aberto" } : { dataInicialVencimento: HISTORICO_DESDE };
    const r = await api.ler<Pagina>("/contas-pagar", { ...filtros, orderBy: "asc", limit: POR_PAGINA, offset: c.offset });
    usadas++;
    const itens = r?.itens ?? [];
    for (const i of itens) {
      const id = Number((i as { id?: unknown }).id);
      if (id) lote.listados.push({ tipo: "pagar", id, assinatura: assinatura("pagar", i) });
    }
    if (itens.length === POR_PAGINA) {
      c.offset += POR_PAGINA;
    } else if (c.fase === "abertos") {
      c.fase = "ano";
      c.offset = 0;
    } else {
      // Volta completa: o que não apareceu nela é relido (pago, excluído...).
      if (c.inicio) lote.pagar_ciclo_inicio = c.inicio;
      estado.pagar = { fase: "abertos", offset: 0 };
      break;
    }
  }
  return usadas;
}

async function detalhar(api: ApiTiny, lote: Lote, tipo: TipoFila, id: number, agora: Date) {
  if (tipo === "receber" || tipo === "pagar") {
    const caminho = tipo === "receber" ? "/contas-receber" : "/contas-pagar";
    const d = await api.ler<Record<string, unknown>>(`${caminho}/${id}`);
    if (!d) return void lote.removidos.push({ tipo, id });
    const temBaixa = Number(d.valorPago ?? 0) > 0 || ["pago", "parcial"].includes(String(d.situacao));
    const baixas = temBaixa ? await api.ler(`${caminho}/${id}/recebimentos`) : [];
    const t = titulo(d, baixas);
    if (!t) throw new Error("Título sem vencimento no Tiny");
    lote[tipo].push(t);
  } else if (tipo === "pedido") {
    const d = await api.ler(`/pedidos/${id}`);
    if (!d) return void lote.removidos.push({ tipo, id });
    const p = pedido(d, data(agora.toISOString()) ?? "");
    if (!p) throw new Error("Pedido sem número no Tiny");
    if (!p.cliente) throw new Error("Pedido sem cliente no Tiny");
    lote.pedidos.push(p);
  } else {
    const d = await api.ler(`/produtos/${id}`);
    if (!d) return void lote.removidos.push({ tipo, id });
    const p = produto(d);
    if (p) lote.produtos.push(p);
  }
}
