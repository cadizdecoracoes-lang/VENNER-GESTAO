"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

const CAMINHO = "/financeiro/pagar";

function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  // Mantém o dia; em meses mais curtos cai no último dia (31/01 -> 28/02).
  const ultimo = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

// Conta lançada à mão (aluguel, energia, imposto...), em uma ou várias parcelas mensais.
export async function novaConta(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const texto = (campo: string) => String(form.get(campo) ?? "").trim() || null;
  const empresa = texto("empresa_id");
  const descricao = texto("descricao");
  const valor = lerNumero(form.get("valor"));
  const vencimento = texto("vencimento");
  const parcelas = Math.trunc(lerNumero(form.get("parcelas")) || 1);

  if (!empresa) return { erro: "Escolha a empresa (CNPJ) que vai pagar." };
  if (!descricao) return { erro: "Descreva a conta, ex.: Aluguel do galpão." };
  if (!(valor > 0)) return { erro: "Informe o valor da parcela." };
  if (!vencimento) return { erro: "Informe o vencimento." };
  if (parcelas < 1 || parcelas > 120) return { erro: "O número de parcelas vai de 1 a 120." };

  const linhas = Array.from({ length: parcelas }, (_, i) => ({
    empresa_id: empresa,
    fornecedor_id: texto("fornecedor_id"),
    descricao,
    parcela: parcelas > 1 ? `${i + 1}/${parcelas}` : null,
    categoria_id: texto("categoria_id"),
    centro_custo_id: texto("centro_custo_id"),
    valor,
    vencimento: somarMeses(vencimento, i),
    observacao: texto("observacao"),
  }));
  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("contas_pagar").insert(linhas);
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  redirect(CAMINHO);
}

export async function pagarConta(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const data = String(form.get("data_pagamento") ?? "");
  const conta = String(form.get("conta_bancaria_id") ?? "");
  const valor = lerNumero(form.get("valor_pago"));
  if (!data) return { erro: "Informe a data do pagamento." };
  if (!conta) return { erro: "Escolha a conta bancária de onde saiu o pagamento." };
  if (!(valor > 0)) return { erro: "Informe o valor pago." };

  const supabase = await criarClienteServidor();
  const { data: linhas, error } = await supabase
    .from("contas_pagar")
    .update({ situacao: "pago", data_pagamento: data, conta_bancaria_id: conta, valor_pago: valor })
    .eq("id", id)
    .eq("situacao", "aberto")
    .select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(linhas);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  redirect(CAMINHO);
}

async function mudarSituacao(id: string, de: string, para: Record<string, unknown>): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("contas_pagar").update(para).eq("id", id).eq("situacao", de).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function estornarPagamento(id: string): Promise<Estado> {
  return mudarSituacao(id, "pago", { situacao: "aberto", data_pagamento: null, conta_bancaria_id: null, valor_pago: null });
}

export async function cancelarConta(id: string): Promise<Estado> {
  return mudarSituacao(id, "aberto", { situacao: "cancelado" });
}

export async function reabrirConta(id: string): Promise<Estado> {
  return mudarSituacao(id, "cancelado", { situacao: "aberto" });
}
