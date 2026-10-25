// Ligação direta com o Mercado Livre (API): autorização da conta (OAuth com
// PKCE), renovação do acesso e busca das vendas. As chaves da aplicação vêm
// dos segredos ML_APP_ID e ML_SECRET_KEY das Edge Functions do Supabase.
import { ambiente } from "../ambiente.ts";
import { somarDias } from "../datas.ts";
import { arred2, type VendaImportada } from "./tipos.ts";

const API = "https://api.mercadolibre.com";
const AUTORIZACAO = "https://auth.mercadolivre.com.br/authorization";

export const chavesML = () => ({ appId: ambiente("ML_APP_ID"), secret: ambiente("ML_SECRET_KEY") });
export const mlConfigurado = () => !!(chavesML().appId && chavesML().secret);

export type Tokens = { access_token: string; refresh_token: string | null; expira_em: string; conta: string; apelido: string | null };

export function urlAutorizacaoML(appId: string, retorno: string, estado: string, desafio: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: appId,
    redirect_uri: retorno,
    state: estado,
    code_challenge: desafio,
    code_challenge_method: "S256",
  });
  return `${AUTORIZACAO}?${q}`;
}

async function pedirToken(corpo: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(corpo),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Mercado Livre recusou a autorização: ${d.message ?? d.error ?? r.status}`);
  let apelido: string | null = null;
  try {
    const eu = await fetch(`${API}/users/me`, { headers: { authorization: `Bearer ${d.access_token}` } });
    if (eu.ok) apelido = (await eu.json()).nickname ?? null;
  } catch {
    // O apelido é só para exibir.
  }
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? null,
    expira_em: new Date(Date.now() + Number(d.expires_in ?? 21600) * 1000).toISOString(),
    conta: String(d.user_id),
    apelido,
  };
}

export function trocarCodigoML(codigo: string, retorno: string, verificador: string): Promise<Tokens> {
  const { appId, secret } = chavesML();
  return pedirToken({
    grant_type: "authorization_code",
    client_id: appId,
    client_secret: secret,
    code: codigo,
    redirect_uri: retorno,
    code_verifier: verificador,
  });
}

export function renovarML(refresh: string): Promise<Tokens> {
  const { appId, secret } = chavesML();
  return pedirToken({ grant_type: "refresh_token", client_id: appId, client_secret: secret, refresh_token: refresh });
}

// Formato do pedido em /orders/search (só o que o sistema usa).
export type PedidoML = {
  id: number | string;
  status: string;
  date_created: string;
  buyer?: { nickname?: string };
  order_items: {
    item: { id: string; title: string; seller_sku?: string | null };
    quantity: number;
    unit_price: number;
    sale_fee?: number;
  }[];
  payments?: { status?: string; money_release_date?: string | null }[];
  shipping?: { id?: number | string | null };
};

// O código do anúncio é o mesmo da coluna "# de anúncio" da planilha.
export function converterPedidoML(p: PedidoML, diasLiberacao: number, freteVendedor = 0): VendaImportada | null {
  if (p.status !== "paid") return null;
  const data = p.date_created.slice(0, 10);
  const valor = p.order_items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const comissao = p.order_items.reduce((s, i) => s + (i.sale_fee ?? 0) * i.quantity, 0);
  const liberacao = p.payments?.find((x) => x.money_release_date)?.money_release_date?.slice(0, 10) ?? somarDias(data, diasLiberacao);
  if (valor <= 0) return null;
  return {
    numero: String(p.id),
    data,
    liberacao,
    comprador: p.buyer?.nickname ?? "",
    valor: arred2(valor),
    tarifas: arred2(Math.min(comissao + freteVendedor, valor - 0.01)),
    itens: p.order_items.map((i) => ({
      codigo: i.item.id,
      titulo: i.item.title,
      quantidade: i.quantity,
      valor: arred2(i.unit_price * i.quantity),
    })),
  };
}

// Vendas pagas criadas desde a data, com o frete pago pelo vendedor quando a API informa.
export async function buscarVendasML(token: string, vendedor: string, desde: string, diasLiberacao: number): Promise<VendaImportada[]> {
  const cabecalho = { authorization: `Bearer ${token}` };
  const vendas: VendaImportada[] = [];
  for (let offset = 0; offset < 5000; offset += 50) {
    const q = new URLSearchParams({
      seller: vendedor,
      "order.date_created.from": `${desde}T00:00:00.000-03:00`,
      sort: "date_asc",
      offset: String(offset),
      limit: "50",
    });
    const r = await fetch(`${API}/orders/search?${q}`, { headers: cabecalho });
    if (!r.ok) throw new Error(`Mercado Livre não devolveu as vendas (erro ${r.status}).`);
    const d = (await r.json()) as { results: PedidoML[]; paging: { total: number } };
    for (const p of d.results) {
      let frete = 0;
      if (p.status === "paid" && p.shipping?.id) {
        try {
          const c = await fetch(`${API}/shipments/${p.shipping.id}/costs`, { headers: cabecalho });
          if (c.ok) frete = Number((await c.json()).senders?.[0]?.cost ?? 0);
        } catch {
          // Sem o custo do envio, o título fica só com a comissão.
        }
      }
      const v = converterPedidoML(p, diasLiberacao, frete);
      if (v) vendas.push(v);
    }
    if (offset + 50 >= d.paging.total) break;
  }
  return vendas;
}
