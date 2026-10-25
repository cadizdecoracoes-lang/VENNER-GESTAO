// Planejamento da fábrica a partir dos pedidos em fase de produção:
// - necessidade de materiais (MRP): quanto de cada item os pedidos consomem,
//   descontando o estoque em cada nível da estrutura;
// - fila de produção: ordem sugerida dos pedidos, com o motivo de cada posição,
//   o que pode ser produzido já com o material em estoque e a previsão de término.
// Sem dependências do Next, para rodar também nos testes (node --test).
import { diasEntre, somarDias } from "./datas.ts";

export type ItemPlan = {
  id: string;
  codigo: string;
  descricao: string;
  tipo: string;
  unidade: string;
  prazo_reposicao_dias: number;
  estoque_minimo: number;
  custo_medio: number;
  saldo: number;
};
export type FichaPlan = {
  item_id: string;
  quantidade_base: number;
  componentes: { componente_id: string; quantidade: number; perda_percentual: number }[];
  operacoes: { posto_id: string | null; tempo_setup_min: number; tempo_execucao_min: number }[];
};
export type PedidoPlan = {
  id: string;
  numero: number;
  empresa_id: string;
  cliente: string;
  data_pedido: string;
  prazo_entrega: string | null;
  prazo_recebimento_dias: number;
  prioridade: number;
  etapa: string;
  etapa_ordem: number;
  itens: { item_id: string; quantidade: number; valor_total: number }[] | null;
};
export type PostoPlan = { id: string; nome: string; capacidade_horas_dia: number };
export type DadosPlanejamento = { pedidos: PedidoPlan[]; itens: ItemPlan[]; fichas: FichaPlan[]; postos: PostoPlan[] };

const n = (v: unknown) => Number(v ?? 0);
const arred = (v: number) => Math.round(v * 10000) / 10000;

// Quantidade de componente por unidade do produto, já com a perda.
function porUnidade(f: FichaPlan, c: FichaPlan["componentes"][number]): number {
  return (n(c.quantidade) / n(f.quantidade_base)) * (1 + n(c.perda_percentual) / 100);
}

// Nível mais baixo em que cada item aparece na estrutura (0 = produto vendido).
// Processar por nível garante que a necessidade de um componente já somou
// todos os produtos que o usam antes de descontar o estoque dele.
function niveis(fichas: Map<string, FichaPlan>, itens: string[]): Map<string, number> {
  const nivel = new Map<string, number>();
  const visitar = (id: string, profundidade: number, caminho: Set<string>) => {
    if (caminho.has(id)) return;
    if ((nivel.get(id) ?? -1) >= profundidade) return;
    nivel.set(id, profundidade);
    const f = fichas.get(id);
    if (!f) return;
    caminho.add(id);
    for (const c of f.componentes) visitar(c.componente_id, profundidade + 1, caminho);
    caminho.delete(id);
  };
  for (const id of itens) visitar(id, 0, new Set());
  return nivel;
}

export type LinhaNecessidade = {
  item: ItemPlan;
  // Total que os pedidos consomem deste item (depois de descontar o estoque dos níveis acima).
  necessidade: number;
  saldo: number;
  // Falta para atender os pedidos.
  falta: number;
  // Falta para atender os pedidos e manter o estoque mínimo.
  sugestao: number;
  // Item com ficha técnica: a falta é produzida, não comprada.
  produzido: boolean;
  // Produto acabado ou subconjunto sem ficha técnica ativa: não dá para saber a
  // matéria-prima dele, então não entra na compra (precisa cadastrar a ficha).
  sem_ficha: boolean;
  // Data limite para o item estar disponível: menor prazo dos pedidos, menos o prazo de reposição.
  data_limite: string | null;
  pedidos: number[];
};

// Tipos que a fábrica produz: sem ficha técnica, não viram compra.
const FABRICADOS = new Set(["produto_acabado", "subconjunto"]);

// Itens que entram na sugestão de compra quando faltam.
export function comprado(l: LinhaNecessidade): boolean {
  return !l.produzido && !l.sem_ficha && l.item.tipo !== "servico";
}

export function necessidadeMateriais(d: DadosPlanejamento, hoje: string): LinhaNecessidade[] {
  const fichas = new Map(d.fichas.map((f) => [f.item_id, f]));
  const itens = new Map(d.itens.map((i) => [i.id, i]));
  const bruta = new Map<string, number>();
  const origem = new Map<string, Set<number>>();
  const prazo = new Map<string, string>();
  const somar = (id: string, qtd: number, pedidos: Iterable<number>, data: string | null) => {
    bruta.set(id, (bruta.get(id) ?? 0) + qtd);
    const o = origem.get(id) ?? new Set<number>();
    for (const p of pedidos) o.add(p);
    origem.set(id, o);
    if (data && (!prazo.has(id) || data < prazo.get(id)!)) prazo.set(id, data);
  };

  for (const p of d.pedidos) for (const i of p.itens ?? []) somar(i.item_id, n(i.quantidade), [p.numero], p.prazo_entrega ?? hoje);

  const nivel = niveis(fichas, [...bruta.keys()]);
  const ordem = [...nivel.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const linhas: LinhaNecessidade[] = [];
  for (const id of ordem) {
    const item = itens.get(id);
    const total = bruta.get(id) ?? 0;
    if (!item || total <= 0) continue;
    const saldo = Math.max(0, n(item.saldo));
    const falta = Math.max(0, total - saldo);
    const f = fichas.get(id);
    if (f && falta > 0) {
      for (const c of f.componentes) somar(c.componente_id, falta * porUnidade(f, c), origem.get(id) ?? [], prazo.get(id) ?? null);
    }
    const limite = prazo.get(id) ?? null;
    linhas.push({
      item,
      necessidade: arred(total),
      saldo: arred(n(item.saldo)),
      falta: arred(falta),
      sugestao: arred(Math.max(0, total + n(item.estoque_minimo) - saldo)),
      produzido: !!f,
      sem_ficha: !f && FABRICADOS.has(item.tipo),
      data_limite: limite ? somarDias(limite, -n(item.prazo_reposicao_dias)) : null,
      pedidos: [...(origem.get(id) ?? [])].sort((a, b) => a - b),
    });
  }
  return linhas;
}

export type PosicaoFila = {
  pedido: PedidoPlan;
  valor: number;
  pontos: number;
  // Material completo em estoque (considerando os pedidos acima na fila).
  pode_produzir: boolean;
  // Quanto vem pronto do estoque de produto acabado.
  atendido_estoque: boolean;
  horas: number;
  dias_atraso: number;
  faltas: { item: ItemPlan; quantidade: number }[];
  sem_ficha: ItemPlan[];
  previsao: string | null;
  motivos: string[];
};

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function filaProducao(d: DadosPlanejamento, hoje: string): PosicaoFila[] {
  const fichas = new Map(d.fichas.map((f) => [f.item_id, f]));
  const itens = new Map(d.itens.map((i) => [i.id, i]));
  const postos = new Map(d.postos.map((p) => [p.id, p]));

  // Horas de produção de cada pedido (todas as etapas da estrutura).
  const horasPorPosto = (id: string, qtd: number, acc: Map<string, number>, caminho = new Set<string>()) => {
    const f = fichas.get(id);
    if (!f || caminho.has(id)) return;
    caminho.add(id);
    for (const o of f.operacoes) {
      const minutos = n(o.tempo_setup_min) + (n(o.tempo_execucao_min) * qtd) / n(f.quantidade_base);
      const chave = o.posto_id ?? "sem_posto";
      acc.set(chave, (acc.get(chave) ?? 0) + minutos);
    }
    for (const c of f.componentes) {
      if (fichas.has(c.componente_id)) horasPorPosto(c.componente_id, qtd * porUnidade(f, c), acc, caminho);
    }
    caminho.delete(id);
  };

  const base = d.pedidos.map((p) => {
    const minutos = new Map<string, number>();
    for (const i of p.itens ?? []) horasPorPosto(i.item_id, n(i.quantidade), minutos);
    const horas = [...minutos.values()].reduce((s, m) => s + m, 0) / 60;
    const valor = (p.itens ?? []).reduce((s, i) => s + n(i.valor_total), 0);
    const atraso = p.prazo_entrega ? diasEntre(p.prazo_entrega, hoje) : 0;
    return { p, minutos, horas, valor, atraso };
  });

  // Pontuação: atraso pesa mais; depois valor por hora de fábrica e rapidez do recebimento.
  const maxValorHora = Math.max(1, ...base.map((b) => b.valor / Math.max(b.horas, 0.5)));
  const maxRecebimento = Math.max(1, ...base.map((b) => n(b.p.prazo_recebimento_dias)));
  const pontuados = base
    .map((b) => {
      const ptsAtraso = Math.max(-30, Math.min(90, b.atraso));
      const ptsValor = (20 * (b.valor / Math.max(b.horas, 0.5))) / maxValorHora;
      const ptsCaixa = 10 * (1 - n(b.p.prazo_recebimento_dias) / maxRecebimento);
      const ptsPrioridade = 50 * n(b.p.prioridade);
      return { ...b, pontos: Math.round((ptsAtraso + ptsValor + ptsCaixa + ptsPrioridade) * 10) / 10 };
    })
    .sort((a, b) => b.pontos - a.pontos || a.p.numero - b.p.numero);

  // Reserva o estoque na ordem da fila. Pedido sem material completo não reserva
  // nada, para não segurar material de quem pode produzir.
  const estoque = new Map(d.itens.map((i) => [i.id, Math.max(0, n(i.saldo))]));
  const carga = new Map<string, number>();
  const resultado: PosicaoFila[] = pontuados.map((b) => {
    const tentativa = new Map(estoque);
    const faltas = new Map<string, number>();
    const semFicha = new Set<string>();
    let produz = false;
    const consumir = (id: string, qtd: number, caminho: Set<string>) => {
      const disponivel = tentativa.get(id) ?? 0;
      const usa = Math.min(disponivel, qtd);
      tentativa.set(id, disponivel - usa);
      const resto = qtd - usa;
      if (resto <= 1e-9) return;
      const f = fichas.get(id);
      if (!f || caminho.has(id)) {
        if (!f && FABRICADOS.has(itens.get(id)?.tipo ?? "")) {
          semFicha.add(id);
        } else if (itens.get(id)?.tipo !== "servico") {
          faltas.set(id, (faltas.get(id) ?? 0) + resto);
        }
        return;
      }
      produz = true;
      caminho.add(id);
      for (const c of f.componentes) consumir(c.componente_id, resto * porUnidade(f, c), caminho);
      caminho.delete(id);
    };
    for (const i of b.p.itens ?? []) consumir(i.item_id, n(i.quantidade), new Set());
    const completo = faltas.size === 0 && semFicha.size === 0;
    if (completo) for (const [k, v] of tentativa) estoque.set(k, v);

    // Previsão: carga acumulada no posto mais ocupado do pedido.
    let previsao: string | null = null;
    if (completo && !produz) previsao = hoje;
    else if (completo) {
      let dias = 0;
      for (const [posto, minutos] of b.minutos) {
        const total = (carga.get(posto) ?? 0) + minutos;
        carga.set(posto, total);
        const capacidade = n(postos.get(posto)?.capacidade_horas_dia ?? 8) * 60;
        dias = Math.max(dias, Math.ceil(total / capacidade));
      }
      previsao = somarDias(hoje, Math.max(dias, 1));
    }

    const motivos: string[] = [];
    if (n(b.p.prioridade) > 0) motivos.push(n(b.p.prioridade) === 2 ? "Marcado como urgente" : "Marcado como prioridade alta");
    if (!b.p.prazo_entrega) motivos.push("Sem prazo de entrega informado");
    else if (b.atraso > 0) motivos.push(`${b.atraso} dias de atraso (prazo ${b.p.prazo_entrega.split("-").reverse().join("/")})`);
    else motivos.push(`Faltam ${-b.atraso} dias para o prazo`);
    motivos.push(`${moeda.format(b.valor)} em ${num.format(Math.round(b.horas * 10) / 10)} h de produção`);
    motivos.push(n(b.p.prazo_recebimento_dias) === 0 ? "Recebimento à vista" : `Recebe ${b.p.prazo_recebimento_dias} dias após a entrega`);
    if (completo) motivos.push(produz ? "Material completo em estoque" : "Atendido com produto já em estoque");
    for (const [id, q] of faltas) {
      const it = itens.get(id);
      if (it) motivos.push(`Falta ${num.format(arred(q))} ${it.unidade} de ${it.codigo}`);
    }
    for (const id of semFicha) {
      const it = itens.get(id);
      if (it) motivos.push(`${it.codigo} sem ficha técnica ativa`);
    }

    return {
      pedido: b.p,
      valor: b.valor,
      pontos: b.pontos,
      pode_produzir: completo,
      atendido_estoque: completo && !produz,
      horas: Math.round(b.horas * 10) / 10,
      dias_atraso: b.atraso,
      faltas: [...faltas].map(([id, q]) => ({ item: itens.get(id)!, quantidade: arred(q) })).filter((f) => f.item),
      sem_ficha: [...semFicha].map((id) => itens.get(id)!).filter(Boolean),
      previsao,
      motivos,
    };
  });

  // Quem pode produzir vem primeiro; dentro de cada grupo, a pontuação manda.
  return [...resultado.filter((r) => r.pode_produzir), ...resultado.filter((r) => !r.pode_produzir)];
}
