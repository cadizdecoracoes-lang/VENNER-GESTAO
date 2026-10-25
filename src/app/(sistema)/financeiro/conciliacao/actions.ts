"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, SEM_BANCO, type Estado } from "@/lib/erros";
import type { LinhaExtrato } from "@/lib/extrato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

const CAMINHO = "/financeiro/conciliacao";
const ORIGENS = ["ofx", "planilha", "pdf"] as const;

// Grava as linhas lidas do arquivo (a tela já mostrou e a pessoa conferiu).
export async function importarExtrato(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  let dados: { conta: string; origem: (typeof ORIGENS)[number]; arquivo: string; saldoFinal: number | null; linhas: LinhaExtrato[] };
  try {
    dados = JSON.parse(String(form.get("dados") ?? ""));
  } catch {
    return { erro: "Leia o arquivo do extrato antes de importar." };
  }
  if (!dados.conta) return { erro: "Escolha a conta bancária do extrato." };
  if (!ORIGENS.includes(dados.origem)) return { erro: "Formato de arquivo não reconhecido." };
  if (!dados.linhas?.length) return { erro: "O arquivo não tem lançamentos para importar." };

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("importar_extrato", {
    conta_bancaria: dados.conta,
    origem: dados.origem,
    arquivo: dados.arquivo,
    linhas: dados.linhas.map(({ data, descricao, documento, valor, saldo, id_banco }) => ({ data, descricao, documento, valor, saldo, id_banco })),
    saldo_final: dados.saldoFinal,
  });
  if (error) return { erro: mensagemErro(error) };
  const r = data as { importadas: number; repetidas: number };
  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}?conta=${dados.conta}&importadas=${r.importadas}&repetidas=${r.repetidas}`);
}

async function chamar(funcao: string, args: Record<string, unknown>): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc(funcao, args);
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function conciliar(lancamento: string, pagar: string[], receber: string[]): Promise<Estado> {
  return chamar("conciliar_lancamento", { lancamento, pagar, receber });
}

// Aceita todas as sugestões da tela de uma vez; para na primeira que der erro.
export async function conciliarSugestoes(_: Estado, form: FormData): Promise<Estado> {
  let pares: { linha: string; tipo: "pagar" | "receber"; titulos: string[] }[];
  try {
    pares = JSON.parse(String(form.get("pares") ?? "[]"));
  } catch {
    return { erro: "Sugestões inválidas. Recarregue a tela." };
  }
  let feitas = 0;
  for (const p of pares) {
    const r = await chamar("conciliar_lancamento", {
      lancamento: p.linha,
      pagar: p.tipo === "pagar" ? p.titulos : [],
      receber: p.tipo === "receber" ? p.titulos : [],
    });
    if (r.erro) return { erro: `${feitas} conciliada(s). Parou numa linha: ${r.erro}` };
    feitas++;
  }
  return { ok: Date.now() };
}

export async function marcarTransferencia(lancamento: string): Promise<Estado> {
  return chamar("marcar_lancamento", { lancamento, situacao: "transferencia", observacao: null });
}

export async function ignorar(lancamento: string, _: Estado, form: FormData): Promise<Estado> {
  const motivo = String(form.get("motivo") ?? "").trim();
  if (!motivo) return { erro: "Escreva o motivo para ignorar." };
  return chamar("marcar_lancamento", { lancamento, situacao: "ignorado", observacao: motivo });
}

export async function desfazer(lancamento: string): Promise<Estado> {
  return chamar("desfazer_conciliacao", { lancamento });
}
