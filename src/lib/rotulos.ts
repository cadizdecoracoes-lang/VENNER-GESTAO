// Nomes mostrados nas telas para os valores guardados no banco.

export const REGIMES = {
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
} as const;
export type Regime = keyof typeof REGIMES;

export const ATIVIDADES = {
  industria: "Indústria",
  venda_direta: "Venda direta",
  marketplace: "Marketplace",
  servico: "Prestação de serviço",
} as const;

export const TIPOS_ITEM = {
  produto_acabado: "Produto acabado",
  subconjunto: "Subconjunto",
  materia_prima: "Matéria-prima",
  embalagem: "Embalagem",
  servico: "Serviço",
} as const;
export type TipoItem = keyof typeof TIPOS_ITEM;

// Itens que são montados e por isso têm ficha técnica.
export const TIPOS_COM_FICHA: TipoItem[] = ["produto_acabado", "subconjunto"];

export const STATUS_FICHA = {
  rascunho: "Rascunho",
  ativa: "Ativa",
  substituida: "Substituída",
} as const;
export type StatusFicha = keyof typeof STATUS_FICHA;

export const TIPOS_PESSOA = {
  juridica: "Pessoa jurídica (CNPJ)",
  fisica: "Pessoa física (CPF)",
} as const;
export type TipoPessoa = keyof typeof TIPOS_PESSOA;

export const CANAIS = {
  venda_direta: "Venda direta",
  mercado_livre: "Mercado Livre",
  shopee: "Shopee",
  outro: "Outro",
} as const;
export type Canal = keyof typeof CANAIS;

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

export const ACOES = {
  ver: "Ver",
  criar: "Criar",
  editar: "Editar",
  aprovar: "Aprovar",
  excluir: "Excluir",
} as const;

export const TIPOS_CONTA_BANCARIA = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  aplicacao: "Aplicação",
  caixa: "Caixa (dinheiro)",
} as const;
export type TipoContaBancaria = keyof typeof TIPOS_CONTA_BANCARIA;

export const TIPOS_PLANO_CONTA = {
  receita: "Receita",
  despesa: "Despesa",
} as const;
export type TipoPlanoConta = keyof typeof TIPOS_PLANO_CONTA;

export const TIPOS_EVENTO_FOLHA = {
  provento: "Provento",
  desconto: "Desconto",
  informativo: "Informativo",
} as const;
export type TipoEventoFolha = keyof typeof TIPOS_EVENTO_FOLHA;

export const FORMAS_CALCULO = {
  valor: "Valor (R$)",
  percentual: "Percentual (%)",
  horas: "Horas",
  dias: "Dias",
} as const;
export type FormaCalculo = keyof typeof FORMAS_CALCULO;

export const SITUACOES_TITULO = {
  aberto: "Em aberto",
  pago: "Pago",
  cancelado: "Cancelado",
} as const;
export type SituacaoTitulo = keyof typeof SITUACOES_TITULO;

export const ORIGENS_NOTA = {
  xml: "XML",
  pdf: "PDF",
  manual: "Manual",
} as const;
export type OrigemNota = keyof typeof ORIGENS_NOTA;

export const FASES_PEDIDO = {
  negociacao: "Negociação",
  producao: "Produção",
  expedicao: "Expedição",
  encerrado: "Encerrado",
} as const;
export type FasePedido = keyof typeof FASES_PEDIDO;

export const PRIORIDADES = { 0: "Normal", 1: "Alta", 2: "Urgente" } as const;
