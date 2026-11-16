// Formato do que a leitura do Tiny manda ao banco (tiny_aplicar). Sem
// dependências do Next, para rodar também nos testes.

export type TipoFila = "receber" | "pagar" | "pedido" | "produto" | "compra";

export type Contato = {
  id: number;
  nome: string | null;
  fantasia: string | null;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  celular: string | null;
  ie: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
};

export type Titulo = {
  id: number;
  situacao: "aberto" | "pago" | "parcial" | "cancelado";
  emissao: string | null;
  vencimento: string;
  liquidacao: string | null;
  valor: number;
  valor_pago: number;
  saldo: number;
  descricao: string;
  documento: string | null;
  contato: Contato | null;
  categoria_id: number | null;
  categoria_nome: string | null;
  // Conta financeira do Tiny onde o dinheiro entrou/saiu.
  conta_id: number | null;
};

export type ItemPedido = {
  produto_id: number | null;
  sku: string | null;
  descricao: string | null;
  servico: boolean;
  quantidade: number;
  valor_unitario: number;
};

export type Pedido = {
  id: number;
  numero: string;
  numero_loja: string | null;
  canal: "venda_direta" | "mercado_livre" | "shopee" | "outro";
  data: string;
  data_prevista: string | null;
  situacao: number;
  cliente: Contato | null;
  vendedor: string | null;
  nota: string | null;
  condicao: string | null;
  prazo_dias: number;
  observacao: string | null;
  frete: number;
  desconto: number;
  transportadora: string | null;
  itens: ItemPedido[];
  // O pedido inteiro como veio do Tiny.
  original: unknown;
};

export type Produto = {
  produto_id: number;
  sku: string | null;
  descricao: string | null;
  tipo_item: "produto_acabado" | "materia_prima" | "servico";
  // Tipo no Tiny: S simples, K kit, V com variações, F fabricado, M matéria-prima.
  tipo_tiny: string | null;
  unidade: string | null;
  ncm: string | null;
  peso: number | null;
  preco: number | null;
  // Componentes do kit ou da produção (produto fabricado) cadastrados no Tiny.
  estrutura: { produto_id: number; sku: string | null; descricao: string | null; quantidade: number }[];
};

// Ordem de compra do Tiny (situação: 0 em aberto, 1 atendida, 2 cancelada, 3 em andamento).
export type OrdemCompra = {
  id: number;
  numero: string;
  data: string;
  data_prevista: string | null;
  situacao: number;
  fornecedor: Contato | null;
  categoria_id: number | null;
  categoria_nome: string | null;
  frete: number;
  desconto: number;
  // Igual ao Tiny: R, D, T, 3, 4 ou S.
  frete_por_conta: string | null;
  observacoes: string | null;
  observacoes_internas: string | null;
  itens: { produto_id: number | null; sku: string | null; descricao: string | null; quantidade: number; valor_unitario: number; aliquota_ipi: number }[];
  parcelas: { dias: number; vencimento: string; valor: number; meio_pagamento: string | null; observacao: string | null }[];
};

// Nota fiscal do Tiny, como vem da listagem (entrada ou saída). Situação:
// 1 pendente, 2 emitida, 3 cancelada, 4 aguardando recibo, 5 rejeitada,
// 6 autorizada, 7 DANFE emitida, 8 registrada, 9 aguardando protocolo, 10 denegada.
export type NotaTiny = {
  id: number;
  tipo: "E" | "S";
  numero: string | null;
  serie: string | null;
  chave: string | null;
  situacao: number;
  emissao: string | null;
  contato_nome: string | null;
  contato_documento: string | null;
  valor: number;
  origem_tipo: string | null;
  origem_id: string | null;
  pedido_ecommerce: string | null;
};

export type Categoria = { id: number; descricao: string; grupo: string; tipo: "receita" | "despesa"; ativa: boolean };

export type ContaFinanceira = { id: number; descricao: string; ativa: boolean };

export type Listado = { tipo: TipoFila; id: number; assinatura: string };

export type Lote = {
  historico_desde: string;
  contas?: ContaFinanceira[];
  categorias?: Categoria[];
  listados: Listado[];
  pagar_ciclo_inicio?: string;
  receber_ciclo_inicio?: string;
  receber: Titulo[];
  pagar: Titulo[];
  pedidos: Pedido[];
  produtos: Produto[];
  compras?: OrdemCompra[];
  notas?: NotaTiny[];
  falhas: { tipo: TipoFila; id: number; erro: string }[];
  removidos: { tipo: TipoFila; id: number }[];
  estado: EstadoLeitura;
  erro?: string;
};

// Volta completa pelos títulos: primeiro os em aberto, depois os vencimentos do ano.
export type Ciclo = { fase: "abertos" | "ano"; offset: number; inicio?: string };

// Onde cada listagem parou (guardado no banco entre uma leitura e outra).
export type Cursor = { desde: string; offset: number; inicio?: string };
export type EstadoLeitura = {
  cadastros_em?: string;
  receber?: Cursor;
  pedidos?: Cursor;
  produtos?: Cursor;
  pagar?: Ciclo;
  receber_ciclo?: Ciclo;
  // Ordens de compra: a listagem não filtra por alteração, então dá voltas
  // completas pelas criadas desde HISTORICO_DESDE comparando a assinatura.
  compras?: { offset: number };
  // Notas fiscais: voltas completas pelas criadas desde HISTORICO_DESDE
  // (gravadas direto da listagem, sem ler o detalhe).
  notas?: { offset: number };
  // Antigos (até 10/11/2026): listagem do receber por alteração e volta
  // pelos em aberto. Não são mais usados.
  receber_abertos?: { offset: number };
};

// Títulos pagos ou cancelados antes disso não entram (histórico de 2026).
export const HISTORICO_DESDE = "2026-01-01";
