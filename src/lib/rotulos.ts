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
