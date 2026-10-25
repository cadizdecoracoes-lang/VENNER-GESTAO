// Consultas da conciliação: linhas do extrato e títulos candidatos.
import { somarDias } from "@/lib/datas";
import type { TituloCandidato } from "@/lib/extrato";
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
  extrato_conciliacoes: Ligacao[];
};

export const nomePessoa = (p: Pessoa) => (p ? p.nome_fantasia || p.nome : null);

export async function carregarContas(empresa: string | null): Promise<ContaConciliacao[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  let q = supabase.from("contas_bancarias").select("id, empresa_id, nome, banco_nome, tipo").eq("ativa", true).order("nome");
  if (empresa) q = q.eq("empresa_id", empresa);
  return ((await q).data ?? []) as ContaConciliacao[];
}

// Quantidade e soma das linhas pendentes por conta (para as abas das contas).
export async function carregarPendentes(empresa: string | null): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (!supabaseConfigurado) return mapa;
  const supabase = criarClienteNavegador();
  let q = supabase.from("extrato_lancamentos").select("conta_bancaria_id").eq("situacao", "pendente").limit(20000);
  if (empresa) q = q.eq("empresa_id", empresa);
  for (const l of (await q).data ?? []) mapa.set(l.conta_bancaria_id, (mapa.get(l.conta_bancaria_id) ?? 0) + 1);
  return mapa;
}

export async function carregarLinhas(conta: string, situacao: string, mes: string | null): Promise<LinhaConciliacao[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  let q = supabase
    .from("extrato_lancamentos")
    .select(
      "id, data, descricao, documento, valor, saldo, situacao, observacao, extrato_conciliacoes(valor, efeito, contas_pagar(descricao, parcela, fornecedores(nome, nome_fantasia)), contas_receber(descricao, parcela, clientes(nome, nome_fantasia)))",
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
      .select("id, descricao, parcela, valor_pago, data_pagamento, fornecedores(nome, nome_fantasia), extrato_conciliacoes(id)")
      .eq("conta_bancaria_id", conta.id)
      .eq("situacao", "pago")
      .gte("data_pagamento", somarDias(de, -folgaPago))
      .lte("data_pagamento", somarDias(ate, folgaPago))
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
      .select("id, descricao, parcela, valor_recebido, data_recebimento, clientes(nome, nome_fantasia), extrato_conciliacoes(id)")
      .eq("conta_bancaria_id", conta.id)
      .eq("situacao", "pago")
      .gte("data_recebimento", somarDias(de, -folgaPago))
      .lte("data_recebimento", somarDias(ate, folgaPago))
      .limit(3000),
  ]);
  type Bruto = Record<string, unknown> & { extrato_conciliacoes?: unknown[] };
  const desc = (t: Bruto) => `${t.descricao}${t.parcela ? ` (${t.parcela})` : ""}`;
  const lista: TituloCandidato[] = [];
  for (const t of (pa.data ?? []) as unknown as Bruto[])
    lista.push({ id: t.id as string, tipo: "pagar", descricao: desc(t), pessoa: nomePessoa(t.fornecedores as Pessoa), valor: Number(t.valor), data: t.vencimento as string, pago: false });
  for (const t of (pp.data ?? []) as unknown as Bruto[])
    if (!t.extrato_conciliacoes?.length)
      lista.push({ id: t.id as string, tipo: "pagar", descricao: desc(t), pessoa: nomePessoa(t.fornecedores as Pessoa), valor: Number(t.valor_pago), data: t.data_pagamento as string, pago: true });
  for (const t of (ra.data ?? []) as unknown as Bruto[])
    lista.push({ id: t.id as string, tipo: "receber", descricao: desc(t), pessoa: nomePessoa(t.clientes as Pessoa), valor: Number(t.valor_liquido), data: t.vencimento as string, pago: false });
  for (const t of (rp.data ?? []) as unknown as Bruto[])
    if (!t.extrato_conciliacoes?.length)
      lista.push({ id: t.id as string, tipo: "receber", descricao: desc(t), pessoa: nomePessoa(t.clientes as Pessoa), valor: Number(t.valor_recebido), data: t.data_recebimento as string, pago: true });
  return lista;
}

// Saldo que o banco informou no último extrato e o do sistema no mesmo dia.
export async function carregarConferencia(conta: ContaConciliacao) {
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
}

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
