// Mapa de telas do sistema. O `codigo` de cada tela é o mesmo usado na tabela
// `telas` do banco e nas permissões por perfil (ver supabase/migrations).
import {
  Factory,
  Boxes,
  ShoppingCart,
  Store,
  Landmark,
  Users,
  LineChart,
  Settings,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";

export type Tela = {
  codigo: string;
  titulo: string;
  href: string;
  descricao: string;
};

export type GrupoMenu = {
  codigo: string;
  titulo: string;
  icone: LucideIcon;
  telas: Tela[];
};

function tela(codigo: string, titulo: string, descricao: string): Tela {
  const href = "/" + codigo.replaceAll(".", "/").replaceAll("_", "-");
  return { codigo, titulo, href, descricao };
}

export const PAINEL: Tela = {
  codigo: "painel",
  titulo: "Painel",
  href: "/",
  descricao: "Visão geral do dia: produção, estoque, caixa e pendências.",
};

export const MENU: GrupoMenu[] = [
  {
    codigo: "producao",
    titulo: "Produção",
    icone: Factory,
    telas: [
      tela("producao.ordens", "Ordens de produção", "Ordens sugeridas pelo MRP e em andamento na linha de montagem."),
      tela("producao.ficha_tecnica", "Ficha técnica", "Estrutura de montagem, roteiro de operações e custo padrão de cada produto."),
      tela("producao.sequenciamento", "Sequenciamento", "Fila de produção sugerida, com o motivo de cada posição."),
      tela("producao.apontamentos", "Apontamentos", "Registro de início, fim, quantidade boa e refugo por etapa."),
      tela("producao.postos", "Postos de trabalho", "Postos da linha, capacidade e custo hora."),
    ],
  },
  {
    codigo: "estoque",
    titulo: "Estoque",
    icone: Boxes,
    telas: [
      tela("estoque.saldos", "Saldos", "Saldo unificado do grupo por item e local."),
      tela("estoque.movimentos", "Movimentações", "Entradas, saídas e ajustes, cada um com o documento de origem."),
      tela("estoque.itens", "Itens", "Produtos acabados, subconjuntos e matérias-primas."),
      tela("estoque.locais", "Locais de estoque", "Depósitos e áreas onde o estoque fica guardado."),
    ],
  },
  {
    codigo: "compras",
    titulo: "Compras",
    icone: ShoppingCart,
    telas: [
      tela("compras.sugestoes", "Sugestões de compra", "O que falta comprar, até quando e por qual CNPJ."),
      tela("compras.pedidos", "Pedidos de compra", "Pedidos por CNPJ comprador e recebimento."),
      tela("compras.fornecedores", "Fornecedores", "Cadastro de fornecedores e prazos de entrega."),
    ],
  },
  {
    codigo: "vendas",
    titulo: "Vendas e E-commerce",
    icone: Store,
    telas: [
      tela("vendas.pedidos", "Pedidos de venda", "Pedidos do Mercado Livre, Shopee e venda direta."),
      tela("vendas.clientes", "Clientes", "Cadastro de clientes."),
    ],
  },
  {
    codigo: "financeiro",
    titulo: "Financeiro",
    icone: Landmark,
    telas: [
      tela("financeiro.pagar", "Contas a pagar", "Títulos a pagar por CNPJ."),
      tela("financeiro.receber", "Contas a receber", "Títulos a receber por CNPJ."),
      tela("financeiro.conciliacao", "Conciliação bancária", "Extrato do banco casado com os lançamentos."),
      tela("financeiro.fluxo_caixa", "Fluxo de caixa", "Realizado (conciliado) e projetado, por CNPJ e consolidado."),
      tela("financeiro.contas_bancarias", "Contas bancárias", "Contas de cada CNPJ, com saldo inicial para a conciliação."),
      tela("financeiro.categorias", "Categorias financeiras", "Plano de contas: receitas e despesas em árvore, comuns a todo o grupo."),
      tela("financeiro.centros_custo", "Centros de custo", "Áreas do grupo para separar as despesas."),
    ],
  },
  {
    codigo: "rh",
    titulo: "RH",
    icone: Users,
    telas: [
      tela("rh.funcionarios", "Funcionários", "Cadastro, cargo, salário e empresa empregadora."),
      tela("rh.ponto", "Ponto e escalas", "Escalas, marcações, horas extras e faltas."),
      tela("rh.ferias", "Férias e 13º", "Períodos aquisitivos, programação e provisões."),
      tela("rh.folha", "Conferência da folha", "Holerite calculado comparado com o da contabilidade."),
      tela("rh.eventos", "Eventos do holerite", "Proventos, descontos e informativos, com incidência de INSS, FGTS e IRRF."),
    ],
  },
  {
    codigo: "estrategico",
    titulo: "Estratégico",
    icone: LineChart,
    telas: [
      tela("estrategico.indicadores", "Indicadores", "Saúde financeira e operacional, com a origem de cada número."),
      tela("estrategico.tributario", "Visão tributária", "Simples Nacional e Lucro Real separados, base do planejamento tributário."),
    ],
  },
  {
    codigo: "config",
    titulo: "Configurações",
    icone: Settings,
    telas: [
      tela("config.empresas", "Empresas do grupo", "CNPJs, regime tributário e atividades."),
      tela("config.usuarios", "Usuários", "Quem acessa o sistema e com qual perfil."),
      tela("config.perfis", "Perfis de acesso", "Telas e ações liberadas para cada perfil."),
      tela("config.atualizacoes", "Atualizações", "Histórico do que mudou no sistema e quando."),
    ],
  },
];

export const ICONE_PAINEL = LayoutDashboard;

export const TODAS_TELAS: Tela[] = [PAINEL, ...MENU.flatMap((g) => g.telas)];

export function telaPorHref(href: string): Tela | undefined {
  return TODAS_TELAS.find((t) => t.href === href);
}

export function telaPorCodigo(codigo: string): { tela: Tela; grupo: string } {
  for (const g of MENU) {
    const tela = g.telas.find((t) => t.codigo === codigo);
    if (tela) return { tela, grupo: g.titulo };
  }
  throw new Error(`Tela desconhecida: ${codigo}`);
}
