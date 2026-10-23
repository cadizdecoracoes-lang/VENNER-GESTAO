// Ligação direta com a Shopee (Open Platform v2): autorização da loja, renovação
// do acesso e busca dos pedidos com o repasse. As chaves do app vêm dos
// segredos SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY do Cloudflare.
import { somarDias } from "../datas.ts";
import { arred2, type VendaImportada } from "./tipos.ts";
import type { Tokens } from "./mercado-livre.ts";

const API = "https://partner.shopeemobile.com";

export const chavesShopee = () => ({ partnerId: process.env.SHOPEE_PARTNER_ID ?? "", partnerKey: process.env.SHOPEE_PARTNER_KEY ?? "" });
export const shopeeConfigurado = () => !!(chavesShopee().partnerId && chavesShopee().partnerKey);

// Assinatura HMAC-SHA256 (hexadecimal) exigida em toda chamada.
export async function assinar(chave: string, base: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(base));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const agora = () => Math.floor(Date.now() / 1000);

export async function urlAutorizacaoShopee(retorno: string): Promise<string> {
  const { partnerId, partnerKey } = chavesShopee();
  const caminho = "/api/v2/shop/auth_partner";
  const ts = agora();
  const sign = await assinar(partnerKey, `${partnerId}${caminho}${ts}`);
  return `${API}${caminho}?${new URLSearchParams({ partner_id: partnerId, timestamp: String(ts), sign, redirect: retorno })}`;
}

async function chamadaPublica(caminho: string, corpo: Record<string, unknown>) {
  const { partnerId, partnerKey } = chavesShopee();
  const ts = agora();
  const sign = await assinar(partnerKey, `${partnerId}${caminho}${ts}`);
  const r = await fetch(`${API}${caminho}?${new URLSearchParams({ partner_id: partnerId, timestamp: String(ts), sign })}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...corpo, partner_id: Number(partnerId) }),
  });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(`Shopee recusou a autorização: ${d.message || d.error || r.status}`);
  return d;
}

function tokens(d: { access_token: string; refresh_token?: string; expire_in?: number }, loja: string): Tokens {
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? null,
    expira_em: new Date(Date.now() + Number(d.expire_in ?? 14400) * 1000).toISOString(),
    conta: loja,
    apelido: null,
  };
}

export async function trocarCodigoShopee(codigo: string, loja: string): Promise<Tokens> {
  return tokens(await chamadaPublica("/api/v2/auth/token/get", { code: codigo, shop_id: Number(loja) }), loja);
}

export async function renovarShopee(refresh: string, loja: string): Promise<Tokens> {
  return tokens(await chamadaPublica("/api/v2/auth/access_token/get", { refresh_token: refresh, shop_id: Number(loja) }), loja);
}

async function chamadaLoja(caminho: string, token: string, loja: string, params: Record<string, string>) {
  const { partnerId, partnerKey } = chavesShopee();
  const ts = agora();
  const sign = await assinar(partnerKey, `${partnerId}${caminho}${ts}${token}${loja}`);
  const q = new URLSearchParams({ partner_id: partnerId, timestamp: String(ts), sign, access_token: token, shop_id: loja, ...params });
  const r = await fetch(`${API}${caminho}?${q}`);
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(`Shopee não devolveu os pedidos: ${d.message || d.error || r.status}`);
  return d.response;
}

export type PedidoShopee = {
  order_sn: string;
  order_status: string;
  create_time: number;
  buyer_username?: string;
  item_list: {
    item_id: number;
    item_name: string;
    item_sku?: string;
    model_sku?: string;
    model_quantity_purchased: number;
    model_discounted_price: number;
  }[];
};
export type RepasseShopee = { escrow_amount?: number; order_selling_price?: number };

const IGNORAR = ["UNPAID", "CANCELLED", "IN_CANCEL", "TO_RETURN"];

// O código é o SKU da variação (ou do produto), o mesmo da coluna "Número de referência SKU" da planilha.
export function converterPedidoShopee(p: PedidoShopee, repasse: RepasseShopee | null, diasLiberacao: number): VendaImportada | null {
  if (IGNORAR.includes(p.order_status)) return null;
  const data = new Date(p.create_time * 1000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const valor = p.item_list.reduce((s, i) => s + i.model_discounted_price * i.model_quantity_purchased, 0);
  if (valor <= 0) return null;
  const liquido = repasse?.escrow_amount;
  return {
    numero: p.order_sn,
    data,
    liberacao: somarDias(data, diasLiberacao),
    comprador: p.buyer_username ?? "",
    valor: arred2(valor),
    tarifas: liquido && liquido > 0 && liquido < valor ? arred2(valor - liquido) : 0,
    itens: p.item_list.map((i) => ({
      codigo: i.model_sku || i.item_sku || String(i.item_id),
      titulo: i.item_name,
      quantidade: i.model_quantity_purchased,
      valor: arred2(i.model_discounted_price * i.model_quantity_purchased),
    })),
  };
}

// Pedidos criados desde a data (a Shopee aceita janelas de até 15 dias).
export async function buscarVendasShopee(token: string, loja: string, desde: string, diasLiberacao: number): Promise<VendaImportada[]> {
  const fim = agora();
  const numeros: string[] = [];
  for (let de = Math.floor(Date.parse(`${desde}T00:00:00-03:00`) / 1000); de < fim; de += 15 * 86400) {
    let cursor = "";
    do {
      const r = await chamadaLoja("/api/v2/order/get_order_list", token, loja, {
        time_range_field: "create_time",
        time_from: String(de),
        time_to: String(Math.min(de + 15 * 86400 - 1, fim)),
        page_size: "100",
        cursor,
      });
      numeros.push(...(r.order_list ?? []).map((o: { order_sn: string }) => o.order_sn));
      cursor = r.more ? r.next_cursor : "";
    } while (cursor);
  }
  const vendas: VendaImportada[] = [];
  for (let i = 0; i < numeros.length; i += 50) {
    const r = await chamadaLoja("/api/v2/order/get_order_detail", token, loja, {
      order_sn_list: numeros.slice(i, i + 50).join(","),
      response_optional_fields: "buyer_username,item_list",
    });
    for (const p of (r.order_list ?? []) as PedidoShopee[]) {
      if (IGNORAR.includes(p.order_status)) continue;
      let repasse: RepasseShopee | null = null;
      try {
        repasse = (await chamadaLoja("/api/v2/payment/get_escrow_detail", token, loja, { order_sn: p.order_sn })).order_income ?? null;
      } catch {
        // Sem o repasse, o título fica pelo valor dos produtos.
      }
      const v = converterPedidoShopee(p, repasse, diasLiberacao);
      if (v) vendas.push(v);
    }
  }
  return vendas;
}
