// Cadastros de apoio ao pedido de venda, numa tela só com uma aba por cadastro.
// Vêm do Tiny (tiny_id) e podem ser incluídos ou ajustados aqui.

export type TipoCampo = "texto" | "numero" | "dias" | "documento";
export type CampoCadastro = { nome: string; rotulo: string; tipo: TipoCampo; dica?: string; obrigatorio?: boolean };
export type Cadastro = {
  tabela: string;
  titulo: string;
  novo: string;
  ativo: "ativo" | "ativa";
  campos: CampoCadastro[];
};

const nome: CampoCadastro = { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true };

export const CADASTROS_COMERCIAL = {
  vendedores: {
    tabela: "vendedores",
    titulo: "Vendedores",
    novo: "Novo vendedor",
    ativo: "ativo",
    campos: [
      nome,
      { nome: "email", rotulo: "E-mail", tipo: "texto" },
      { nome: "telefone", rotulo: "Telefone", tipo: "texto" },
      { nome: "comissao_percentual", rotulo: "Comissão (%)", tipo: "numero" },
    ],
  },
  condicoes: {
    tabela: "condicoes_pagamento",
    titulo: "Condições de pagamento",
    novo: "Nova condição",
    ativo: "ativa",
    campos: [
      { ...nome, dica: "Como aparece no pedido. Ex.: 28/56 dias." },
      { nome: "dias", rotulo: "Dias de cada parcela", tipo: "dias", dica: "Separados por barra: 28/56/84. Vazio = à vista." },
    ],
  },
  formas_pagamento: {
    tabela: "formas_pagamento",
    titulo: "Formas de pagamento",
    novo: "Nova forma de pagamento",
    ativo: "ativa",
    campos: [{ ...nome, dica: "Boleto, Pix, depósito..." }],
  },
  listas: {
    tabela: "listas_preco",
    titulo: "Listas de preço",
    novo: "Nova lista de preço",
    ativo: "ativa",
    campos: [
      nome,
      { nome: "acrescimo_desconto", rotulo: "Acréscimo / desconto (%)", tipo: "numero", dica: "Sobre o preço de venda do produto. Desconto com sinal de menos: -10." },
    ],
  },
  transportadoras: {
    tabela: "transportadoras",
    titulo: "Transportadoras",
    novo: "Nova transportadora",
    ativo: "ativa",
    campos: [nome, { nome: "documento", rotulo: "CNPJ / CPF", tipo: "documento" }, { nome: "telefone", rotulo: "Telefone", tipo: "texto" }],
  },
  formas_envio: {
    tabela: "formas_envio",
    titulo: "Formas de envio",
    novo: "Nova forma de envio",
    ativo: "ativa",
    campos: [nome],
  },
  naturezas: {
    tabela: "naturezas_operacao",
    titulo: "Naturezas de operação",
    novo: "Nova natureza de operação",
    ativo: "ativa",
    campos: [{ ...nome, dica: "Use o mesmo nome do Tiny: a nota sai com a natureza cadastrada lá." }],
  },
} satisfies Record<string, Cadastro>;

export type ChaveCadastro = keyof typeof CADASTROS_COMERCIAL;

export const ehCadastro = (v: string | undefined): v is ChaveCadastro => !!v && v in CADASTROS_COMERCIAL;

// "28/56/84" ↔ {28,56,84}
export const lerDias = (t: string): number[] | null => {
  const partes = t.split(/[^\d]+/).filter(Boolean).map(Number);
  return partes.every((n) => Number.isInteger(n) && n >= 0 && n <= 999) ? partes : null;
};
export const mostrarDias = (dias: number[] | null | undefined) => (dias?.length ? dias.join("/") : "à vista");

// Quem paga o frete, com os códigos do Tiny (modalidade da nota fiscal).
export const FRETE_POR_CONTA: Record<string, string> = {
  R: "Remetente (CIF)",
  D: "Destinatário (FOB)",
  T: "Terceiros",
  "3": "Próprio remetente",
  "4": "Próprio destinatário",
  S: "Sem frete",
};

// Endereço de entrega diferente do cadastro do cliente.
export const CAMPOS_ENDERECO = [
  { nome: "nome", rotulo: "Destinatário", largo: true },
  { nome: "logradouro", rotulo: "Endereço", largo: true },
  { nome: "numero", rotulo: "Número" },
  { nome: "complemento", rotulo: "Complemento" },
  { nome: "bairro", rotulo: "Bairro" },
  { nome: "cidade", rotulo: "Cidade" },
  { nome: "uf", rotulo: "UF" },
  { nome: "cep", rotulo: "CEP" },
  { nome: "telefone", rotulo: "Telefone" },
] as const;
