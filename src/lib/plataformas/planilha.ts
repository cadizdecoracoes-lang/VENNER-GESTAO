// Leitura da planilha de vendas exportada pelo Mercado Livre ou pela Shopee.
// Acha a linha de cabeçalho, liga cada informação à sua coluna pelos nomes
// conhecidos (a pessoa pode corrigir na tela) e junta as linhas de cada venda.
// Sem dependências do Next, para rodar também nos testes (node --test).
import { somarDias } from "../datas.ts";
import { arred2, type Canal, type VendaImportada } from "./tipos.ts";

export type Celula = string | number | boolean | Date | null | undefined;

export const CAMPOS = {
  numero: "Número da venda",
  data: "Data da venda",
  situacao: "Situação",
  codigo: "Código do anúncio ou SKU",
  titulo: "Título do anúncio",
  quantidade: "Quantidade",
  valor: "Valor dos produtos",
  tarifas: "Tarifas e comissões",
  frete: "Frete pago pelo vendedor",
  liquido: "Total líquido",
  comprador: "Comprador",
} as const;
export type Campo = keyof typeof CAMPOS;
export type Mapa = Partial<Record<Campo, number>>;

// Nomes de coluna conhecidos, do mais exato ao mais genérico.
const NOMES: Record<Canal, Record<Campo, string[]>> = {
  mercado_livre: {
    numero: ["n.º de venda", "nº de venda", "n° de venda", "numero de venda", "# de venda"],
    data: ["data da venda"],
    situacao: ["estado", "status"],
    codigo: ["# de anuncio", "n.º de anuncio", "numero do anuncio", "anuncio", "sku"],
    titulo: ["titulo do anuncio", "titulo"],
    quantidade: ["unidades", "quantidade"],
    valor: ["receita por produtos", "receita por produto"],
    tarifas: ["tarifa de venda e impostos", "tarifa de venda", "tarifas de venda"],
    frete: ["tarifas de envio", "custo de envio", "tarifa de envio"],
    liquido: ["total (brl)", "total"],
    comprador: ["comprador", "dados pessoais ou da empresa"],
  },
  shopee: {
    numero: ["id do pedido", "n.º do pedido", "numero do pedido", "order id"],
    data: ["data de criacao do pedido", "data do pedido", "order creation date"],
    situacao: ["status do pedido", "order status"],
    codigo: ["numero de referencia sku", "nº de referencia do sku principal", "n.º de referencia do sku principal", "sku"],
    titulo: ["nome do produto", "product name"],
    quantidade: ["quantidade", "quantity"],
    valor: ["subtotal do produto", "product subtotal"],
    tarifas: ["taxa de comissao", "commission fee"],
    frete: ["taxa de servico", "service fee"],
    liquido: ["valor total", "total amount"],
    comprador: ["nome de usuario (comprador)", "nome de usuario do comprador", "username (buyer)"],
  },
};

const normalizar = (t: unknown) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// Linha de cabeçalho: a primeira (das 30 primeiras) que tem o número da venda.
export function acharCabecalho(linhas: Celula[][], canal: Canal): number {
  const nomes = NOMES[canal].numero;
  for (let i = 0; i < Math.min(30, linhas.length); i++) {
    if (linhas[i].some((c) => nomes.some((n) => normalizar(c) === n || normalizar(c).startsWith(n)))) return i;
  }
  return -1;
}

export function mapearColunas(cabecalho: Celula[], canal: Canal): Mapa {
  const colunas = cabecalho.map(normalizar);
  const mapa: Mapa = {};
  const usadas = new Set<number>();
  for (const campo of Object.keys(CAMPOS) as Campo[]) {
    for (const nome of NOMES[canal][campo]) {
      // Primeiro o nome exato, depois o começo do nome.
      let i = colunas.findIndex((c, k) => !usadas.has(k) && c === nome);
      if (i < 0) i = colunas.findIndex((c, k) => !usadas.has(k) && c.startsWith(nome));
      if (i >= 0) {
        mapa[campo] = i;
        usadas.add(i);
        break;
      }
    }
  }
  return mapa;
}

// "1.234,56", "R$ 10", -5 → número; vazio → 0.
export function lerValor(c: Celula): number {
  if (typeof c === "number") return c;
  const t = String(c ?? "")
    .replace(/[^\d,.-]/g, "")
    .trim();
  if (!t) return 0;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : 0;
}

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Datas da planilha: célula de data, "15/10/2026 14:32", "2026-10-15 14:32" ou
// "15 de outubro de 2026 14:32 hs.".
export function lerData(c: Celula): string | null {
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : c.toISOString().slice(0, 10);
  const t = normalizar(c);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2}) de ([a-z]+) de (\d{4})/);
  if (m && MESES.includes(m[2])) return `${m[3]}-${String(MESES.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// Vendas canceladas, devolvidas ou não pagas não entram.
const IGNORAR = ["cancel", "devol", "reembols", "nao pago", "unpaid", "nao concretizada"];

export type Leitura = { vendas: VendaImportada[]; ignoradas: number; problemas: string[] };

export function lerVendas(linhas: Celula[][], inicio: number, mapa: Mapa, diasLiberacao: number): Leitura {
  const problemas: string[] = [];
  const faltando = (["numero", "data", "codigo", "quantidade", "valor"] as Campo[]).filter((c) => mapa[c] === undefined);
  if (faltando.length)
    return { vendas: [], ignoradas: 0, problemas: [`Escolha a coluna de: ${faltando.map((c) => CAMPOS[c]).join(", ")}.`] };

  const pegar = (linha: Celula[], campo: Campo) => (mapa[campo] === undefined ? undefined : linha[mapa[campo]!]);
  const porNumero = new Map<string, VendaImportada & { liquido: number }>();
  let ignoradas = 0;
  for (const linha of linhas.slice(inicio)) {
    const numero = String(pegar(linha, "numero") ?? "").trim();
    const codigo = String(pegar(linha, "codigo") ?? "").trim();
    if (!numero) continue;
    if (IGNORAR.some((p) => normalizar(pegar(linha, "situacao")).includes(p))) {
      ignoradas++;
      continue;
    }
    // Linha de resumo de pacote (vários produtos) sem anúncio: os itens vêm abaixo.
    if (!codigo) continue;
    const data = lerData(pegar(linha, "data"));
    if (!data) {
      problemas.push(`Venda ${numero}: data não reconhecida.`);
      continue;
    }
    const quantidade = lerValor(pegar(linha, "quantidade")) || 1;
    const valor = Math.abs(lerValor(pegar(linha, "valor")));
    const tarifas = Math.abs(lerValor(pegar(linha, "tarifas"))) + Math.abs(lerValor(pegar(linha, "frete")));
    const liquido = lerValor(pegar(linha, "liquido"));
    const venda = porNumero.get(numero) ?? {
      numero,
      data,
      liberacao: somarDias(data, diasLiberacao),
      comprador: String(pegar(linha, "comprador") ?? "").trim(),
      valor: 0,
      tarifas: 0,
      liquido: 0,
      itens: [],
    };
    venda.valor += valor;
    venda.tarifas += tarifas;
    venda.liquido += liquido;
    venda.itens.push({ codigo, titulo: String(pegar(linha, "titulo") ?? "").trim(), quantidade, valor });
    porNumero.set(numero, venda);
  }

  const vendas: VendaImportada[] = [];
  for (const { liquido, ...v } of porNumero.values()) {
    // Com o total líquido na planilha, a diferença para o valor é o que a plataforma ficou.
    if (mapa.liquido !== undefined && liquido > 0 && liquido <= v.valor) v.tarifas = v.valor - liquido;
    if (v.valor <= 0) {
      problemas.push(`Venda ${v.numero}: sem valor dos produtos.`);
      continue;
    }
    vendas.push({ ...v, valor: arred2(v.valor), tarifas: arred2(Math.min(v.tarifas, v.valor - 0.01)) });
  }
  return { vendas, ignoradas, problemas };
}
