// Fluxo de caixa no modelo da Drogarema: dias (ou meses) nas colunas,
// entradas e saídas por grupo de categoria nas linhas (abrem nas categorias),
// e o saldo das contas no fim. Até ontem é o realizado (pagos e recebidos);
// de hoje em diante, o previsto (títulos em aberto pelo vencimento, levados ao
// dia útil seguinte, atrasados em "hoje" e previsões digitadas).
// Sem dependências do Next, para rodar também nos testes (node --test).
import { somarDias } from "./datas.ts";
import { feriado, fimDeSemana, proximoDiaUtil } from "./feriados.ts";

export type Natureza = "realizado" | "previsto" | "atrasado" | "manual" | "transferencia";

// Uma linha da função fluxo_caixa do banco.
export type MovimentoFluxo = {
  data: string;
  tipo: "entrada" | "saida";
  natureza: Natureza;
  categoria_id: string | null;
  conta_bancaria_id: string | null;
  empresa_id: string;
  valor: number;
  titulos: number;
};

// Uma linha da função fluxo_caixa_saldos: saldo no começo de data_saldo.
export type SaldoConta = { conta_bancaria_id: string; empresa_id: string; nome: string; data_saldo: string; saldo: number };

export type CategoriaFluxo = { id: string; codigo: string; nome: string; pai_id: string | null };

export type Coluna = {
  id: string;
  titulo: string;
  de: string;
  ate: string;
  hoje: boolean;
  // Coluna inteira no futuro (de hoje em diante).
  previsto: boolean;
  fds: boolean;
  feriado: string | null;
};

export type TipoLinha = "secao" | "grupo" | "categoria" | "manual" | "total" | "resultado" | "conta" | "info" | "saldo";

// O que a célula soma, para abrir os títulos dela.
export type Rastreio = { tipo: "entrada" | "saida"; categorias: string[] | null; semCategoria: boolean };

export type LinhaFluxo = {
  chave: string;
  tipo: TipoLinha;
  rotulo: string;
  valores: (number | null)[];
  total: number | null;
  // Linha que só aparece com o grupo aberto.
  pai?: string;
  rastreio?: Rastreio;
  // Linha de previsão digitada (entrada ou saída).
  editavel?: "entrada" | "saida";
  dica?: string;
  // Mesmo item no período anterior (mês anterior ou 12 meses anteriores), para comparar.
  anterior?: number | null;
};

export type Resumo = {
  saldoHoje: number | null;
  menorSaldo: { valor: number; data: string } | null;
  entradasPrevistas: number;
  saidasPrevistas: number;
  atrasadoReceber: number;
  atrasadoPagar: number;
};

export type Fluxo = { colunas: Coluna[]; linhas: LinhaFluxo[]; resumo: Resumo; previsoes: Record<string, number> };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const arred2 = (n: number) => Math.round(n * 100) / 100;

// Dia em que o movimento aparece no fluxo.
export function dataNoFluxo(m: { data: string; natureza: Natureza }, hoje: string): string {
  if (m.natureza === "atrasado") return hoje;
  if (m.natureza === "previsto") {
    const util = proximoDiaUtil(m.data);
    return util < hoje ? hoje : util;
  }
  return m.data;
}

export function ultimoDiaMes(iso: string): string {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export function somarMeses(iso: string, n: number): string {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}

export function montarColunas(modo: "dia" | "mes", de: string, ate: string, hoje: string): Coluna[] {
  const colunas: Coluna[] = [];
  if (modo === "dia") {
    for (let d = de; d <= ate; d = somarDias(d, 1)) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      colunas.push({
        id: d,
        titulo: `${SEMANA[dow]} ${d.slice(8)}`,
        de: d,
        ate: d,
        hoje: d === hoje,
        previsto: d >= hoje,
        fds: fimDeSemana(d) || !!feriado(d),
        feriado: feriado(d),
      });
    }
  } else {
    for (let m = de.slice(0, 8) + "01"; m <= ate; m = somarMeses(m, 1)) {
      const fim = ultimoDiaMes(m);
      colunas.push({
        id: m.slice(0, 7),
        titulo: `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`,
        de: m,
        ate: fim,
        hoje: hoje >= m && hoje <= fim,
        previsto: m > hoje,
        fds: false,
        feriado: null,
      });
    }
  }
  return colunas;
}

export function montarFluxo(e: {
  modo: "dia" | "mes";
  de: string;
  ate: string;
  hoje: string;
  movimentos: MovimentoFluxo[];
  saldos: SaldoConta[];
  categorias: CategoriaFluxo[];
  // Movimentos do período anterior, só para a coluna de comparação.
  anteriores?: MovimentoFluxo[];
}): Fluxo {
  const { de, ate, hoje } = e;
  const colunas = montarColunas(e.modo, de, ate, hoje);
  const indice = (dia: string) => colunas.findIndex((c) => dia >= c.de && dia <= c.ate);
  const n = colunas.length;
  const zeros = () => Array<number>(n).fill(0);

  // Grupo = categoria raiz da árvore.
  const porId = new Map(e.categorias.map((c) => [c.id, c]));
  const raiz = (id: string) => {
    let c = porId.get(id);
    while (c?.pai_id && porId.has(c.pai_id)) c = porId.get(c.pai_id);
    return c;
  };

  type Acum = { grupos: Map<string, { valores: number[]; cats: Map<string, number[]> }>; sem: number[]; manual: number[] };
  const lado = (): Acum => ({ grupos: new Map(), sem: zeros(), manual: zeros() });
  const ent = lado();
  const sai = lado();
  const previsoes: Record<string, number> = {};
  const movDia = new Map<string, MovimentoFluxo[]>();
  let atrasadoReceber = 0;
  let atrasadoPagar = 0;

  for (const m of e.movimentos) {
    const valor = Number(m.valor);
    const dia = dataNoFluxo(m, hoje);
    if (m.natureza === "atrasado") {
      if (m.tipo === "entrada") atrasadoReceber += valor;
      else atrasadoPagar += valor;
    }
    if (dia < de || dia > ate) continue;
    movDia.set(dia, [...(movDia.get(dia) ?? []), m]);
    if (m.natureza === "transferencia") continue;
    const k = indice(dia);
    if (k < 0) continue;
    const a = m.tipo === "entrada" ? ent : sai;
    if (m.natureza === "manual") {
      a.manual[k] += valor;
      previsoes[`${m.tipo}|${m.data}`] = (previsoes[`${m.tipo}|${m.data}`] ?? 0) + valor;
      continue;
    }
    const r = m.categoria_id ? raiz(m.categoria_id) : undefined;
    if (!r || !m.categoria_id) {
      a.sem[k] += valor;
      continue;
    }
    const g = a.grupos.get(r.id) ?? { valores: zeros(), cats: new Map<string, number[]>() };
    g.valores[k] += valor;
    const c = g.cats.get(m.categoria_id) ?? zeros();
    c[k] += valor;
    g.cats.set(m.categoria_id, c);
    a.grupos.set(r.id, g);
  }

  // Saldo dia a dia: contas pelo realizado; de hoje em diante soma o previsto.
  const contas = e.saldos.map((s) => ({ ...s, atual: null as number | null }));
  const saldoContaCol = contas.map(() => Array<number | null>(n).fill(null));
  const saldoTotalCol = Array<number | null>(n).fill(null);
  const transfCol = zeros();
  let projetado = 0;
  let menorSaldo: Resumo["menorSaldo"] = null;
  let saldoHoje: number | null = null;
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    const k = indice(d);
    const movs = movDia.get(d) ?? [];
    for (const c of contas) {
      if (d === c.data_saldo) c.atual = Number(c.saldo);
      if (c.atual === null) continue;
      for (const m of movs) {
        if (m.conta_bancaria_id !== c.conta_bancaria_id) continue;
        if (m.natureza !== "realizado" && m.natureza !== "transferencia") continue;
        c.atual += m.tipo === "entrada" ? Number(m.valor) : -Number(m.valor);
      }
    }
    for (const m of movs) if (m.natureza === "transferencia" && k >= 0) transfCol[k] += m.tipo === "entrada" ? Number(m.valor) : -Number(m.valor);
    if (d >= hoje) {
      for (const m of movs) {
        if (m.natureza === "previsto" || m.natureza === "atrasado" || m.natureza === "manual")
          projetado += m.tipo === "entrada" ? Number(m.valor) : -Number(m.valor);
      }
    }
    const conhecidas = contas.filter((c) => c.atual !== null);
    const total = conhecidas.length ? arred2(conhecidas.reduce((s, c) => s + c.atual!, 0) + projetado) : null;
    if (k >= 0) {
      contas.forEach((c, i) => {
        if (d <= hoje || c.atual === null) saldoContaCol[i][k] = c.atual === null ? null : arred2(c.atual);
      });
      saldoTotalCol[k] = total;
    }
    if (d === hoje) saldoHoje = total;
    if (d >= hoje && total !== null && (!menorSaldo || total < menorSaldo.valor)) menorSaldo = { valor: total, data: d };
  }

  const linhas: LinhaFluxo[] = [];
  const soma = (v: (number | null)[]) => arred2(v.reduce<number>((s, x) => s + (x ?? 0), 0));
  const nomeCat = (id: string) => {
    const c = porId.get(id);
    return c ? `${c.codigo} · ${c.nome}` : "Categoria removida";
  };
  const secao = (rotulo: string, tipo: "entrada" | "saida", a: Acum) => {
    linhas.push({ chave: `s:${tipo}`, tipo: "secao", rotulo, valores: Array(n).fill(null), total: null });
    const grupos = [...a.grupos.entries()].sort(([x], [y]) => (porId.get(x)?.codigo ?? "").localeCompare(porId.get(y)?.codigo ?? "", "pt-BR", { numeric: true }));
    for (const [id, g] of grupos) {
      const chave = `g:${tipo}:${id}`;
      const cats = [...g.cats.keys()];
      linhas.push({ chave, tipo: "grupo", rotulo: nomeCat(id), valores: g.valores.map(arred2), total: soma(g.valores), rastreio: { tipo, categorias: cats, semCategoria: false } });
      for (const [cid, v] of [...g.cats.entries()].sort(([x], [y]) => (porId.get(x)?.codigo ?? "").localeCompare(porId.get(y)?.codigo ?? "", "pt-BR", { numeric: true }))) {
        linhas.push({ chave: `c:${tipo}:${cid}`, tipo: "categoria", rotulo: nomeCat(cid), valores: v.map(arred2), total: soma(v), pai: chave, rastreio: { tipo, categorias: [cid], semCategoria: false } });
      }
    }
    if (a.sem.some((v) => v)) linhas.push({ chave: `g:${tipo}:sem`, tipo: "grupo", rotulo: "Sem categoria", valores: a.sem.map(arred2), total: soma(a.sem), rastreio: { tipo, categorias: null, semCategoria: true } });
    linhas.push({
      chave: `m:${tipo}`,
      tipo: "manual",
      rotulo: "Previsão digitada",
      valores: a.manual.map(arred2),
      total: soma(a.manual),
      editavel: tipo,
      dica: tipo === "entrada" ? "Entrada prevista que ainda não é título (digitada aqui)" : "Saída prevista que ainda não é título (digitada aqui)",
    });
    const tot = colunas.map((_, k) => arred2([...a.grupos.values()].reduce((s, g) => s + g.valores[k], 0) + a.sem[k] + a.manual[k]));
    linhas.push({ chave: `t:${tipo}`, tipo: "total", rotulo: tipo === "entrada" ? "Total de entradas" : "Total de saídas", valores: tot, total: soma(tot) });
    return tot;
  };
  const totEnt = secao("Entradas", "entrada", ent);
  const totSai = secao("Saídas", "saida", sai);
  const resultado = totEnt.map((v, k) => arred2(v - totSai[k]));
  linhas.push({ chave: "resultado", tipo: "resultado", rotulo: "Resultado (entradas − saídas)", valores: resultado, total: soma(resultado) });

  linhas.push({ chave: "s:saldo", tipo: "secao", rotulo: "Saldo", valores: Array(n).fill(null), total: null });
  const temContas = contas.length > 0;
  if (temContas) {
    // Fim de cada coluna: saldo do último dia real dela.
    linhas.push({
      chave: "g:contas",
      tipo: "grupo",
      rotulo: `Contas bancárias · ${contas.length}`,
      valores: colunas.map((_, k) => {
        const l = contas.map((_, i) => saldoContaCol[i][k]).filter((v): v is number => v !== null);
        return l.length ? arred2(l.reduce((s, v) => s + v, 0)) : null;
      }),
      total: null,
      dica: "Saldo real das contas no fim do dia (pagos e recebidos com a conta informada)",
    });
    contas.forEach((c, i) => linhas.push({ chave: `conta:${c.conta_bancaria_id}`, tipo: "conta", rotulo: c.nome, valores: saldoContaCol[i], total: null, pai: "g:contas" }));
  }
  if (transfCol.some((v) => v)) linhas.push({ chave: "transferencias", tipo: "info", rotulo: "Transferências entre contas", valores: transfCol.map(arred2), total: soma(transfCol) });
  linhas.push({
    chave: "saldo",
    tipo: "saldo",
    rotulo: "Saldo final (real e previsto)",
    valores: saldoTotalCol,
    total: null,
    dica: temContas ? "Até ontem, saldo real das contas; de hoje em diante, soma o previsto" : "Cadastre as contas bancárias com saldo inicial para ver o saldo",
  });

  if (e.anteriores) {
    const ant = new Map<string, number>();
    const somar = (k: string, v: number) => ant.set(k, (ant.get(k) ?? 0) + v);
    for (const m of e.anteriores) {
      if (m.natureza === "transferencia") continue;
      const v = Number(m.valor);
      const r = m.categoria_id ? raiz(m.categoria_id) : undefined;
      if (m.natureza === "manual") somar(`m:${m.tipo}`, v);
      else if (!r || !m.categoria_id) somar(`g:${m.tipo}:sem`, v);
      else {
        somar(`g:${m.tipo}:${r.id}`, v);
        somar(`c:${m.tipo}:${m.categoria_id}`, v);
      }
      somar(`t:${m.tipo}`, v);
      somar("resultado", m.tipo === "entrada" ? v : -v);
    }
    for (const l of linhas) {
      if (["grupo", "categoria", "manual", "total", "resultado"].includes(l.tipo) && l.chave !== "g:contas") l.anterior = arred2(ant.get(l.chave) ?? 0);
    }
  }

  let entradasPrevistas = 0;
  let saidasPrevistas = 0;
  for (const m of e.movimentos) {
    if (m.natureza !== "previsto" && m.natureza !== "atrasado" && m.natureza !== "manual") continue;
    const dia = dataNoFluxo(m, hoje);
    if (dia < de || dia > ate) continue;
    if (m.tipo === "entrada") entradasPrevistas += Number(m.valor);
    else saidasPrevistas += Number(m.valor);
  }

  return {
    colunas,
    linhas,
    previsoes,
    resumo: {
      saldoHoje,
      menorSaldo,
      entradasPrevistas: arred2(entradasPrevistas),
      saidasPrevistas: arred2(saidasPrevistas),
      atrasadoReceber: arred2(atrasadoReceber),
      atrasadoPagar: arred2(atrasadoPagar),
    },
  };
}
