import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { gerarLancamentos, INTERVALOS, totalPago, type Intervalo, type TipoLancamento } from "@/lib/contas-pagar";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

const CAMINHO = "/financeiro/pagar";

// Depois de salvar, volta para a lista do jeito que estava (período, situação...).
function voltar(form: FormData): never {
  const volta = String(form.get("volta") ?? "");
  return redirect(volta.startsWith("/financeiro/") ? volta : CAMINHO);
}

// Conta lançada à mão (aluguel, energia, imposto...): única, parcelada (total
// dividido) ou recorrente (mesmo valor repetido).
export async function novaConta(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const texto = (campo: string) => String(form.get(campo) ?? "").trim() || null;
  const empresa = texto("empresa_id");
  const descricao = texto("descricao");
  const valor = lerNumero(form.get("valor"));
  const vencimento = texto("vencimento");
  const tipo = (texto("tipo") ?? "unica") as TipoLancamento;
  const quantidade = Math.trunc(lerNumero(form.get("quantidade")) || 1);
  const intervalo = (texto("intervalo") ?? "mensal") as Intervalo;

  if (!empresa) return { erro: "Escolha a empresa (CNPJ) que vai pagar." };
  if (!descricao) return { erro: "Descreva a conta, ex.: Aluguel do galpão." };
  if (!(valor > 0)) return { erro: tipo === "parcelada" ? "Informe o valor total." : "Informe o valor." };
  if (!vencimento) return { erro: "Informe o vencimento." };
  if (!["unica", "parcelada", "recorrente"].includes(tipo)) return { erro: "Escolha o tipo de lançamento." };
  if (!(intervalo in INTERVALOS)) return { erro: "Escolha de quanto em quanto tempo." };
  if (tipo !== "unica" && (quantidade < 2 || quantidade > 120)) return { erro: "A quantidade vai de 2 a 120." };
  if (tipo === "parcelada" && valor / quantidade < 0.01) return { erro: "Valor pequeno demais para tantas parcelas." };

  const grupo = tipo === "unica" ? null : crypto.randomUUID();
  const linhas = gerarLancamentos({ tipo, valor, vencimento, quantidade, intervalo }).map((l) => ({
    empresa_id: empresa,
    fornecedor_id: texto("fornecedor_id"),
    descricao,
    parcela: l.parcela,
    categoria_id: texto("categoria_id"),
    centro_custo_id: texto("centro_custo_id"),
    valor: l.valor,
    vencimento: l.vencimento,
    observacao: texto("observacao"),
    grupo_id: grupo,
  }));
  const supabase = criarClienteNavegador();
  const { error } = await supabase.from("contas_pagar").insert(linhas);
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  return voltar(form);
}

// Baixa com o principal separado de juros, multa e desconto. O valor pago
// (o que saiu do banco) é a soma deles.
export async function pagarConta(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const data = String(form.get("data_pagamento") ?? "");
  const conta = String(form.get("conta_bancaria_id") ?? "");
  const principal = lerNumero(form.get("principal"));
  const juros = lerNumero(form.get("juros"));
  const multa = lerNumero(form.get("multa"));
  const desconto = lerNumero(form.get("desconto"));
  if (!data) return { erro: "Informe a data do pagamento." };
  if (!conta) return { erro: "Escolha a conta bancária de onde saiu o pagamento." };
  if (!(principal > 0)) return { erro: "Informe o valor principal pago." };
  if ([juros, multa, desconto].some((v) => !(v >= 0))) return { erro: "Juros, multa e desconto não podem ser negativos." };
  const total = totalPago({ principal, juros, multa, desconto });
  if (!(total > 0)) return { erro: "O desconto não pode ser maior que o valor pago." };

  const supabase = criarClienteNavegador();
  const { data: linhas, error } = await supabase
    .from("contas_pagar")
    .update({
      situacao: "pago",
      data_pagamento: data,
      conta_bancaria_id: conta,
      valor_pago: total,
      juros: juros || null,
      multa: multa || null,
      desconto: desconto || null,
    })
    .eq("id", id)
    .eq("situacao", "aberto")
    .select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(linhas);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return voltar(form);
}

async function mudarSituacao(id: string, de: string, para: Record<string, unknown>): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = criarClienteNavegador();
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

// Corrige uma conta ainda em aberto (valor, vencimento, fornecedor, categoria...).
export async function editarConta(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const texto = (campo: string) => String(form.get(campo) ?? "").trim() || null;
  const descricao = texto("descricao");
  const valor = lerNumero(form.get("valor"));
  const vencimento = texto("vencimento");
  if (!descricao) return { erro: "Descreva a conta, ex.: Aluguel do galpão." };
  if (!(valor > 0)) return { erro: "Informe o valor." };
  if (!vencimento) return { erro: "Informe o vencimento." };

  const supabase = criarClienteNavegador();
  const { data, error } = await supabase
    .from("contas_pagar")
    .update({
      fornecedor_id: texto("fornecedor_id"),
      descricao,
      categoria_id: texto("categoria_id"),
      centro_custo_id: texto("centro_custo_id"),
      valor,
      vencimento,
      observacao: texto("observacao"),
    })
    .eq("id", id)
    .eq("situacao", "aberto")
    .select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return voltar(form);
}

// ---------------------------------------------------------------------------
// Em massa: só contas em aberto. Cada ação diz quantas mudou.
// ---------------------------------------------------------------------------

function idsDoForm(form: FormData): string[] {
  return String(form.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Troca só os campos preenchidos (vencimento, categoria, centro de custo, fornecedor).
export async function alterarEmMassa(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const ids = idsDoForm(form);
  if (ids.length === 0) return { erro: "Marque as contas na lista." };
  const texto = (campo: string) => String(form.get(campo) ?? "").trim();
  const mudar: Record<string, string | null> = {};
  if (texto("vencimento")) mudar.vencimento = texto("vencimento");
  if (texto("categoria_id")) mudar.categoria_id = texto("categoria_id");
  if (texto("centro_custo_id")) mudar.centro_custo_id = texto("centro_custo_id") === "nenhum" ? null : texto("centro_custo_id");
  if (texto("fornecedor_id")) mudar.fornecedor_id = texto("fornecedor_id");
  if (Object.keys(mudar).length === 0) return { erro: "Preencha pelo menos um campo para alterar." };

  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.from("contas_pagar").update(mudar).in("id", ids).eq("situacao", "aberto").select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

// Paga várias contas da mesma empresa pelo valor de cada uma (sem juros).
export async function pagarEmMassa(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const ids = idsDoForm(form);
  const data = String(form.get("data_pagamento") ?? "");
  const conta = String(form.get("conta_bancaria_id") ?? "");
  if (ids.length === 0) return { erro: "Marque as contas na lista." };
  if (!data) return { erro: "Informe a data do pagamento." };
  if (!conta) return { erro: "Escolha a conta bancária de onde saiu o pagamento." };

  const supabase = criarClienteNavegador();
  const { data: contas, error: erroLer } = await supabase.from("contas_pagar").select("id, valor").in("id", ids).eq("situacao", "aberto");
  if (erroLer) return { erro: mensagemErro(erroLer) };
  let feitas = 0;
  for (const c of contas ?? []) {
    const { data: linhas, error } = await supabase
      .from("contas_pagar")
      .update({ situacao: "pago", data_pagamento: data, conta_bancaria_id: conta, valor_pago: c.valor })
      .eq("id", c.id)
      .eq("situacao", "aberto")
      .select("id");
    if (error) {
      revalidatePath(CAMINHO);
      return { erro: `${feitas} paga(s); parou numa conta: ${mensagemErro(error)}` };
    }
    feitas += linhas?.length ?? 0;
  }
  if (feitas === 0) return { erro: "Nenhuma conta foi paga (já pagas ou sem permissão)." };
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function cancelarEmMassa(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const ids = idsDoForm(form);
  if (ids.length === 0) return { erro: "Marque as contas na lista." };
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.from("contas_pagar").update({ situacao: "cancelado" }).in("id", ids).eq("situacao", "aberto").select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}
