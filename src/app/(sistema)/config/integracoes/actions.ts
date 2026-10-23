"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, SEM_BANCO, type Estado } from "@/lib/erros";
import { sincronizarConta } from "@/lib/plataformas/sincronizar";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { lerTiny } from "@/lib/tiny/robo";

const CAMINHO = "/config/integracoes";

export async function escolherLocal(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const local = String(form.get("local") ?? "");
  if (!local) return { erro: "Escolha o local." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("ajustar_integracao", { integracao: id, local });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function buscarVendas(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const desde = String(form.get("desde") ?? "");
  const dias = Math.max(0, Math.min(120, Number(form.get("dias")) || 0));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return { erro: "Informe a data de início." };
  const supabase = await criarClienteServidor();
  let r;
  try {
    r = await sincronizarConta(supabase, id, desde, dias);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "A plataforma não respondeu. Tente de novo em alguns minutos." };
  }
  revalidatePath(CAMINHO);
  revalidatePath("/financeiro/receber");
  const q = new URLSearchParams({ importadas: String(r.importadas), repetidas: String(r.repetidas), puladas: String(r.puladas) });
  if (r.semAnuncio.length) q.set("sem_anuncio", r.semAnuncio.slice(0, 30).join(","));
  redirect(`${CAMINHO}?${q}`);
}

export async function removerConta(id: string): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("remover_integracao", { integracao: id });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

// Tiny: chaves do aplicativo coladas aqui (ficam no banco, nenhuma tela mostra de novo).
export async function salvarChavesTiny(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const empresa = String(form.get("empresa") ?? "");
  if (!empresa) return { erro: "Escolha a empresa dona da conta do Tiny." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("salvar_aplicativo_tiny", {
    empresa,
    cliente: String(form.get("client_id") ?? ""),
    segredo: String(form.get("client_secret") ?? ""),
  });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function lerTinyAgora(id: string): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = await criarClienteServidor();
  const chave = await supabase.rpc("chave_robo_tiny", { integracao: id });
  if (chave.error) return { erro: mensagemErro(chave.error) };
  let r;
  try {
    // Orçamento menor que o do robô: esta tela já gastou algumas chamadas.
    r = await lerTiny(supabase, id, chave.data as string, 30);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "O Tiny não respondeu. Tente de novo em alguns minutos." };
  }
  revalidatePath(CAMINHO);
  if (r.erro) return { erro: r.erro };
  return { ok: Date.now() };
}

export async function ajustarPagarTiny(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const ate = String(form.get("ate") ?? "");
  if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return { erro: "Data inválida." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("ajustar_robo_tiny", { integracao: id, ler_contas_pagar_ate: ate || null });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}
