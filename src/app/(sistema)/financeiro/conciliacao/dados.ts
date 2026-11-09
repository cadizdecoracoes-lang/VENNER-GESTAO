// Consultas da conciliação: linhas do extrato e títulos candidatos.
import { somarDias } from "@/lib/datas";
import { guardadoPor } from "@/lib/navegacao";
import type { LinhaRepeticao, TituloCandidato } from "@/lib/extrato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

export type ContaConciliacao = { id: string; empresa_id: string; nome: string; banco_nome: string | null; tipo: string };

type Pessoa = { nome: string; nome_fantasia: string | null } | null;
export type Ligacao = {
  valor: number;
  efeito: string;
  contas_pagar: { descricao: string; parcela: string | null; fornecedores: Pessoa } | null;
  contas_receber: { descricao: string; parcela: string | null; clientes: Pessoa } | null;
};
export type LinhaConciliacao = {
  id: string;
  data: string;
  descricao: string;
  documento: string | null;
  valor: number;
  saldo: number | null;
  situacao: "pendente" | "conciliado" | "transferencia" | "ignorado";
  observacao: string | null;
  importacao_id: string | null;
  extrato_conciliacoes: Ligacao[];
};

export const nomePessoa = (p: Pessoa) => (p ? p.nome_fantasia || p.nome : null);

// Contas, pendentes, conferência de saldo e importações não dependem do
// filtro (situação, mês, linha): ficam guardadas até a próxima gravação (ou 2
// minutos) e clicar num filtro só busca as linhas de novo.
const contasGuardadas = guardadoPor(async (empresa: string): Promise<ContaConciliacao[]> => {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  let q = supabase.from("contas_bancarias").select("id, empresa_id, nome, banco_nome, tipo").eq("ativa", true).order("nome");
  if (empresa) q = q.eq("empresa_id", empresa);
  return ((await q).data ?? []) as ContaConciliacao[];
});
export const carregarContas = (empresa: string | null) => contasGuardadas(empresa ?? "");

// Quantidade de linhas pendentes por conta (para o seletor de contas): uma
// contagem por conta, sem trazer as linhas.
const pendentesGuardados = guardadoPor(async (empresa: string): Promise<Map<string, number>> => {
  const mapa = new Map<string, number>();
  if (!supabaseConfigurado) return mapa;
  const supabase = criarClienteNavegador();
  const contas = await carregarContas(empresa || null);
  const contagens = await Promise.all(
    contas.map((c) =>
      supabase
        .from("extrato_lancamentos")
        .select("id", { count: "exact", head: true })
        .eq("conta_bancaria_id", c.id)
        .eq("situacao", "pendente"),
    ),
  );
  contas.forEach((c, i) => {
    const n = contagens[i].count ?? 0;
    if (n > 0) mapa.set(c.id, n);
  });
  return mapa;
});
export const carregarPendentes = (empresa: string | null) => pendentesGuardados(empresa ?? "");

export async function carregarLinhas(conta: string, situacao: string, mes: string | null): Promise<LinhaConciliacao[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  let q = supabase
    .from("extrato_lancamentos")
    .select(
      "id, data, descricao, documento, valor, saldo, situacao, observacao, importacao_id, extrato_conciliacoes(valor, efeito, contas_pagar(descricao, parcela, fornecedores(nome, nome_fantasia)), contas_receber(descricao, parcela, clientes(nome, nome_fantasia)))",
    )
    .eq("conta_bancaria_id", conta)
    .order("data")
    .order("chave")
    .limit(3000);
  if (situacao === "pendente") q = q.eq("situacao", "pendente");
  else if (situacao === "resolvido") q = q.neq("situacao", "pendente");
  if (mes) q = q.gte("data", `${mes}-01`).lte("data", `${mes}-31`);
  return ((await q).data ?? []) as unknown as LinhaConciliacao[];
}

const contasTinySemBanco = guardadoPor(async (empresa: string): Promise<string[]> => {
  const { data } = await criarClienteNavegador()
    .from("contas_bancarias")
    .select("id")
    .eq("empresa_id", empresa)
    .eq("nome", "Tiny · conta não informada");
  return (data ?? []).map((c) => c.id as string);
});

// Todas as linhas da conta perto das datas (qualquer situação), para achar o
// mesmo lançamento que outra importação trouxe com a data trocada.
export async function carregarVizinhas(conta: string, de: string, ate: string): Promise<LinhaRepeticao[]> {
  if (!supabaseConfigurado) return [];
  const { data } = await criarClienteNavegador()
    .from("extrato_lancamentos")
    .select("id, data, valor, importacao_id, situacao")
    .eq("conta_bancaria_id", conta)
    .gte("data", somarDias(de, -3))
    .lte("data", somarDias(ate, 3))
    .limit(20000);
  return ((data ?? []) as LinhaRepeticao[]).map((l) => ({ ...l, valor: Number(l.valor) }));
}

// Títulos que podem casar com as linhas: em aberto do CNPJ (pelo vencimento)
// e já baixados nesta conta e ainda sem conciliação (pela data da baixa).
export async function carregarCandidatos(
  conta: ContaConciliacao,
  de: string,
  ate: string,
  folgaAberto = 10,
  folgaPago = 3,
): Promise<TituloCandidato[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  // Pagos pelo Tiny sem a conta da baixa também servem (passam para esta conta ao conciliar).
  const tinySemConta = await contasTinySemBanco(conta.empresa_id);
  const contas = [conta.id, ...tinySemConta];
  const folga = tinySemConta.length ? Math.max(folgaPago, folgaAberto) : folgaPago;
  const [pa, pp, ra, rp] = await Promise.all([
    supabase
      .from("contas_pagar")
      .select("id, descricao, parcela, valor, vencimento, fornecedores(nome, nome_fantasia)")
      .eq("empresa_id", conta.empresa_id)
      .eq("situacao", "aberto")
      .gte("vencimento", somarDias(de, -folgaAberto))
      .lte("vencimento", somarDias(ate, folgaAberto))
      .limit(3000),
    supabase
      .from("contas_pagar")
      .select("id, descricao, parcela, valor_pago, data_pagamento, conta_bancaria_id, fornecedores(nome, nome_fantasia), extrato_conciliacoes(id)")
      .in("conta_bancaria_id", contas)
      .eq("situacao", "pago")
      .gte("data_pagamento", somarDias(de, -folga))
      .lte("data_pagamento", somarDias(ate, folga))
      .limit(3000),
    supabase
      .from("contas_receber")
      .select("id, descricao, parcela, valor_liquido, vencimento, clientes(nome, nome_fantasia)")
      .eq("empresa_id", conta.empresa_id)
      .eq("situacao", "aberto")
      .gte("vencimento", somarDias(de, -folgaAberto))
      .lte("vencimento", somarDias(ate, folgaAberto))
      .limit(3000),
    supabase
      .from("contas_receber")
      .select("id, descricao, parcela, valor_recebido, data_recebimento, conta_bancaria_id, clientes(nome, nome_fantasia), extrato_conciliacoes(id)")
      .in("conta_bancaria_id", contas)
      .eq("situacao", "pago")
      .gte("data_recebimento", somarDias(de, -folga))
      .lte("data_recebimento", somarDias(ate, folga))
      .limit(3000),
  ]);
  type Bruto = Record<string, unknown> & { extrato_conciliacoes?: unknown[] };
  const desc = (t: Bruto) => `${t.descricao}${t.parcela ? ` (${t.parcela})` : ""}`;
  const lista: TituloCandidato[] = [];
  for (const t of (pa.data ?? []) as unknown as Bruto[])
    lista.push({ id: t.id as string, tipo: "pagar", descricao: desc(t), pessoa: nomePessoa(t.fornecedores as Pessoa), valor: Number(t.valor), data: t.vencimento as string, pago: false });
  for (const t of (pp.data ?? []) as unknown as Bruto[])
    if (!t.extrato_conciliacoes?.length)
      lista.push({ id: t.id as string, tipo: "pagar", descricao: desc(t), pessoa: nomePessoa(t.fornecedores as Pessoa), valor: Number(t.valor_pago), data: t.data_pagamento as string, pago: true, semConta: t.conta_bancaria_id !== conta.id });
  for (const t of (ra.data ?? []) as unknown as Bruto[])
    lista.push({ id: t.id as string, tipo: "receber", descricao: desc(t), pessoa: nomePessoa(t.clientes as Pessoa), valor: Number(t.valor_liquido), data: t.vencimento as string, pago: false });
  for (const t of (rp.data ?? []) as unknown as Bruto[])
    if (!t.extrato_conciliacoes?.length)
      lista.push({ id: t.id as string, tipo: "receber", descricao: desc(t), pessoa: nomePessoa(t.clientes as Pessoa), valor: Number(t.valor_recebido), data: t.data_recebimento as string, pago: true, semConta: t.conta_bancaria_id !== conta.id });
  return lista;
}

// Saldo que o banco informou no último extrato e o do sistema no mesmo dia.
export function carregarConferencia(conta: ContaConciliacao) {
  return conferenciaGuardada(`${conta.id}|${conta.empresa_id}`);
}
const conferenciaGuardada = guardadoPor(async (chave: string) => {
  const [id, empresa] = chave.split("|");
  const conta = { id, empresa_id: empresa };
  if (!supabaseConfigurado) return null;
  const supabase = criarClienteNavegador();
  const { data: imp } = await supabase
    .from("extrato_importacoes")
    .select("saldo_final, periodo_ate, criado_em, origem, arquivo")
    .eq("conta_bancaria_id", conta.id)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!imp) return null;
  let sistema: number | null = null;
  if (imp.periodo_ate) {
    const { data } = await supabase.rpc("fluxo_caixa_saldos", { de: somarDias(imp.periodo_ate, 1), empresa: conta.empresa_id });
    const s = ((data ?? []) as { conta_bancaria_id: string; saldo: number }[]).find((x) => x.conta_bancaria_id === conta.id);
    sistema = s ? Number(s.saldo) : null;
  }
  return {
    banco: imp.saldo_final === null ? null : Number(imp.saldo_final),
    ate: imp.periodo_ate as string | null,
    sistema,
    importadoEm: imp.criado_em as string,
    arquivo: imp.arquivo as string | null,
  };
});

export type IndicadorMes = { mes: string; linhas: number; resolvidas: number; entradas: number; saidas: number };

// Movimento do extrato no mês escolhido (ou no atual) e no anterior, para comparar.
export async function carregarIndicadores(conta: string, mes: string): Promise<[IndicadorMes, IndicadorMes]> {
  const [a, m] = mes.split("-").map(Number);
  const anterior = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
  const vazio = (x: string): IndicadorMes => ({ mes: x, linhas: 0, resolvidas: 0, entradas: 0, saidas: 0 });
  const r: [IndicadorMes, IndicadorMes] = [vazio(mes), vazio(anterior)];
  if (!supabaseConfigurado) return r;
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("extrato_lancamentos")
    .select("data, valor, situacao")
    .eq("conta_bancaria_id", conta)
    .gte("data", `${anterior}-01`)
    .lte("data", `${mes}-31`)
    .limit(20000);
  for (const l of data ?? []) {
    const alvo = l.data.startsWith(mes) ? r[0] : r[1];
    const v = Number(l.valor);
    alvo.linhas++;
    if (l.situacao !== "pendente") alvo.resolvidas++;
    if (v > 0) alvo.entradas += v;
    else alvo.saidas += -v;
  }
  return r;
}

export type ImportacaoExtrato = {
  id: string;
  arquivo: string | null;
  origem: string;
  periodo_de: string | null;
  periodo_ate: string | null;
  importadas: number;
  criado_em: string;
  conciliadas: number;
};

// Importações da conta, da mais nova para a mais velha, com quantas linhas já
// foram resolvidas (conciliadas, transferência ou ignoradas).
// Só a contagem vem do banco (antes vinham todas as linhas de todas as
// importações só para contar, o que pesava a tela a cada clique).
export const carregarImportacoes = guardadoPor(async (contaId: string): Promise<ImportacaoExtrato[]> => {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("extrato_importacoes")
    .select("id, arquivo, origem, periodo_de, periodo_ate, importadas, criado_em")
    .eq("conta_bancaria_id", contaId)
    .order("criado_em", { ascending: false })
    .limit(200);
  const lista = (data ?? []) as Omit<ImportacaoExtrato, "conciliadas">[];
  const contagens = await Promise.all(
    lista.map((i) =>
      supabase.from("extrato_lancamentos").select("id", { count: "exact", head: true }).eq("importacao_id", i.id).neq("situacao", "pendente"),
    ),
  );
  return lista.map((i, n) => ({ ...i, conciliadas: contagens[n].count ?? 0 }));
});
