// Venda de plataforma no formato que o banco importa (importar_vendas_plataforma),
// venha ela da planilha exportada ou da API. Sem dependências do Next.

export type Canal = "mercado_livre" | "shopee";

export type ItemVenda = { codigo: string; titulo: string; quantidade: number; valor: number };

export type VendaImportada = {
  numero: string;
  data: string; // aaaa-mm-dd
  liberacao: string; // aaaa-mm-dd: quando o dinheiro fica disponível
  comprador: string;
  valor: number; // valor dos produtos
  tarifas: number; // comissão, taxas e frete pagos pelo vendedor
  itens: ItemVenda[];
};

export const NOME_CANAL: Record<Canal, string> = { mercado_livre: "Mercado Livre", shopee: "Shopee" };

export const arred2 = (v: number) => Math.round(v * 100) / 100;
