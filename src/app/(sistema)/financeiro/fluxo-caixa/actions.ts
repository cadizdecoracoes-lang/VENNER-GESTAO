import { revalidatePath } from "@/lib/navegacao";
import { hojeBrasil, somarDias } from "@/lib/datas";
import { mensagemErro, SEM_BANCO, type Estado } from "@/lib/erros";
import { dataNoFluxo, type Rastreio } from "@/lib/fluxo-caixa";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

// Previsão digitada na célula: valor vazio ou zero apaga.
export async function salvarPrevisao(empresa: string, data: string, tipo: "entrada" | "saida", valor: number | null): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !["entrada", "saida"].includes(tipo)) return { erro: "Previsão inválida." };
  if (data < hojeBrasil()) return { erro: "Previsão só vale de hoje em diante." };
  if (valor !== null && (!Number.isFinite(valor) || valor < 0)) return { erro: "Valor inválido." };
  const supabase = criarClienteNavegador();
  const { error } =
    !valor
      ? await supabase.from("fluxo_previsoes").delete().eq("empresa_id", empresa).eq("data", data).eq("tipo", tipo)
      : await supabase.from("fluxo_previsoes").upsert({ empresa_id: empresa, data, tipo, valor }, { onConflict: "empresa_id,data,tipo" });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath("/financeiro/fluxo-caixa");
  return { ok: Date.now() };
}

export type TituloDaCelula = {
  id: string;
  tipo: "pagar" | "receber";
  dataFluxo: string;
  situacao: "pago" | "aberto" | "atrasado";
  vencimento: string;
  pessoa: string | null;
  descricao: string;
  categoria: string | null;
  conta: string | null;
  empresa: string;
  valor: number;
};

type Pessoa = { nome: string; nome_fantasia: string | null } | null;
type Bruto = {
  id: string;
  empresa_id: string;
  descricao: string;
  parcela: string | null;
  vencimento: string;
  situacao: string;
  valor: number;
  valor_liquido?: number;
  valor_pago?: number | null;
  valor_recebido?: number | null;
  data_pagamento?: string | null;
  data_recebimento?: string | null;
  categoria_id: string | null;
  fornecedores?: Pessoa;
  clientes?: Pessoa;
  plano_contas: { codigo: string; nome: string } | null;
  contas_bancarias: { nome: string } | null;
  empresas: { nome_fantasia: string | null; razao_social: string } | null;
};

// Títulos que formam um valor do fluxo (regra: todo número abre os registros).
export async function titulosDaCelula(r: Rastreio, de: string, ate: string, empresa: string | null): Promise<TituloDaCelula[] | { erro: string }> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const hoje = hojeBrasil();
  const ehPagar = r.tipo === "saida";
  const tabela = ehPagar ? "contas_pagar" : "contas_receber";
  const dataPago = ehPagar ? "data_pagamento" : "data_recebimento";
  const sel = `id, empresa_id, descricao, parcela, vencimento, situacao, valor, categoria_id, ${
    ehPagar ? "valor_pago, data_pagamento, fornecedores(nome, nome_fantasia)" : "valor_liquido, valor_recebido, data_recebimento, clientes(nome, nome_fantasia)"
  }, plano_contas(codigo, nome), contas_bancarias(nome), empresas(nome_fantasia, razao_social)`;
  const filtrar = <Q extends { eq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q; is: (c: string, v: null) => Q }>(q: Q) => {
    if (empresa) q = q.eq("empresa_id", empresa);
    if (r.semCategoria) q = q.is("categoria_id", null);
    else if (r.categorias) q = q.in("categoria_id", r.categorias);
    return q;
  };
  const [pagos, abertos] = await Promise.all([
    filtrar(supabase.from(tabela).select(sel).eq("situacao", "pago").gte(dataPago, de).lte(dataPago, ate)).limit(3000),
    // Em aberto: vencimento no período (5 dias antes, pelo fim de semana) e os atrasados, que caem em hoje.
    filtrar(
      supabase
        .from(tabela)
        .select(sel)
        .eq("situacao", "aberto")
        .lte("vencimento", ate)
        .gte("vencimento", hoje >= de && hoje <= ate ? "1900-01-01" : somarDias(de, -5)),
    ).limit(3000),
  ]);
  if (pagos.error || abertos.error) return { erro: mensagemErro((pagos.error ?? abertos.error)!) };

  const lista: TituloDaCelula[] = [];
  const montar = (t: Bruto, pago: boolean): TituloDaCelula => {
    const atrasado = !pago && t.vencimento < hoje;
    return {
      id: t.id,
      tipo: ehPagar ? "pagar" : "receber",
      dataFluxo: pago
        ? ((ehPagar ? t.data_pagamento : t.data_recebimento) as string)
        : dataNoFluxo({ data: t.vencimento, natureza: atrasado ? "atrasado" : "previsto" }, hoje),
      situacao: pago ? "pago" : atrasado ? "atrasado" : "aberto",
      vencimento: t.vencimento,
      pessoa: (() => {
        const p = ehPagar ? t.fornecedores : t.clientes;
        return p ? p.nome_fantasia || p.nome : null;
      })(),
      descricao: `${t.descricao}${t.parcela ? ` (${t.parcela})` : ""}`,
      categoria: t.plano_contas ? `${t.plano_contas.codigo} · ${t.plano_contas.nome}` : null,
      conta: t.contas_bancarias?.nome ?? null,
      empresa: t.empresas ? t.empresas.nome_fantasia || t.empresas.razao_social : "",
      valor: Number(pago ? (ehPagar ? t.valor_pago : t.valor_recebido) : ehPagar ? t.valor : t.valor_liquido),
    };
  };
  for (const t of (pagos.data ?? []) as unknown as Bruto[]) lista.push(montar(t, true));
  for (const t of (abertos.data ?? []) as unknown as Bruto[]) {
    const m = montar(t, false);
    if (m.dataFluxo >= de && m.dataFluxo <= ate) lista.push(m);
  }
  return lista.sort((a, b) => a.dataFluxo.localeCompare(b.dataFluxo) || b.valor - a.valor);
}
