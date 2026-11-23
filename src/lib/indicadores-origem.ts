// Origem dos números da tela de Indicadores (pedido do Alexandre em
// 23/11/2026): cada número abre a composição (por categoria/grupo e por mês)
// e os lançamentos que o formam. Aqui ficam as regras puras: que chave abre
// o quê, como somar a composição e que filtro mandar para o banco
// (indicadores_origem). A tela só desenha.

import {
  CLASSES_FIXAS,
  CLASSES_VARIAVEIS,
  CANAIS,
  FAIXAS,
  NOME_CLASSE,
  rotuloMes,
  type AjudaCusto,
  type BeneficioMes,
  type Categoria,
  type Classe,
  type DadosIndicadores,
  type FaixaAberto,
  type FolhaMes,
  type LinhaMes,
  type PontoEquilibrio,
  type TipoTitulo,
} from "./indicadores.ts";

// Filtro mandado para indicadores_origem (banco) ou lido direto das tabelas
// da folha (holerites e benefícios).
export type FiltroOrigem =
  | {
      fonte: "titulos";
      tipo?: TipoTitulo;
      base?: "vencimento" | "baixa" | "aberto";
      categorias?: string[];
      sem_categoria?: boolean;
      excluir_categorias?: string[];
      pessoa?: string;
      faixa?: FaixaAberto;
      canal?: string;
      ajuda?: boolean;
    }
  | { fonte: "pedidos"; modo: "entrada" | "saida" | "etapa"; etapa?: string; fase?: string; atrasados?: boolean; canal?: string }
  | { fonte: "compras" }
  | { fonte: "notas"; tipo_nota: "S" | "E" }
  | { fonte: "folha"; partes: ("holerites" | "vt" | "va" | "ajuda")[] };

// Uma linha da composição: um valor por mês (soma das linhas = número da tela).
export type LinhaComposicao = {
  rotulo: string;
  grupo?: string;
  porMes: Record<string, number>;
  // Filtro que restringe os lançamentos a esta linha (ex.: uma categoria).
  sub?: string;
  nota?: string;
};

// Um termo de uma conta (para números calculados: margem, ponto...).
export type Termo = { sinal: "" | "+" | "−" | "÷" | "×" | "="; rotulo: string; valor: number | null; formato?: "moeda" | "pct" | "numero"; origem?: string };

export type Origem = {
  chave: string;
  titulo: string;
  explicacao: string;
  // Meses que o número usa (vazio = posição de hoje, sem mês).
  meses: string[];
  // O número é média mensal (divide o total pelos meses).
  media: boolean;
  // Meses que entram na média, quando nem todos têm o dado (folha: só os
  // meses com holerite, como na tela).
  divisor?: number;
  composicao: LinhaComposicao[] | null;
  calculo: Termo[] | null;
  filtro: FiltroOrigem | null;
  // Linha da composição escolhida (os lançamentos mostram só ela).
  sub?: string;
  // Tela do sistema onde estão os registros (abre em outra tela).
  abrirEm?: { rotulo: string; href: string };
};

export type ContextoOrigem = {
  dados: DadosIndicadores;
  linhas: LinhaMes[];
  mesesMedia: string[];
  classes: Map<string, Classe>;
  categorias: Categoria[];
  folha: FolhaMes[] | null;
  beneficios: BeneficioMes[];
  ajuda: AjudaCusto[];
  pe: PontoEquilibrio;
  folhaAlvo: number;
};

const n = (v: number | null | undefined) => Number(v ?? 0) || 0;
const somaMes = (l: LinhaComposicao[], mes: string) => l.reduce((s, x) => s + n(x.porMes[mes]), 0);

export function totalDaComposicao(linhas: LinhaComposicao[], meses: string[]): number {
  return meses.reduce((s, m) => s + somaMes(linhas, m), 0);
}

// Conjuntos de classes que cada linha da tela soma.
export const GRUPOS_CLASSE: Record<string, { nome: string; classes: Classe[] }> = {
  variaveis: { nome: "Custos variáveis", classes: CLASSES_VARIAVEIS },
  fixas: { nome: "Despesas fixas (com a folha do contas a pagar)", classes: CLASSES_FIXAS },
  fixas_sem_folha: { nome: "Despesas fixas sem folha", classes: ["fixa", "financeiro"] },
  total_pagar: { nome: "Total a pagar", classes: [...CLASSES_VARIAVEIS, ...CLASSES_FIXAS, "investimento"] },
};

function idsDasClasses(classes: Map<string, Classe>, conjunto: Classe[]): string[] {
  return [...classes.entries()].filter(([, c]) => conjunto.includes(c)).map(([id]) => id);
}

// Composição por categoria a partir das somas por mês e categoria que a tela
// já tem (titulos_mes). Mesma regra de montarMeses: a pagar sem categoria
// conta como despesa fixa; ajuda de custo de outra categoria vai para a folha.
export function composicaoTitulos(
  ctx: ContextoOrigem,
  tipo: TipoTitulo,
  conjunto: Classe[] | "receita",
  base: "previsto" | "realizado",
  meses: string[],
): LinhaComposicao[] {
  const nomes = new Map(ctx.categorias.map((c) => [c.id, c.nome]));
  const porCat = new Map<string, LinhaComposicao>();
  for (const t of ctx.dados.titulos_mes) {
    if (t.tipo !== tipo || !meses.includes(t.mes)) continue;
    const classe = t.categoria_id ? ctx.classes.get(t.categoria_id) : undefined;
    const entra =
      conjunto === "receita"
        ? classe !== "transferencia"
        : base === "realizado" && conjunto.length === 0
          ? classe !== "transferencia"
          : conjunto.includes(classe ?? "fixa");
    if (!entra) continue;
    const chave = t.categoria_id ?? "sem";
    const linha = porCat.get(chave) ?? {
      rotulo: t.categoria_id ? (nomes.get(t.categoria_id) ?? "Categoria fora do plano") : "Sem categoria no Tiny",
      grupo: conjunto === "receita" ? undefined : t.categoria_id ? NOME_CLASSE[classe ?? "fixa"] : NOME_CLASSE.fixa,
      porMes: {},
      sub: chave,
    };
    linha.porMes[t.mes] = n(linha.porMes[t.mes]) + n(base === "previsto" ? t.previsto : t.realizado);
    porCat.set(chave, linha);
  }
  const lista = [...porCat.values()].filter((l) => Object.values(l.porMes).some((v) => v !== 0));
  // Ajuda de custo lançada em outra categoria: sai da classe dela e entra na folha.
  if (tipo === "pagar" && base === "previsto" && conjunto !== "receita") {
    const ajuste: Record<string, number> = {};
    for (const a of ctx.ajuda) {
      if (!meses.includes(a.mes)) continue;
      const classe = a.categoria_id ? (ctx.classes.get(a.categoria_id) ?? "fixa") : "fixa";
      if (classe === "folha" || classe === "transferencia") continue;
      const sai = conjunto.includes(classe);
      const entra = conjunto.includes("folha");
      if (sai === entra) continue;
      ajuste[a.mes] = n(ajuste[a.mes]) + (entra ? 1 : -1) * n(a.valor);
    }
    if (Object.keys(ajuste).length) {
      lista.push({
        rotulo: conjunto.includes("folha") ? "Ajuda de custo de outras categorias (vai para a folha)" : "Ajuda de custo (sai daqui e vai para a folha)",
        grupo: NOME_CLASSE.folha,
        porMes: ajuste,
        sub: "ajuda",
        nota: "Lançamentos com \"ajuda de custo\" na descrição ou na categoria.",
      });
    }
  }
  const total = (l: LinhaComposicao) => meses.reduce((s, m) => s + n(l.porMes[m]), 0);
  return lista.sort((a, b) => Math.abs(total(b)) - Math.abs(total(a)));
}

// Filtro dos lançamentos de uma composição de títulos (com a linha escolhida).
function filtroTitulos(
  ctx: ContextoOrigem,
  tipo: TipoTitulo,
  conjunto: Classe[] | "receita",
  base: "vencimento" | "baixa",
  sub: string | undefined,
): FiltroOrigem {
  if (sub === "ajuda") return { fonte: "titulos", tipo: "pagar", base, ajuda: true };
  if (sub) return sub === "sem" ? { fonte: "titulos", tipo, base, categorias: [], sem_categoria: true } : { fonte: "titulos", tipo, base, categorias: [sub] };
  const transf = idsDasClasses(ctx.classes, ["transferencia"]);
  if (conjunto === "receita" || conjunto.length === 0) return { fonte: "titulos", tipo, base, excluir_categorias: transf };
  return { fonte: "titulos", tipo, base, categorias: idsDasClasses(ctx.classes, conjunto), sem_categoria: conjunto.includes("fixa") };
}

const SETORES: Record<string, string> = {
  producao: "Produção",
  logistica: "Logística",
  comercial: "Comercial",
  administrativo: "Administrativo",
  sem_setor: "Sem setor",
};

function composicaoFolha(ctx: ContextoOrigem, meses: string[]): LinhaComposicao[] {
  const lista: LinhaComposicao[] = [];
  for (const [setor, nome] of Object.entries(SETORES)) {
    const porMes: Record<string, number> = {};
    for (const f of ctx.folha ?? []) if (f.setor === setor && meses.includes(f.competencia.slice(0, 7))) porMes[f.competencia.slice(0, 7)] = n(porMes[f.competencia.slice(0, 7)]) + n(f.custo);
    if (Object.keys(porMes).length) lista.push({ rotulo: `Holerites · ${nome}`, grupo: "Holerites (proventos + FGTS)", porMes, sub: "holerites" });
  }
  // Benefícios e ajuda só entram no custo dos meses com holerite.
  const comHolerite = new Set(ctx.linhas.filter((l) => l.folhaHolerite !== null).map((l) => l.mes));
  const ben = (tipo: "vt" | "va") => {
    const porMes: Record<string, number> = {};
    for (const b of ctx.beneficios)
      if ((tipo === "vt" ? b.tipo === "vt" : b.tipo !== "vt") && meses.includes(b.competencia.slice(0, 7)) && comHolerite.has(b.competencia.slice(0, 7)))
        porMes[b.competencia.slice(0, 7)] = n(porMes[b.competencia.slice(0, 7)]) + n(b.valor);
    return porMes;
  };
  const vt = ben("vt");
  if (Object.keys(vt).length) lista.push({ rotulo: "Vale-transporte (fora do holerite)", porMes: vt, sub: "vt" });
  const va = ben("va");
  if (Object.keys(va).length) lista.push({ rotulo: "Auxílio-alimentação", porMes: va, sub: "va" });
  const aj: Record<string, number> = {};
  for (const a of ctx.ajuda) if (meses.includes(a.mes) && comHolerite.has(a.mes)) aj[a.mes] = n(aj[a.mes]) + n(a.valor);
  if (Object.keys(aj).length) lista.push({ rotulo: "Ajuda de custo (contas a pagar)", porMes: aj, sub: "ajuda" });
  return lista;
}

const MOEDA = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Lê a chave da origem (parâmetro ?origem= da tela) e monta o que o painel
// mostra. `mes` escolhe um mês; "media" usa os meses da média; vazio = período.
export function descreverOrigem(chave: string, ctx: ContextoOrigem, mes: string | undefined, subEscolhida: string | undefined): Origem | null {
  const todos = ctx.linhas.map((l) => l.mes);
  const usaMedia = mes === "media";
  const meses = mes && mes !== "media" ? (todos.includes(mes) ? [mes] : []) : usaMedia ? ctx.mesesMedia : todos;
  const periodo = usaMedia ? `média de ${meses.length} mês(es) fechado(s): ${meses.map(rotuloMes).join(", ")}` : meses.map(rotuloMes).join(", ");
  const [tipoChave, a, b] = chave.split(":");
  // A chave pode já trazer a linha (ex.: "folha::vt").
  const sub = subEscolhida ?? (tipoChave === "folha" && b ? b : undefined);
  const base = { chave, meses, media: usaMedia, composicao: null, calculo: null, filtro: null, sub } as const;
  const pagarEm = { rotulo: "Abrir no contas a pagar", href: `/financeiro/pagar?de=${primeiroDia(meses)}&ate=${ultimoDia(meses)}&por=vencimento&situacao=` };
  const receberEm = { rotulo: "Abrir no contas a receber", href: `/financeiro/receber?de=${primeiroDia(meses)}&ate=${ultimoDia(meses)}&por=vencimento&situacao=` };

  switch (tipoChave) {
    case "receita": {
      if (ctx.pe.baseReceita === "notas" && usaMedia) return descreverOrigem("notas:S", ctx, mes, subEscolhida);
      return {
        ...base,
        titulo: "Receita (contas a receber)",
        explicacao: `Contas a receber pelo vencimento, sem cancelados e sem transferências entre contas · ${periodo}.`,
        composicao: composicaoTitulos(ctx, "receber", "receita", "previsto", meses),
        filtro: filtroTitulos(ctx, "receber", "receita", "vencimento", sub),
        abrirEm: receberEm,
      };
    }
    case "classe":
    case "grupo": {
      const conjunto = tipoChave === "classe" ? [a as Classe] : GRUPOS_CLASSE[a]?.classes;
      if (!conjunto) return null;
      const nome = tipoChave === "classe" ? NOME_CLASSE[a as Classe] : GRUPOS_CLASSE[a].nome;
      return {
        ...base,
        titulo: nome,
        explicacao: `Contas a pagar pelo vencimento, sem cancelados, das categorias do Tiny agrupadas em: ${conjunto.map((c) => NOME_CLASSE[c]).join("; ")}${conjunto.includes("fixa") ? " (a pagar sem categoria entra aqui)" : ""} · ${periodo}.`,
        composicao: composicaoTitulos(ctx, "pagar", conjunto, "previsto", meses),
        filtro: filtroTitulos(ctx, "pagar", conjunto, "vencimento", sub),
        abrirEm: pagarEm,
      };
    }
    case "caixa": {
      const tipo: TipoTitulo = a === "pago" ? "pagar" : "receber";
      return {
        ...base,
        titulo: a === "pago" ? "Pago (caixa)" : "Recebido (caixa)",
        explicacao: `${a === "pago" ? "Contas pagas" : "Contas recebidas"} pela data da baixa no Tiny, sem transferências entre contas · ${periodo}.`,
        composicao: composicaoTitulos(ctx, tipo, tipo === "receber" ? "receita" : [], "realizado", meses),
        filtro: filtroTitulos(ctx, tipo, tipo === "receber" ? "receita" : [], "baixa", sub),
        abrirEm: tipo === "pagar" ? pagarEm : receberEm,
      };
    }
    case "aberto": {
      const tipo = a as TipoTitulo;
      const faixa = FAIXAS.find((f) => f.faixa === b);
      return {
        ...base,
        meses: [],
        titulo: `Em aberto a ${tipo === "pagar" ? "pagar" : "receber"}${faixa ? ` · ${faixa.rotulo}` : ""}`,
        explicacao: `Títulos em aberto hoje${faixa ? `, ${faixa.rotulo.toLowerCase()}` : ""}. A receber pelo valor líquido (bruto − comissões e fretes das plataformas).`,
        filtro: { fonte: "titulos", tipo, base: "aberto", faixa: faixa?.faixa },
      };
    }
    case "pessoa": {
      const tipo = a as TipoTitulo;
      const p = ctx.dados.pessoas.find((x) => x.tipo === tipo && (x.pessoa_id ?? "sem") === b);
      return {
        ...base,
        titulo: `${tipo === "receber" ? "Cliente" : "Fornecedor"}: ${p?.nome ?? "—"}`,
        explicacao: `Títulos com vencimento no período, sem cancelados · ${periodo}.`,
        filtro: { fonte: "titulos", tipo, pessoa: b },
      };
    }
    case "canal": {
      const nome = CANAIS.find((c) => c.canal === a)?.nome ?? a;
      return {
        ...base,
        titulo: `Pedidos do canal ${nome}`,
        explicacao: `Pedidos de venda pela data do pedido, sem cancelados · ${periodo}.`,
        composicao: [{ rotulo: nome, porMes: Object.fromEntries(ctx.dados.pedidos_mes.filter((p) => p.canal === a).map((p) => [p.mes, n(p.entrada_valor)])) }],
        filtro: { fonte: "pedidos", modo: "entrada", canal: a },
      };
    }
    case "ajuda":
      return {
        ...base,
        titulo: "Ajuda de custo (contas a pagar)",
        explicacao: `Contas a pagar com "ajuda de custo" na descrição ou no nome da categoria, pelo vencimento · ${periodo}.`,
        composicao: [{ rotulo: "Ajuda de custo", porMes: Object.fromEntries(meses.map((m) => [m, ctx.ajuda.filter((x) => x.mes === m).reduce((s, x) => s + n(x.valor), 0)])) }],
        filtro: { fonte: "titulos", tipo: "pagar", ajuda: true },
        abrirEm: pagarEm,
      };
    case "pedidos": {
      const saida = a === "saida";
      const porCanal = new Map<string, Record<string, number>>();
      for (const p of ctx.dados.pedidos_mes) {
        if (!meses.includes(p.mes)) continue;
        const r = porCanal.get(p.canal) ?? {};
        r[p.mes] = n(r[p.mes]) + n(saida ? p.saida_valor : p.entrada_valor);
        porCanal.set(p.canal, r);
      }
      return {
        ...base,
        titulo: saida ? "Pedidos que saíram da fábrica" : "Pedidos que entraram",
        explicacao: saida
          ? `Pedidos pela data de faturamento do Tiny (sem ela, o dia em que passaram para expedição aqui) · ${periodo}.`
          : `Pedidos de venda do Tiny pela data do pedido, sem cancelados · ${periodo}.`,
        composicao: [...porCanal.entries()].map(([canal, porMes]) => ({ rotulo: CANAIS.find((c) => c.canal === canal)?.nome ?? canal, porMes })),
        filtro: { fonte: "pedidos", modo: saida ? "saida" : "entrada" },
        abrirEm: { rotulo: "Abrir nos pedidos de venda", href: "/vendas/pedidos" },
      };
    }
    case "etapa": {
      const e = ctx.dados.pedidos_etapa.find((x) => x.etapa_id === a);
      const fila = a === "fila";
      return {
        ...base,
        meses: [],
        titulo: fila ? "Fila na fábrica" : `Pedidos em ${e?.nome ?? "—"}${b === "atrasados" ? " (atrasados)" : ""}`,
        explicacao: fila
          ? "Pedidos aprovados no Tiny que ainda não foram faturados (fase produção), hoje."
          : `Pedidos que estão hoje nesta situação do Tiny${b === "atrasados" ? ", com o prazo de entrega vencido" : ""}.`,
        filtro: fila ? { fonte: "pedidos", modo: "etapa", fase: "producao" } : { fonte: "pedidos", modo: "etapa", etapa: a, atrasados: b === "atrasados" },
        abrirEm: { rotulo: "Abrir nos pedidos de venda", href: fila ? "/vendas/pedidos" : `/vendas/pedidos?etapa=${a}` },
      };
    }
    case "compras":
      return {
        ...base,
        titulo: "Ordens de compra (Tiny)",
        explicacao: `Ordens de compra pela data, sem canceladas · ${periodo}.`,
        composicao: [{ rotulo: "Ordens de compra", porMes: Object.fromEntries(ctx.dados.compras_mes.map((c) => [c.mes, n(c.valor)])) }],
        filtro: { fonte: "compras" },
        abrirEm: { rotulo: "Abrir nas ordens de compra", href: "/compras/pedidos" },
      };
    case "notas": {
      const t = a === "E" ? "E" : "S";
      return {
        ...base,
        titulo: t === "S" ? "Notas fiscais de saída (Tiny)" : "Notas fiscais de entrada (Tiny)",
        explicacao: `Notas emitidas/autorizadas no Tiny (sem canceladas nem denegadas), pela data de emissão · ${periodo}.`,
        composicao: [{ rotulo: t === "S" ? "NF de saída" : "NF de entrada", porMes: Object.fromEntries(ctx.dados.notas_mes.filter((x) => x.tipo === t).map((x) => [x.mes, n(x.valor)])) }],
        filtro: { fonte: "notas", tipo_nota: t },
      };
    }
    case "folha": {
      if (!ctx.linhas.some((l) => l.folhaHolerite !== null)) return descreverOrigem("classe:folha", ctx, mes, subEscolhida);
      const todas = ["holerites", "vt", "va", "ajuda"] as const;
      const partes = todas.filter((p) => !sub || !todas.includes(sub as (typeof todas)[number]) || p === sub);
      return {
        ...base,
        titulo: "Custo total da folha",
        explicacao: `Holerites (proventos + FGTS do holerite mensal) + vale-transporte + auxílio-alimentação + ajuda de custo do contas a pagar, nos meses com holerite · ${periodo}.`,
        composicao: composicaoFolha(ctx, meses),
        divisor: ctx.linhas.filter((l) => meses.includes(l.mes) && l.folhaHolerite !== null).length,
        filtro: { fonte: "folha", partes: [...partes] },
        abrirEm: { rotulo: "Abrir VT e alimentação", href: "/rh/funcionarios/beneficios" },
      };
    }
    case "calc":
      return calculo(a, ctx, base, periodo);
  }
  return null;
}

function calculo(qual: string, ctx: ContextoOrigem, base: Pick<Origem, "chave" | "meses" | "media" | "sub">, periodo: string): Origem | null {
  const { pe } = ctx;
  const folhaChave = pe.origemFolha === "holerites" ? "folha" : "classe:folha";
  const receitaChave = pe.baseReceita === "notas" ? "notas:S" : "receita";
  const margemRs = pe.receita - pe.variaveis;
  const comum = { ...base, media: true, composicao: null, filtro: null };
  switch (qual) {
    case "margem":
      return {
        ...comum,
        titulo: "Margem de contribuição",
        explicacao: `Quanto sobra de cada R$ 1 vendido para pagar os fixos · ${periodo}.`,
        calculo: [
          { sinal: "", rotulo: "Receita média", valor: pe.receita, origem: receitaChave },
          { sinal: "−", rotulo: "Custos variáveis", valor: pe.variaveis, origem: "grupo:variaveis" },
          { sinal: "=", rotulo: "Margem em R$", valor: margemRs },
          { sinal: "÷", rotulo: "Receita média", valor: pe.receita, origem: receitaChave },
          { sinal: "=", rotulo: "Margem de contribuição", valor: pe.margem, formato: "pct" },
        ],
      };
    case "fixos":
    case "fixos_alvo":
    case "ponto":
    case "ponto_alvo": {
      const alvo = qual.endsWith("_alvo");
      const comPonto = qual.startsWith("ponto");
      const folha = alvo ? pe.folhaAlvo : pe.folhaAtual;
      const termos: Termo[] = [
        { sinal: "", rotulo: "Despesas fixas sem folha", valor: pe.fixasSemFolha, origem: "grupo:fixas_sem_folha" },
        { sinal: "+", rotulo: alvo ? "Folha da meta (simulador)" : "Folha", valor: folha, origem: alvo ? undefined : folhaChave },
        { sinal: "=", rotulo: "Total de fixos", valor: pe.fixasSemFolha + folha },
      ];
      if (comPonto)
        termos.push(
          { sinal: "÷", rotulo: "Margem de contribuição", valor: pe.margem, formato: "pct", origem: "calc:margem" },
          { sinal: "=", rotulo: "Ponto de equilíbrio", valor: alvo ? pe.pontoAlvo : pe.pontoAtual },
        );
      return {
        ...comum,
        titulo: !comPonto ? `Total de fixos${alvo ? ` com folha de ${MOEDA(pe.folhaAlvo)}` : ""}` : `Ponto de equilíbrio${alvo ? ` com folha de ${MOEDA(pe.folhaAlvo)}` : ""}`,
        explicacao: `Faturamento mínimo por mês para pagar variáveis e fixos: fixos ÷ margem · ${periodo}.`,
        calculo: termos,
      };
    }
    case "pedidos":
    case "pedidos_alvo": {
      const ponto = qual === "pedidos_alvo" ? pe.pontoAlvo : pe.pontoAtual;
      return {
        ...comum,
        titulo: "Pedidos por mês necessários",
        explicacao: `Ponto de equilíbrio ÷ pedido médio do período (valor dos pedidos novos ÷ quantidade) · ${periodo}.`,
        calculo: [
          { sinal: "", rotulo: "Ponto de equilíbrio", valor: ponto, origem: qual === "pedidos_alvo" ? "calc:ponto_alvo" : "calc:ponto" },
          { sinal: "÷", rotulo: "Pedido médio", valor: pe.ticketMedio, origem: "pedidos:entrada" },
          { sinal: "=", rotulo: "Pedidos por mês", valor: ponto !== null && pe.ticketMedio ? ponto / pe.ticketMedio : null, formato: "numero" },
        ],
      };
    }
    case "producao":
    case "producao_alvo": {
      const ponto = qual === "producao_alvo" ? pe.pontoAlvo : pe.pontoAtual;
      return {
        ...comum,
        titulo: "Produção necessária × saída atual",
        explicacao: `Ponto de equilíbrio ÷ o que sai da fábrica por mês hoje. Acima de 100% = precisa produzir mais do que produz · ${periodo}.`,
        calculo: [
          { sinal: "", rotulo: "Ponto de equilíbrio", valor: ponto, origem: qual === "producao_alvo" ? "calc:ponto_alvo" : "calc:ponto" },
          { sinal: "÷", rotulo: "Saída da fábrica por mês", valor: pe.saidaAtual, origem: "pedidos:saida" },
          { sinal: "=", rotulo: "Produção necessária", valor: ponto !== null && pe.saidaAtual ? ponto / pe.saidaAtual : null, formato: "pct" },
        ],
      };
    }
    case "falta":
    case "falta_alvo": {
      const ponto = qual === "falta_alvo" ? pe.pontoAlvo : pe.pontoAtual;
      return {
        ...comum,
        titulo: "Falta faturar por mês",
        explicacao: `Ponto de equilíbrio − receita média (zero quando a receita já cobre) · ${periodo}.`,
        calculo: [
          { sinal: "", rotulo: "Ponto de equilíbrio", valor: ponto, origem: qual === "falta_alvo" ? "calc:ponto_alvo" : "calc:ponto" },
          { sinal: "−", rotulo: "Receita média", valor: pe.receita, origem: receitaChave },
          { sinal: "=", rotulo: "Falta faturar", valor: ponto !== null ? Math.max(0, ponto - pe.receita) : null },
        ],
      };
    }
    case "resultado": {
      const media = (f: (l: LinhaMes) => number) => {
        const b = ctx.linhas.filter((l) => ctx.mesesMedia.includes(l.mes));
        return b.length ? b.reduce((s, l) => s + f(l), 0) / b.length : null;
      };
      return {
        ...comum,
        titulo: "Resultado médio por mês",
        explicacao: `Receita − custos variáveis − despesas fixas (com a folha do contas a pagar), pelo vencimento; sem investimentos e transferências · ${periodo}.`,
        calculo: [
          { sinal: "", rotulo: "Receita", valor: media((l) => l.receita), origem: "receita" },
          { sinal: "−", rotulo: "Custos variáveis", valor: media((l) => l.variaveis), origem: "grupo:variaveis" },
          { sinal: "−", rotulo: "Despesas fixas", valor: media((l) => l.fixas), origem: "grupo:fixas" },
          { sinal: "=", rotulo: "Resultado", valor: media((l) => l.resultado) },
        ],
      };
    }
  }
  return null;
}

function primeiroDia(meses: string[]) {
  return meses.length ? `${[...meses].sort()[0]}-01` : "";
}
function ultimoDia(meses: string[]) {
  if (!meses.length) return "";
  const m = [...meses].sort().at(-1)!;
  const [a, mm] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(a, mm, 0)).getUTCDate()).padStart(2, "0")}`;
}

// Período (de, até) que vai para o banco: do 1º ao último dia dos meses.
export function periodoDaOrigem(o: Origem, de: string, ate: string): { de: string; ate: string } {
  return o.meses.length ? { de: primeiroDia(o.meses), ate: ultimoDia(o.meses) } : { de, ate };
}
