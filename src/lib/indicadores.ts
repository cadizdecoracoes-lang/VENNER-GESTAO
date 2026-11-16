// Regras de cálculo da tela Estratégico › Indicadores. O banco devolve os
// números já somados (função indicadores_gestao) e aqui saem os indicadores:
// resultado do mês, ponto de equilíbrio, prazos, produtividade da folha e o
// diagnóstico "onde está o problema". Funções puras, testadas em
// tests/indicadores.test.ts.

// ---------------------------------------------------------------------------
// Dados que chegam do banco
// ---------------------------------------------------------------------------

export type TipoTitulo = "pagar" | "receber";

export type DadosIndicadores = {
  hoje: string;
  de: string;
  ate: string;
  titulos_mes: { tipo: TipoTitulo; mes: string; categoria_id: string | null; previsto: number; realizado: number; qtd: number; tarifas: number }[];
  aberto: { tipo: TipoTitulo; faixa: FaixaAberto; valor: number; qtd: number; dias_valor: number | null }[];
  pontualidade: { tipo: TipoTitulo; qtd: number; valor: number; em_dia: number; valor_atrasado: number | null; dias_atraso_valor: number | null }[];
  baixas_90d: Partial<Record<TipoTitulo, number>>;
  pessoas: {
    tipo: TipoTitulo;
    pessoa_id: string | null;
    nome: string;
    total: number;
    qtd: number;
    aberto: number | null;
    vencido: number | null;
    baixados: number;
    em_dia: number;
    atraso_medio: number | null;
    condicao_cadastro: string | null;
  }[];
  condicoes: {
    tipo: TipoTitulo;
    pessoa_id: string | null;
    condicao: string | null;
    dias_parcelas: number | null;
    dias_pedido: number | null;
    valor: number;
  }[];
  pedidos_etapa: {
    etapa_id: string;
    nome: string;
    fase: "negociacao" | "producao" | "expedicao";
    ordem: number;
    qtd: number;
    valor: number;
    dias_na_etapa: number | null;
    idade_media: number | null;
    idade_maxima: number | null;
    atrasados: number;
    valor_atrasado: number;
    atraso_medio: number | null;
  }[];
  pedidos_mes: {
    mes: string;
    canal: string;
    entrada_qtd: number;
    entrada_valor: number;
    saida_qtd: number;
    saida_valor: number;
    ciclo_dias: number;
  }[];
  notas_mes: { tipo: "E" | "S"; mes: string; qtd: number; valor: number }[];
  compras_mes: { mes: string; qtd: number; valor: number; recebidos: number }[];
  canais_mes: { canal: string; mes: string; qtd: number; bruto: number; tarifas: number }[];
};

export type FaixaAberto = "vencido_91" | "vencido_31_90" | "vencido_1_30" | "vence_30" | "vence_31_60" | "vence_61";

export const FAIXAS: { faixa: FaixaAberto; rotulo: string; vencido: boolean }[] = [
  { faixa: "vencido_91", rotulo: "Vencido há mais de 90 dias", vencido: true },
  { faixa: "vencido_31_90", rotulo: "Vencido de 31 a 90 dias", vencido: true },
  { faixa: "vencido_1_30", rotulo: "Vencido até 30 dias", vencido: true },
  { faixa: "vence_30", rotulo: "Vence em até 30 dias", vencido: false },
  { faixa: "vence_31_60", rotulo: "Vence de 31 a 60 dias", vencido: false },
  { faixa: "vence_61", rotulo: "Vence depois de 60 dias", vencido: false },
];

// Custo da folha por mês e setor (view folha_custo_mensal do RH).
export type FolhaMes = { empresa_id: string; competencia: string; setor: string; funcionarios: number; custo: number };

export type Categoria = { id: string; codigo: string | null; nome: string; tipo: "receita" | "despesa"; pai_id: string | null };

export const vazio = (hoje: string, de: string, ate: string): DadosIndicadores => ({
  hoje,
  de,
  ate,
  titulos_mes: [],
  aberto: [],
  pontualidade: [],
  baixas_90d: {},
  pessoas: [],
  condicoes: [],
  pedidos_etapa: [],
  pedidos_mes: [],
  notas_mes: [],
  compras_mes: [],
  canais_mes: [],
});

// ---------------------------------------------------------------------------
// Classificação das categorias financeiras (vindas do Tiny) em grupos de
// gestão. Pelo nome: primeiro a própria categoria, depois as categorias-mãe.
// ---------------------------------------------------------------------------

export type Classe =
  | "receita"
  | "deducao" // impostos sobre venda, devoluções, tarifas de marketplace
  | "materia_prima" // matéria-prima, insumos, embalagens, mercadoria
  | "variavel" // comissões e fretes de venda
  | "folha" // salários, encargos e benefícios
  | "fixa" // aluguel, energia, administrativo, serviços, pró-labore...
  | "financeiro" // juros, tarifas bancárias, empréstimos
  | "investimento" // máquinas, equipamentos, obras
  | "transferencia"; // entre contas: não é receita nem despesa

export const NOME_CLASSE: Record<Classe, string> = {
  receita: "Receitas",
  deducao: "Impostos e deduções sobre vendas",
  materia_prima: "Matéria-prima, insumos e embalagens",
  variavel: "Comissões e fretes de venda",
  folha: "Folha (salários, encargos, benefícios)",
  fixa: "Despesas fixas (aluguel, energia, administrativo...)",
  financeiro: "Juros, tarifas bancárias e empréstimos",
  investimento: "Investimentos (máquinas, obras)",
  transferencia: "Transferências entre contas (fora do resultado)",
};

export const CLASSES_VARIAVEIS: Classe[] = ["deducao", "materia_prima", "variavel"];
export const CLASSES_FIXAS: Classe[] = ["folha", "fixa", "financeiro"];

const sem = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const REGRAS: [Classe, RegExp][] = [
  ["transferencia", /transfer|entre contas|aplicacao financeira|resgate/],
  ["folha", /salari|folha|encargo|fgts|inss|ferias|13o|13º|13 sal|decimo|rescis|vale.?(transporte|refeicao|alimentacao)|beneficio|mao de obra|pessoal|funcionari|adiantamento sal|plano de saude|sindic/],
  ["investimento", /investiment|imobilizad|maquina|equipament|obra|reforma|veiculo/],
  ["deducao", /imposto|tributo|simples nacional|\bdas\b|icms|\bpis\b|cofins|\bipi\b|\biss\b|deduc|devoluc|estorno|tarifa.*(marketplace|mercado|shopee)|taxa.*(marketplace|mercado|shopee)/],
  ["variavel", /comiss|frete|logistic|correio|transportad|entrega/],
  ["materia_prima", /materia|insumo|embalag|mercadoria|compra|fornecedor|componente|tecido|madeira|espuma|ferragem|aviament/],
  ["financeiro", /juros|tarifa|banc|iof|emprestim|financiament|multa|cartao/],
];

function classePeloNome(nome: string): Classe | null {
  const n = sem(nome);
  for (const [classe, regra] of REGRAS) if (regra.test(n)) return classe;
  return null;
}

// Classe de cada categoria (por id). Receita é tudo do tipo receita que não
// for transferência; despesa sem palavra conhecida vira "fixa".
export function classificarCategorias(categorias: Categoria[]): Map<string, Classe> {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const saida = new Map<string, Classe>();
  for (const c of categorias) {
    let classe: Classe | null = null;
    for (let atual: Categoria | undefined = c, voltas = 0; atual && voltas < 10; atual = atual.pai_id ? porId.get(atual.pai_id) : undefined, voltas++) {
      classe = classePeloNome(atual.nome);
      if (classe) break;
    }
    if (c.tipo === "receita") saida.set(c.id, classe === "transferencia" ? "transferencia" : "receita");
    else saida.set(c.id, classe ?? "fixa");
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Prazo em dias a partir do texto da condição de pagamento ("30/60/90",
// "28 dd", "à vista", "15 dias"). Devolve a média das parcelas, ou null.
// ---------------------------------------------------------------------------
export function diasDaCondicao(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const t = sem(texto).trim();
  if (/^a ?vista$|^avista|antecipad|^pix$|^dinheiro$/.test(t)) return 0;
  const numeros = (t.match(/\d+/g) ?? []).map(Number).filter((n) => n <= 720);
  if (!numeros.length) return null;
  // "3x" ou "3 vezes" sozinho: parcelas mensais (30, 60, 90).
  const vezes = t.match(/^(\d+)\s*(x|vezes)$/);
  if (vezes) {
    const n = Number(vezes[1]);
    return n > 0 && n <= 36 ? (30 * (n + 1)) / 2 : null;
  }
  return numeros.reduce((s, n) => s + n, 0) / numeros.length;
}

// ---------------------------------------------------------------------------
// Meses e médias
// ---------------------------------------------------------------------------

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;

export function mesesEntre(de: string, ate: string): string[] {
  const lista: string[] = [];
  let [a, m] = de.split("-").map(Number);
  const fim = ate.slice(0, 7);
  for (let i = 0; i < 120; i++) {
    const mes = `${a}-${String(m).padStart(2, "0")}`;
    if (mes > fim) break;
    lista.push(mes);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  return lista;
}

const n = (v: number | null | undefined) => Number(v ?? 0) || 0;
const somar = <T>(l: T[], f: (x: T) => number) => l.reduce((s, x) => s + n(f(x)), 0);
const razao = (a: number, b: number) => (b ? a / b : null);

// Meses usados nas médias: os já fechados do período (o mês corrente ainda
// está pela metade). Sem nenhum fechado, usa todos.
export function mesesDaMedia(meses: string[], hoje: string): string[] {
  const fechados = meses.filter((m) => m < hoje.slice(0, 7));
  return fechados.length ? fechados : meses;
}

// ---------------------------------------------------------------------------
// Resultado por mês (despesas + custos × receita)
// ---------------------------------------------------------------------------

export type LinhaMes = {
  mes: string;
  receita: number; // contas a receber pelo vencimento (categorias de receita)
  porClasse: Record<Classe, number>; // contas a pagar pelo vencimento
  semCategoria: number; // a pagar sem categoria (conta como fixa)
  variaveis: number;
  fixas: number; // inclui folha do contas a pagar
  resultado: number; // receita − variáveis − fixas (sem investimento/transferência)
  recebido: number; // caixa
  pago: number; // caixa (sem transferências)
  faturado: number; // NF de saída do Tiny
  comprasNf: number; // NF de entrada do Tiny
  comprasPedidos: number; // pedidos de compra
  entradaPedidos: number; // pedidos de venda novos (R$)
  entradaPedidosQtd: number;
  saidaPedidos: number; // pedidos que saíram da fábrica (R$)
  saidaPedidosQtd: number;
  folhaHolerite: number | null; // custo da folha pelos holerites
  funcionarios: number | null;
  funcionariosProducao: number | null;
  folhaProducao: number | null;
};

const zeroClasses = (): Record<Classe, number> => ({
  receita: 0,
  deducao: 0,
  materia_prima: 0,
  variavel: 0,
  folha: 0,
  fixa: 0,
  financeiro: 0,
  investimento: 0,
  transferencia: 0,
});

export function montarMeses(dados: DadosIndicadores, classes: Map<string, Classe>, folha: FolhaMes[] | null): LinhaMes[] {
  return mesesEntre(dados.de, dados.ate).map((mes) => {
    const porClasse = zeroClasses();
    let receita = 0;
    let semCategoria = 0;
    let recebido = 0;
    let pago = 0;
    for (const t of dados.titulos_mes.filter((x) => x.mes === mes)) {
      const classe = t.categoria_id ? classes.get(t.categoria_id) : undefined;
      if (t.tipo === "receber") {
        if (classe !== "transferencia") {
          receita += n(t.previsto);
          recebido += n(t.realizado);
        }
      } else {
        if (classe !== "transferencia") pago += n(t.realizado);
        if (!classe) semCategoria += n(t.previsto);
        porClasse[classe ?? "fixa"] += n(t.previsto);
      }
    }
    const variaveis = somar(CLASSES_VARIAVEIS, (c) => porClasse[c]);
    const fixas = somar(CLASSES_FIXAS, (c) => porClasse[c]);
    const pedidos = dados.pedidos_mes.filter((p) => p.mes === mes);
    const folhaMes = folha?.filter((f) => f.competencia.slice(0, 7) === mes) ?? [];
    const temFolha = folha !== null && folhaMes.length > 0;
    return {
      mes,
      receita,
      porClasse,
      semCategoria,
      variaveis,
      fixas,
      resultado: receita - variaveis - fixas,
      recebido,
      pago,
      faturado: somar(
        dados.notas_mes.filter((x) => x.tipo === "S" && x.mes === mes),
        (x) => x.valor,
      ),
      comprasNf: somar(
        dados.notas_mes.filter((x) => x.tipo === "E" && x.mes === mes),
        (x) => x.valor,
      ),
      comprasPedidos: somar(
        dados.compras_mes.filter((x) => x.mes === mes),
        (x) => x.valor,
      ),
      entradaPedidos: somar(pedidos, (p) => p.entrada_valor),
      entradaPedidosQtd: somar(pedidos, (p) => p.entrada_qtd),
      saidaPedidos: somar(pedidos, (p) => p.saida_valor),
      saidaPedidosQtd: somar(pedidos, (p) => p.saida_qtd),
      folhaHolerite: temFolha ? somar(folhaMes, (f) => f.custo) : null,
      funcionarios: temFolha ? somar(folhaMes, (f) => f.funcionarios) : null,
      funcionariosProducao: temFolha ? somar(folhaMes.filter((f) => f.setor === "producao"), (f) => f.funcionarios) : null,
      folhaProducao: temFolha ? somar(folhaMes.filter((f) => f.setor === "producao"), (f) => f.custo) : null,
    };
  });
}

// Média mensal de um campo nos meses da média; null se nenhum mês tem valor.
export function media(meses: LinhaMes[], campo: (m: LinhaMes) => number | null): number | null {
  const valores = meses.map(campo).filter((v): v is number => v !== null);
  return valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
}

// ---------------------------------------------------------------------------
// Ponto de equilíbrio: faturamento que paga variáveis e fixos.
//   margem de contribuição = (receita − variáveis) ÷ receita
//   ponto de equilíbrio = despesas fixas ÷ margem
// Com a folha da meta: troca a folha atual pela folha alvo.
// ---------------------------------------------------------------------------

export type PontoEquilibrio = {
  receita: number; // média mensal usada
  baseReceita: "receber" | "notas" | "nenhuma";
  variaveis: number;
  margem: number | null; // fração (0,35 = 35%)
  fixasSemFolha: number;
  folhaAtual: number;
  origemFolha: "holerites" | "contas_pagar" | "nenhuma";
  folhaAlvo: number;
  pontoAtual: number | null;
  pontoAlvo: number | null;
  falta: number | null; // quanto falta faturar por mês para o ponto com a folha alvo (0 se já passa)
  ticketMedio: number | null; // pedido médio
  pedidosNecessarios: number | null; // pedidos/mês para o ponto alvo
  saidaAtual: number | null; // R$ que sai da fábrica por mês hoje
  aumentoProducao: number | null; // fração a mais de produção para chegar ao ponto alvo
  meses: number;
};

export function pontoEquilibrio(linhas: LinhaMes[], hoje: string, folhaAlvo: number): PontoEquilibrio {
  const base = linhas.filter((l) => mesesDaMedia(linhas.map((x) => x.mes), hoje).includes(l.mes));
  const receitaReceber = media(base, (l) => l.receita) ?? 0;
  const receitaNotas = media(base, (l) => l.faturado) ?? 0;
  const baseReceita = receitaReceber > 0 ? "receber" : receitaNotas > 0 ? "notas" : "nenhuma";
  const receita = baseReceita === "receber" ? receitaReceber : receitaNotas;
  const variaveis = media(base, (l) => l.variaveis) ?? 0;
  const margem = receita > 0 ? (receita - variaveis) / receita : null;
  const folhaPagar = media(base, (l) => l.porClasse.folha) ?? 0;
  const folhaHolerite = media(base, (l) => l.folhaHolerite);
  const fixasSemFolha = (media(base, (l) => l.fixas) ?? 0) - folhaPagar;
  const folhaAtual = folhaHolerite ?? folhaPagar;
  const origemFolha = folhaHolerite !== null ? "holerites" : folhaPagar > 0 ? "contas_pagar" : "nenhuma";
  const ponto = (fixas: number) => (margem !== null && margem > 0 ? fixas / margem : null);
  const pontoAtual = ponto(fixasSemFolha + folhaAtual);
  const pontoAlvo = ponto(fixasSemFolha + folhaAlvo);
  const entradaQtd = somar(base, (l) => l.entradaPedidosQtd);
  const ticketMedio = entradaQtd ? somar(base, (l) => l.entradaPedidos) / entradaQtd : null;
  const saidaPedidos = media(base, (l) => l.saidaPedidos) ?? 0;
  const saidaAtual = saidaPedidos > 0 ? saidaPedidos : receitaNotas > 0 ? receitaNotas : null;
  return {
    receita,
    baseReceita,
    variaveis,
    margem,
    fixasSemFolha,
    folhaAtual,
    origemFolha,
    folhaAlvo,
    pontoAtual,
    pontoAlvo,
    falta: pontoAlvo === null ? null : Math.max(0, pontoAlvo - receita),
    ticketMedio,
    pedidosNecessarios: pontoAlvo !== null && ticketMedio ? pontoAlvo / ticketMedio : null,
    saidaAtual,
    aumentoProducao: pontoAlvo !== null && saidaAtual ? pontoAlvo / saidaAtual - 1 : null,
    meses: base.length,
  };
}

// ---------------------------------------------------------------------------
// Prazos: recebimento × pagamento
// ---------------------------------------------------------------------------

export type Prazos = Record<
  TipoTitulo,
  {
    aberto: number;
    vencido: number;
    pelaMedia: number | null; // saldo em aberto ÷ baixas por dia (últimos 90 dias)
    condicao: number | null; // prazo das condições dos pedidos (média ponderada)
    aVencer: number | null; // dias até o vencimento do que está a vencer (ponderado)
    emDia: number | null; // fração das baixas do período feitas até o vencimento
    atrasoMedio: number | null; // dias de atraso médio (ponderado) das baixas atrasadas
  }
> & { ciclo: number | null };

export function diasDaLinhaCondicao(c: DadosIndicadores["condicoes"][number]): number | null {
  if (c.dias_parcelas !== null && c.dias_parcelas !== undefined) return Number(c.dias_parcelas);
  const texto = diasDaCondicao(c.condicao);
  if (texto !== null) return texto;
  if (c.dias_pedido !== null && c.dias_pedido !== undefined) return Number(c.dias_pedido);
  return null;
}

export function calcularPrazos(dados: DadosIndicadores): Prazos {
  const um = (tipo: TipoTitulo) => {
    const aberto = dados.aberto.filter((a) => a.tipo === tipo);
    const total = somar(aberto, (a) => a.valor);
    const vencido = somar(
      aberto.filter((a) => FAIXAS.find((f) => f.faixa === a.faixa)?.vencido),
      (a) => a.valor,
    );
    const aVencer = aberto.filter((a) => !FAIXAS.find((f) => f.faixa === a.faixa)?.vencido);
    const porDia = n(dados.baixas_90d[tipo]) / 90;
    const condicoes = dados.condicoes
      .filter((c) => c.tipo === tipo)
      .map((c) => ({ dias: diasDaLinhaCondicao(c), valor: n(c.valor) }))
      .filter((c): c is { dias: number; valor: number } => c.dias !== null && c.valor > 0);
    const p = dados.pontualidade.find((x) => x.tipo === tipo);
    return {
      aberto: total,
      vencido,
      pelaMedia: porDia > 0 ? total / porDia : null,
      condicao: razao(
        somar(condicoes, (c) => c.dias * c.valor),
        somar(condicoes, (c) => c.valor),
      ),
      aVencer: razao(
        somar(aVencer, (a) => n(a.dias_valor)),
        somar(aVencer, (a) => a.valor),
      ),
      emDia: p && p.qtd ? p.em_dia / p.qtd : null,
      atrasoMedio: p && n(p.valor_atrasado) ? n(p.dias_atraso_valor) / n(p.valor_atrasado) : null,
    };
  };
  const receber = um("receber");
  const pagar = um("pagar");
  const pr = receber.condicao ?? receber.pelaMedia;
  const pp = pagar.condicao ?? pagar.pelaMedia;
  return { receber, pagar, ciclo: pr !== null && pp !== null ? pr - pp : null };
}

// Condição principal (a de maior valor nos pedidos) e prazo médio de cada pessoa.
export function condicaoDaPessoa(dados: DadosIndicadores, tipo: TipoTitulo, pessoa: string | null) {
  const linhas = dados.condicoes.filter((c) => c.tipo === tipo && c.pessoa_id === pessoa);
  const porTexto = new Map<string, number>();
  for (const l of linhas) if (l.condicao) porTexto.set(l.condicao, (porTexto.get(l.condicao) ?? 0) + n(l.valor));
  const principal = [...porTexto.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const comDias = linhas.map((l) => ({ d: diasDaLinhaCondicao(l), v: n(l.valor) })).filter((x) => x.d !== null && x.v > 0);
  const dias = razao(
    somar(comDias, (x) => x.d! * x.v),
    somar(comDias, (x) => x.v),
  );
  return { condicao: principal, dias, pedidos: linhas.length, valorPedidos: somar(linhas, (l) => l.valor) };
}

// ---------------------------------------------------------------------------
// Canais de venda (B2B pelo Tiny e e-commerce)
// ---------------------------------------------------------------------------

export const CANAIS: { canal: string; nome: string; fonte: string }[] = [
  { canal: "venda_direta", nome: "B2B (Tiny)", fonte: "Pedidos e contas a receber do Tiny" },
  { canal: "mercado_livre", nome: "Mercado Livre", fonte: "Upseller / ligação direta (aguardando)" },
  { canal: "shopee", nome: "Shopee", fonte: "Upseller / ligação direta (aguardando)" },
  { canal: "outro", nome: "Outras lojas (Upseller)", fonte: "Upseller (aguardando)" },
];

export type LinhaCanal = {
  canal: string;
  nome: string;
  fonte: string;
  pedidos: number;
  vendido: number;
  ticket: number | null;
  recebivel: number;
  tarifas: number;
  liquido: number;
  tarifaPct: number | null;
  temDados: boolean;
};

export function porCanal(dados: DadosIndicadores): LinhaCanal[] {
  const conhecidos = new Set(CANAIS.map((c) => c.canal));
  const extras = [...new Set([...dados.pedidos_mes, ...dados.canais_mes].map((x) => x.canal))].filter((c) => !conhecidos.has(c));
  return [...CANAIS, ...extras.map((c) => ({ canal: c, nome: c, fonte: "Contas a receber" }))].map((c) => {
    const pedidos = dados.pedidos_mes.filter((p) => p.canal === c.canal);
    const receber = dados.canais_mes.filter((r) => r.canal === c.canal);
    const qtd = somar(pedidos, (p) => p.entrada_qtd);
    const vendido = somar(pedidos, (p) => p.entrada_valor);
    const recebivel = somar(receber, (r) => r.bruto);
    const tarifas = somar(receber, (r) => r.tarifas);
    return {
      ...c,
      pedidos: qtd,
      vendido,
      ticket: qtd ? vendido / qtd : null,
      recebivel,
      tarifas,
      liquido: recebivel - tarifas,
      tarifaPct: recebivel ? tarifas / recebivel : null,
      temDados: qtd > 0 || recebivel > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Diagnóstico: onde está o problema. Cada ponto traz o número que o sustenta.
// ---------------------------------------------------------------------------

export type Gravidade = "critico" | "atencao" | "ok" | "sem_dados";
export type Area = "Produção" | "Vendas" | "Financeiro" | "Folha" | "Compras" | "Prazos";
export type PontoDiagnostico = { area: Area; titulo: string; texto: string; gravidade: Gravidade; aba: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dias = (d: number) => `${Math.round(d)} dia${Math.round(d) === 1 ? "" : "s"}`;
const ORDEM: Record<Gravidade, number> = { critico: 0, atencao: 1, ok: 2, sem_dados: 3 };

export type Contexto = {
  dados: DadosIndicadores;
  linhas: LinhaMes[];
  pe: PontoEquilibrio;
  prazos: Prazos;
};

export function diagnosticar({ dados, linhas, pe, prazos }: Contexto): PontoDiagnostico[] {
  const base = linhas.filter((l) => mesesDaMedia(linhas.map((x) => x.mes), dados.hoje).includes(l.mes));
  const lista: PontoDiagnostico[] = [];
  const add = (p: PontoDiagnostico) => lista.push(p);

  // 1. Produção dá conta do que se vende?
  const entrada = media(base, (l) => l.entradaPedidos) ?? 0;
  const saida = pe.saidaAtual ?? 0;
  if (entrada > 0 && saida > 0) {
    const r = saida / entrada;
    add({
      area: "Produção",
      titulo: r < 0.95 ? "A produção não acompanha as vendas" : "A produção acompanha as vendas",
      texto: `Entram ${moeda(entrada)} em pedidos por mês e saem da fábrica ${moeda(saida)} (${pct(r)} do que entra).${
        r < 0.95 ? ` A cada mês ficam ${moeda(entrada - saida)} a mais na fila.` : ""
      }`,
      gravidade: r < 0.8 ? "critico" : r < 0.95 ? "atencao" : "ok",
      aba: "producao",
    });
  } else {
    add({
      area: "Produção",
      titulo: "Produção × vendas",
      texto: "Sem pedidos ou saídas da fábrica no período para comparar.",
      gravidade: "sem_dados",
      aba: "producao",
    });
  }

  // 2. Carteira parada na fábrica (em meses de saída).
  const naFabrica = dados.pedidos_etapa.filter((e) => e.fase === "producao");
  const carteira = somar(naFabrica, (e) => e.valor);
  if (carteira > 0) {
    const meses = saida > 0 ? carteira / saida : null;
    const idade = razao(
      somar(naFabrica, (e) => n(e.idade_media) * e.qtd),
      somar(naFabrica, (e) => e.qtd),
    );
    add({
      area: "Produção",
      titulo: "Fila de pedidos na fábrica",
      texto: `${somar(naFabrica, (e) => e.qtd)} pedidos (${moeda(carteira)}) aprovados e ainda não saíram${
        meses !== null ? `: ${meses.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mês(es) de produção no ritmo atual` : ""
      }${idade !== null ? `; idade média ${dias(idade)}` : ""}.`,
      gravidade: meses === null ? "atencao" : meses > 1 ? "critico" : meses > 0.5 ? "atencao" : "ok",
      aba: "producao",
    });
  }

  // 3. Atrasos de entrega.
  const abertos = dados.pedidos_etapa;
  const atrasados = somar(abertos, (e) => e.atrasados);
  const totalAbertos = somar(abertos, (e) => e.qtd);
  if (totalAbertos > 0) {
    const r = atrasados / totalAbertos;
    add({
      area: "Produção",
      titulo: atrasados ? "Pedidos com entrega atrasada" : "Sem pedidos atrasados",
      texto: atrasados
        ? `${atrasados} de ${totalAbertos} pedidos em aberto (${pct(r)}) já passaram do prazo de entrega, somando ${moeda(
            somar(abertos, (e) => e.valor_atrasado),
          )}.`
        : "Nenhum pedido em aberto passou do prazo de entrega.",
      gravidade: r > 0.3 ? "critico" : r > 0.1 ? "atencao" : "ok",
      aba: "producao",
    });
  }

  // 4. Resultado do mês (receita − variáveis − fixos).
  const receita = pe.receita;
  const resultado = media(base, (l) => l.resultado);
  if (receita > 0 && resultado !== null) {
    add({
      area: "Financeiro",
      titulo: resultado < 0 ? "Custos e despesas acima da receita" : "Receita cobre custos e despesas",
      texto: `Média de ${base.length} mês(es): receita ${moeda(receita)}, custos variáveis ${moeda(pe.variaveis)}, despesas fixas ${moeda(
        pe.fixasSemFolha + (media(base, (l) => l.porClasse.folha) ?? 0),
      )}. Resultado ${moeda(resultado)} por mês.`,
      gravidade: resultado < 0 ? "critico" : resultado < receita * 0.05 ? "atencao" : "ok",
      aba: "financeiro",
    });
  } else {
    add({ area: "Financeiro", titulo: "Resultado do mês", texto: "Sem receitas lançadas no período.", gravidade: "sem_dados", aba: "financeiro" });
  }

  // 5. Ponto de equilíbrio com a folha da meta.
  if (pe.margem !== null && pe.margem <= 0) {
    add({
      area: "Vendas",
      titulo: "Margem negativa: cada venda dá prejuízo",
      texto: `Os custos variáveis (${moeda(pe.variaveis)}) passam da receita (${moeda(pe.receita)}). Não existe ponto de equilíbrio sem rever preço ou custo.`,
      gravidade: "critico",
      aba: "equilibrio",
    });
  } else if (pe.pontoAlvo !== null) {
    const falta = pe.falta ?? 0;
    add({
      area: "Vendas",
      titulo: `Ponto de equilíbrio com folha de ${moeda(pe.folhaAlvo)}`,
      texto: `Precisa faturar ${moeda(pe.pontoAlvo)} por mês (margem de contribuição ${pct(pe.margem ?? 0)}).${
        falta > 0 ? ` Hoje fatura ${moeda(pe.receita)}: faltam ${moeda(falta)} por mês.` : " A receita atual já passa desse ponto."
      }${
        pe.aumentoProducao !== null && pe.aumentoProducao > 0
          ? ` A fábrica precisa entregar ${pct(pe.aumentoProducao)} a mais do que entrega hoje.`
          : ""
      }`,
      gravidade: falta > 0 ? (falta > pe.pontoAlvo * 0.2 ? "critico" : "atencao") : "ok",
      aba: "equilibrio",
    });
  }

  // 6. Folha × faturamento.
  const folha = pe.folhaAtual;
  if (folha > 0 && receita > 0) {
    const r = folha / receita;
    add({
      area: "Folha",
      titulo: "Peso da folha no faturamento",
      texto: `A folha custa ${moeda(folha)} por mês, ${pct(r)} da receita (${pe.origemFolha === "holerites" ? "pelos holerites" : "pelo contas a pagar"}).`,
      gravidade: r > 0.35 ? "critico" : r > 0.2 ? "atencao" : "ok",
      aba: "folha",
    });
  } else {
    add({ area: "Folha", titulo: "Peso da folha no faturamento", texto: "Folha ainda não importada.", gravidade: "sem_dados", aba: "folha" });
  }

  // 7. Compras × receita.
  const compras = media(base, (l) => Math.max(l.comprasNf, l.comprasPedidos, l.porClasse.materia_prima));
  if (compras !== null && compras > 0 && receita > 0) {
    const r = compras / receita;
    add({
      area: "Compras",
      titulo: "Compras × receita",
      texto: `Compras de ${moeda(compras)} por mês, ${pct(r)} da receita.`,
      gravidade: r > 0.6 ? "critico" : r > 0.45 ? "atencao" : "ok",
      aba: "compras",
    });
  }

  // 8. Prazos: quem financia quem.
  if (prazos.ciclo !== null) {
    add({
      area: "Prazos",
      titulo: prazos.ciclo > 0 ? "A Venner financia os clientes" : "Prazos a favor da Venner",
      texto: `Recebe em ${dias(prazos.receber.condicao ?? prazos.receber.pelaMedia ?? 0)} e paga em ${dias(
        prazos.pagar.condicao ?? prazos.pagar.pelaMedia ?? 0,
      )}: ${prazos.ciclo > 0 ? `${dias(prazos.ciclo)} de caixa descoberto` : `${dias(-prazos.ciclo)} de folga`}.`,
      gravidade: prazos.ciclo > 30 ? "critico" : prazos.ciclo > 0 ? "atencao" : "ok",
      aba: "prazos",
    });
  }

  // 9. Inadimplência.
  if (prazos.receber.aberto > 0) {
    const r = prazos.receber.vencido / prazos.receber.aberto;
    add({
      area: "Financeiro",
      titulo: "Contas a receber vencidas",
      texto: `${moeda(prazos.receber.vencido)} vencidos, ${pct(r)} do que há para receber.`,
      gravidade: r > 0.2 ? "critico" : r > 0.08 ? "atencao" : "ok",
      aba: "financeiro",
    });
  }
  if (prazos.pagar.vencido > 0) {
    add({
      area: "Financeiro",
      titulo: "Contas a pagar vencidas",
      texto: `${moeda(prazos.pagar.vencido)} vencidos e ainda em aberto.`,
      gravidade: prazos.pagar.vencido > receita * 0.3 ? "critico" : "atencao",
      aba: "financeiro",
    });
  }

  return lista.sort((a, b) => ORDEM[a.gravidade] - ORDEM[b.gravidade]);
}

// Frase de abertura: a área com mais pontos críticos (empate: Produção).
export function ondeEstaOProblema(pontos: PontoDiagnostico[]): { area: Area | null; criticos: number } {
  const criticos = pontos.filter((p) => p.gravidade === "critico");
  if (!criticos.length) return { area: null, criticos: 0 };
  const conta = new Map<Area, number>();
  for (const p of criticos) conta.set(p.area, (conta.get(p.area) ?? 0) + 1);
  const area = [...conta.entries()].sort((a, b) => b[1] - a[1] || (a[0] === "Produção" ? -1 : b[0] === "Produção" ? 1 : 0))[0][0];
  return { area, criticos: criticos.length };
}
