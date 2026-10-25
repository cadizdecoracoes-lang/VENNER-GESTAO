import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

const CAMINHO = "/producao/ficha-tecnica";

async function cliente() {
  return supabaseConfigurado ? criarClienteNavegador() : null;
}

export async function criarVersao(itemId: string): Promise<Estado> {
  const supabase = await cliente();
  if (!supabase) return SEM_BANCO;
  const { error } = await supabase.rpc("nova_versao_ficha", { item: itemId });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}?item=${itemId}`);
}

export async function ativarVersao(fichaId: string, itemId: string): Promise<Estado> {
  const supabase = await cliente();
  if (!supabase) return SEM_BANCO;
  const { error } = await supabase.rpc("ativar_ficha", { ficha: fichaId });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}?item=${itemId}`);
}

export async function excluirRascunho(fichaId: string, itemId: string): Promise<Estado> {
  const supabase = await cliente();
  if (!supabase) return SEM_BANCO;
  const { data, error } = await supabase.from("fichas_tecnicas").delete().eq("id", fichaId).eq("status", "rascunho").select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}?item=${itemId}`);
}

export async function salvarDadosVersao(fichaId: string, _: Estado, form: FormData): Promise<Estado> {
  const supabase = await cliente();
  if (!supabase) return SEM_BANCO;
  const quantidadeBase = lerNumero(form.get("quantidade_base"));
  if (!(quantidadeBase > 0)) return { erro: "A quantidade base precisa ser maior que zero." };
  const { data, error } = await supabase
    .from("fichas_tecnicas")
    .update({ quantidade_base: quantidadeBase, observacao: String(form.get("observacao") ?? "").trim() || null })
    .eq("id", fichaId)
    .select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function adicionarComponente(fichaId: string, _: Estado, form: FormData): Promise<Estado> {
  const supabase = await cliente();
  if (!supabase) return SEM_BANCO;
  const componente = String(form.get("componente_id") ?? "");
  const quantidade = lerNumero(form.get("quantidade"));
  const perda = lerNumero(form.get("perda_percentual"));
  if (!componente) return { erro: "Escolha o componente." };
  if (!(quantidade > 0)) return { erro: "A quantidade precisa ser maior que zero." };
  if (Number.isNaN(perda) || perda < 0 || perda >= 100) return { erro: "A perda precisa ficar entre 0 e 99%." };

  const { error } = await supabase
    .from("ficha_componentes")
    .insert({ ficha_id: fichaId, componente_id: componente, quantidade, perda_percentual: perda });
  if (error) {
    if (error.code === "23505") return { erro: "Este componente já está na ficha. Remova a linha e lance de novo com a quantidade certa." };
    return { erro: mensagemErro(error) };
  }
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function removerComponente(id: string): Promise<Estado> {
  const supabase = await cliente();
  if (!supabase) return SEM_BANCO;
  const { data, error } = await supabase.from("ficha_componentes").delete().eq("id", id).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function adicionarOperacao(fichaId: string, _: Estado, form: FormData): Promise<Estado> {
  const supabase = await cliente();
  if (!supabase) return SEM_BANCO;
  const sequencia = lerNumero(form.get("sequencia"));
  const descricao = String(form.get("descricao") ?? "").trim();
  const setup = lerNumero(form.get("tempo_setup_min"));
  const execucao = lerNumero(form.get("tempo_execucao_min"));
  if (!descricao) return { erro: "Descreva a operação." };
  if (!Number.isInteger(sequencia) || sequencia <= 0) return { erro: "A sequência precisa ser um número inteiro, como 10, 20, 30." };
  if ([setup, execucao].some((n) => Number.isNaN(n) || n < 0)) return { erro: "Os tempos precisam ser números positivos, em minutos." };

  const { error } = await supabase.from("ficha_operacoes").insert({
    ficha_id: fichaId,
    sequencia,
    descricao,
    posto_id: String(form.get("posto_id") ?? "") || null,
    tempo_setup_min: setup,
    tempo_execucao_min: execucao,
    instrucoes: String(form.get("instrucoes") ?? "").trim() || null,
  });
  if (error) {
    if (error.code === "23505") return { erro: "Já existe uma operação com essa sequência." };
    return { erro: mensagemErro(error) };
  }
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function removerOperacao(id: string): Promise<Estado> {
  const supabase = await cliente();
  if (!supabase) return SEM_BANCO;
  const { data, error } = await supabase.from("ficha_operacoes").delete().eq("id", id).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}
