// Consultas da conciliação: linhas do extrato e títulos candidatos.
import { somarDias } from "@/lib/datas";
import { guardadoPor } from "@/lib/navegacao";
import { saldoBancoNoDia, type AncoraSaldo, type LinhaDoDia, type LinhaRepeticao, type TituloCandidato, type TituloDoDia } from "@/lib/extrato";
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

// Linhas do extrato da conta: pendentes (padrão), resolvidas ou todas, no período.
export async function carregarLinhas(conta: string, situacao: string, de: string | null, ate: string | null): Promise<LinhaConciliacao[]> {
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
  if (de) q = q.gte("data", de);
  if (ate) q = q.lte("data", ate);
  return ((await q).data ?? []) as unknown as LinhaConciliacao[];
}

// Pendentes da conta antes do período mostrado (para avisar que existem).
export async function contarPendentesAntes(conta: string, de: string): Promise<number> {
  if (!supabaseConfigurado) return 0;
  const { count } = await criarClienteNavegador()
    .from("extrato_lancamentos")
    .select("id", { count: "exact", head: true })
    .eq("conta_bancaria_id", conta)
    .eq("situacao", "pendente")
    .lt("data", de);
  return count ?? 0;
}

// Tudo o que mexe no saldo da conta num dia, dos dois lados: linhas do extrato
// (com os títulos ligados) e títulos baixados nesta conta (com as datas das
// linhas ligadas). Base de diferencaDoDia.
export async function carregarMovimentoDoDia(conta: string, dia: string): Promise<{ linhas: LinhaDoDia[]; titulos: TituloDoDia[] }> {
  if (!supabaseConfigurado) return { linhas: [], titulos: [] };
  const supabase = criarClienteNavegador();
  const [l, p, r] = await Promise.all([
    supabase
      .from("extrato_lancamentos")
      .select(
        "id, data, descricao, valor, situacao, extrato_conciliacoes(contas_pagar(id, conta_bancaria_id, data_pagamento, valor_pago, situacao), contas_receber(id, conta_bancaria_id, data_recebimento, valor_recebido, situacao))",
      )
      .eq("conta_bancaria_id", conta)
      .eq("data", dia)
      .limit(3000),
    supabase
      .from("contas_pagar")
      .select("id, descricao, parcela, valor_pago, fornecedores(nome, nome_fantasia), extrato_conciliacoes(extrato_lancamentos(data, conta_bancaria_id))")
      .eq("conta_bancaria_id", conta)
      .eq("situacao", "pago")
      .eq("data_pagamento", dia)
      .limit(3000),
    supabase
      .from("contas_receber")
      .select("id, descricao, parcela, valor_recebido, clientes(nome, nome_fantasia), extrato_conciliacoes(extrato_lancamentos(data, conta_bancaria_id))")
      .eq("conta_bancaria_id", conta)
      .eq("situacao", "pago")
      .eq("data_recebimento", dia)
      .limit(3000),
  ]);
  const erro = l.error ?? p.error ?? r.error;
  if (erro) throw new Error(erro.message);
  type T = { id: string; conta_bancaria_id: string | null; situacao: string; valor_pago?: number; valor_recebido?: number; data_pagamento?: string; data_recebimento?: string };
  type C = { contas_pagar: T | null; contas_receber: T | null };
  const linhas: LinhaDoDia[] = ((l.data ?? []) as unknown as (Omit<LinhaDoDia, "titulos"> & { extrato_conciliacoes: C[] })[]).map((x) => ({
    id: x.id,
    data: x.data,
    descricao: x.descricao,
    valor: Number(x.valor),
    situacao: x.situacao,
    titulos: x.extrato_conciliacoes.flatMap((c) => {
      const t = c.contas_pagar ?? c.contas_receber;
      if (!t) return [];
      const pagar = !!c.contas_pagar;
      const pago = t.situacao === "pago";
      return [
        {
          id: t.id,
          tipo: pagar ? ("pagar" as const) : ("receber" as const),
          conta: pago ? t.conta_bancaria_id : null,
          data: pago ? ((pagar ? t.data_pagamento : t.data_recebimento) ?? null) : null,
          valor: pagar ? -Number(t.valor_pago ?? 0) : Number(t.valor_recebido ?? 0),
        },
      ];
    }),
  }));
  type B = Record<string, unknown> & { extrato_conciliacoes: { extrato_lancamentos: { data: string; conta_bancaria_id: string } | null }[] };
  const datas = (t: B) =>
    t.extrato_conciliacoes.flatMap((c) => (c.extrato_lancamentos && c.extrato_lancamentos.conta_bancaria_id === conta ? [c.extrato_lancamentos.data] : []));
  const desc = (t: B) => `${t.descricao}${t.parcela ? ` (${t.parcela})` : ""}`;
  const titulos: TituloDoDia[] = [
    ...((p.data ?? []) as unknown as B[]).map((t) => ({
      id: t.id as string,
      tipo: "pagar" as const,
      descricao: desc(t),
      pessoa: nomePessoa(t.fornecedores as Pessoa),
      valor: -Number(t.valor_pago),
      linhas: datas(t),
    })),
    ...((r.data ?? []) as unknown as B[]).map((t) => ({
      id: t.id as string,
      tipo: "receber" as const,
      descricao: desc(t),
      pessoa: nomePessoa(t.clientes as Pessoa),
      valor: Number(t.valor_recebido),
      linhas: datas(t),
    })),
  ];
  return { linhas, titulos };
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

// Saldo do banco no fim de cada dia, pelo extrato importado (ver
// saldoBancoNoDia). Devolve null quando a conta não tem saldo informado pelo
// banco (arquivo sem saldo final e linhas sem saldo).
export async function carregarSaldoBanco(contaId: string, de: string, ate: string): Promise<((dia: string) => number | null) | null> {
  if (!supabaseConfigurado) return null;
  const supabase = criarClienteNavegador();
  const [imp, linhaComSaldo, primeira, ultima] = await Promise.all([
    supabase
      .from("extrato_importacoes")
      .select("periodo_ate, saldo_final")
      .eq("conta_bancaria_id", contaId)
      .not("saldo_final", "is", null)
      .not("periodo_ate", "is", null)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("extrato_lancamentos")
      .select("data, saldo")
      .eq("conta_bancaria_id", contaId)
      .neq("situacao", "ignorado")
      .not("saldo", "is", null)
      .order("data", { ascending: false })
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("extrato_lancamentos").select("data").eq("conta_bancaria_id", contaId).order("data").limit(1).maybeSingle(),
    supabase.from("extrato_lancamentos").select("data").eq("conta_bancaria_id", contaId).order("data", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const ancora: AncoraSaldo | null = imp.data
    ? { data: imp.data.periodo_ate as string, saldo: Number(imp.data.saldo_final) }
    : linhaComSaldo.data
      ? { data: linhaComSaldo.data.data as string, saldo: Number(linhaComSaldo.data.saldo) }
      : null;
  if (!ancora || !primeira.data || !ultima.data) return null;
  const inicio = [de, ancora.data].sort()[0];
  const fim = [ate, ancora.data].sort()[1];
  const linhas: { data: string; valor: number }[] = [
    // Limites do extrato da conta (valor zero): fora deles não há saldo do banco.
    { data: primeira.data.data as string, valor: 0 },
    { data: ultima.data.data as string, valor: 0 },
  ];
  for (let i = 0; ; i += 1000) {
    const { data } = await supabase
      .from("extrato_lancamentos")
      .select("data, valor")
      .eq("conta_bancaria_id", contaId)
      .neq("situacao", "ignorado")
      .gte("data", inicio)
      .lte("data", fim)
      .order("id")
      .range(i, i + 999);
    linhas.push(...(data ?? []).map((l) => ({ data: l.data as string, valor: Number(l.valor) })));
    if (!data || data.length < 1000) break;
  }
  return (dia: string) => saldoBancoNoDia(ancora, linhas, dia);
}

// Saldo do sistema no fim do dia (saldo inicial + recebidos − pagos + transferências).
export async function carregarSaldoSistema(conta: ContaConciliacao, dia: string): Promise<number | null> {
  if (!supabaseConfigurado) return null;
  const { data } = await criarClienteNavegador().rpc("fluxo_caixa_saldos", { de: somarDias(dia, 1), empresa: conta.empresa_id });
  const s = ((data ?? []) as { conta_bancaria_id: string; saldo: number }[]).find((x) => x.conta_bancaria_id === conta.id);
  return s ? Number(s.saldo) : null;
}
