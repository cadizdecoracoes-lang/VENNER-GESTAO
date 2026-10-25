// Converte as respostas da API v3 do Tiny no formato que o banco grava.
// Funções puras (testadas em tests/tiny.test.ts).
import type { Categoria, ContaFinanceira, Contato, ItemPedido, Pedido, Produto, Titulo } from "./tipos.ts";

type Bruto = Record<string, unknown>;

const obj = (v: unknown): Bruto => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
};
export const numero = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = texto(v);
  if (!t) return 0;
  // Aceita "1.234,56" e "1234.56".
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : 0;
};
const inteiro = (v: unknown): number | null => {
  const n = numero(v);
  return n ? Math.trunc(n) : null;
};
const arred2 = (v: number) => Math.round(v * 100) / 100;

// "2026-10-05", "2026-10-05 10:00:00" ou "05/10/2026" → "2026-10-05".
export function data(v: unknown): string | null {
  const t = texto(v);
  if (!t || t.startsWith("0000")) return null;
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

export function contato(v: unknown): Contato | null {
  const c = obj(v);
  const id = inteiro(c.id);
  if (!id) return null;
  const e = obj(c.endereco);
  return {
    id,
    nome: texto(c.nome),
    fantasia: texto(c.fantasia),
    documento: texto(c.cpfCnpj),
    email: texto(c.email),
    telefone: texto(c.telefone),
    celular: texto(c.celular),
    ie: texto(c.inscricaoEstadual),
    logradouro: texto(e.endereco),
    numero: texto(e.numero),
    complemento: texto(e.complemento),
    bairro: texto(e.bairro),
    cep: texto(e.cep),
    cidade: texto(e.municipio),
    uf: texto(e.uf),
  };
}

function situacaoTitulo(v: unknown, valorPago: number, saldo: number): Titulo["situacao"] {
  const s = (texto(v) ?? "").toLowerCase();
  if (s === "cancelada" || s === "cancelado") return "cancelado";
  if (s === "pago") return "pago";
  if (s === "parcial" || (valorPago > 0 && saldo > 0)) return "parcial";
  return "aberto";
}

// Detalhe de uma conta a receber ou a pagar + os recebimentos/pagamentos dela.
export function titulo(v: unknown, baixas: unknown): Titulo | null {
  const d = obj(v);
  const id = inteiro(d.id);
  const vencimento = data(d.dataVencimento) ?? data(d.data);
  if (!id || !vencimento) return null;
  const pagamentos = lista(baixas).map(obj).filter((b) => numero(b.valorPago) > 0);
  const ultima = pagamentos.slice().sort((a, b) => String(a.data ?? "").localeCompare(String(b.data ?? ""))).pop();
  const valorPago = numero(d.valorPago) || arred2(pagamentos.reduce((s, b) => s + numero(b.valorPago), 0));
  const saldo = numero(d.saldo);
  const documento = texto(d.numeroDocumento);
  const categoria = obj(d.categoria);
  return {
    id,
    situacao: situacaoTitulo(d.situacao, valorPago, saldo),
    emissao: data(d.data),
    vencimento,
    liquidacao: data(d.dataLiquidacao) ?? data(ultima?.data),
    valor: arred2(numero(d.valor)),
    valor_pago: arred2(valorPago),
    saldo: arred2(saldo),
    descricao: (texto(d.historico) ?? (documento ? `Documento ${documento}` : `Título Tiny nº ${id}`)).slice(0, 300),
    documento,
    contato: contato(d.cliente ?? d.contato),
    categoria_id: inteiro(categoria.id),
    categoria_nome: texto(categoria.descricao),
    conta_id: inteiro(ultima?.idConta),
  };
}

// Grupos que faltavam na tabela de categorias do Tiny (encaixe aprovado em 23/10).
const GRUPO_PADRAO: Record<string, string> = {
  "COMPRAS - ÓLEO INJETORA": "FORNECEDOR",
  "PRESTAÇÃO DE SERVIÇO ENCARTELADOS": "FORNECEDOR",
  "CUSTAS CARTORÁRIAS": "ADMINISTRATIVO",
  "MANUTENÇÃO - MOLDE INJETORA": "MANUTENCAO",
};

export function categoria(v: unknown): Categoria | null {
  const c = obj(v);
  const id = inteiro(c.id);
  const descricao = texto(c.descricao);
  if (!id || !descricao) return null;
  const grupo = (texto(c.grupo) ?? GRUPO_PADRAO[descricao.toUpperCase()] ?? "SEM GRUPO").toUpperCase();
  return {
    id,
    descricao,
    grupo,
    tipo: grupo === "RECEBIMENTO" || grupo.startsWith("RECEITA") ? "receita" : "despesa",
    ativa: !/N[ÃA]O\s+USAR/i.test(descricao),
  };
}

export function contaFinanceira(v: unknown): ContaFinanceira | null {
  const c = obj(v);
  const id = inteiro(c.id);
  const descricao = texto(c.descricao);
  if (!id || !descricao) return null;
  return { id, descricao, ativa: texto(c.situacao) !== "I" };
}

function canal(ecommerce: Bruto): Pedido["canal"] {
  const nome = `${texto(ecommerce.nome) ?? ""} ${texto(ecommerce.canalVenda) ?? ""}`.toLowerCase();
  if (!nome.trim()) return "venda_direta";
  if (nome.includes("mercado")) return "mercado_livre";
  if (nome.includes("shopee")) return "shopee";
  return "outro";
}

export function pedido(v: unknown, hoje: string): Pedido | null {
  const d = obj(v);
  const id = inteiro(d.id);
  if (!id) return null;
  const pagamento = obj(d.pagamento);
  const parcelas = lista(pagamento.parcelas).map(obj);
  const dias = parcelas.map((p) => numero(p.dias)).filter((n) => n > 0);
  const ecommerce = obj(d.ecommerce);
  const c = canal(ecommerce);
  const itens: ItemPedido[] = lista(d.itens)
    .map(obj)
    .map((i) => {
      const p = obj(i.produto);
      return {
        produto_id: inteiro(p.id),
        sku: texto(p.sku),
        descricao: texto(p.descricao),
        servico: texto(p.tipo) === "S",
        quantidade: numero(i.quantidade),
        valor_unitario: numero(i.valorUnitario),
      };
    })
    .filter((i) => i.quantidade > 0 && (i.produto_id || i.sku));
  return {
    id,
    numero: String(inteiro(d.numeroPedido) ?? id),
    numero_loja: c === "venda_direta" ? null : texto(ecommerce.numeroPedidoEcommerce) ?? texto(ecommerce.numeroPedidoCanalVenda),
    canal: c,
    data: data(d.data) ?? data(d.dataCriacao) ?? hoje,
    data_prevista: data(d.dataPrevista),
    situacao: inteiro(d.situacao) ?? 0,
    cliente: contato(d.cliente),
    vendedor: texto(obj(d.vendedor).nome),
    nota: texto(obj(d.notaFiscal).numero),
    condicao: texto(pagamento.condicaoPagamento) ?? (dias.length ? dias.join("/") : null),
    prazo_dias: dias.length ? Math.round(dias.reduce((s, n) => s + n, 0) / dias.length) : 0,
    observacao: texto(d.observacoes),
    frete: arred2(numero(d.valorFrete)),
    desconto: arred2(numero(d.valorDesconto)),
    transportadora: texto(obj(d.transportador).nome),
    itens,
    original: v,
  };
}

export function produto(v: unknown): Produto | null {
  const d = obj(v);
  const id = inteiro(d.id);
  if (!id) return null;
  const dim = obj(d.dimensoes);
  const tipo = texto(d.tipo);
  return {
    produto_id: id,
    sku: texto(d.sku),
    descricao: texto(d.descricao),
    tipo_item: tipo === "M" ? "materia_prima" : "produto_acabado",
    unidade: texto(d.unidade)?.toUpperCase().slice(0, 6) ?? null,
    ncm: texto(d.ncm),
    peso: numero(dim.pesoBruto) || numero(dim.pesoLiquido) || null,
    preco: numero(obj(d.precos).preco) || null,
  };
}

// O que muda na listagem e obriga a ler o detalhe de novo.
export function assinatura(tipo: "receber" | "pagar" | "pedido" | "produto", v: unknown): string {
  const d = obj(v);
  const campos =
    tipo === "pedido"
      ? [d.situacao, d.valor, d.dataPrevista]
      : tipo === "produto"
        ? [d.dataAlteracao, d.situacao, obj(d.precos).preco]
        : [d.situacao, d.valor, d.saldo, d.dataVencimento, d.dataAtualizacao];
  return campos.map((c) => (c === null || c === undefined ? "" : String(c))).join("|");
}
