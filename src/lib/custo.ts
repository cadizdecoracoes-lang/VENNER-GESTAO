// Custo padrão da ficha técnica, calculado a partir do cadastro.
// Materiais: quantidade com perda × custo médio do componente.
// Operações: (preparação + execução) em horas × custo hora do posto.
// Tudo dividido pela quantidade base (quantas unidades uma execução produz).

export type LinhaComponente = { quantidade: number; perda_percentual: number; custo_medio: number };
export type LinhaOperacao = { tempo_setup_min: number; tempo_execucao_min: number; custo_hora: number };

export function quantidadeComPerda(c: { quantidade: number; perda_percentual: number }): number {
  return c.quantidade * (1 + c.perda_percentual / 100);
}

export function custoComponente(c: LinhaComponente): number {
  return quantidadeComPerda(c) * c.custo_medio;
}

export function custoOperacao(o: LinhaOperacao): number {
  return ((o.tempo_setup_min + o.tempo_execucao_min) / 60) * o.custo_hora;
}

export function custoPadrao(componentes: LinhaComponente[], operacoes: LinhaOperacao[], quantidadeBase: number) {
  const materiais = componentes.reduce((s, c) => s + custoComponente(c), 0) / quantidadeBase;
  const transformacao = operacoes.reduce((s, o) => s + custoOperacao(o), 0) / quantidadeBase;
  return { materiais, transformacao, total: materiais + transformacao };
}
