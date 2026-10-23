"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

const CAMINHO = "/vendas/anuncios";

function lerAnuncio(form: FormData) {
  const texto = (campo: string) => String(form.get(campo) ?? "").trim();
  return {
    empresa_id: texto("empresa_id"),
    canal: texto("canal"),
    codigo: texto("codigo").toUpperCase(),
    titulo: texto("titulo") || null,
    item_id: texto("item_id"),
    quantidade: lerNumero(form.get("quantidade")) || 1,
  };
}

function conferir(a: ReturnType<typeof lerAnuncio>): Estado | null {
  if (!a.empresa_id) return { erro: "Escolha a empresa (CNPJ) dona do anúncio." };
  if (!a.canal) return { erro: "Escolha a plataforma." };
  if (!a.codigo) return { erro: "Informe o código do anúncio (MLB...) ou o SKU da Shopee." };
  if (!a.item_id) return { erro: "Escolha o produto que sai do estoque nessa venda." };
  if (!(a.quantidade > 0)) return { erro: "A quantidade por venda precisa ser maior que zero." };
  return null;
}

// `voltar`: de onde veio (a importação de vendas), para continuar de lá.
export async function salvarAnuncio(id: string | null, voltar: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const anuncio = lerAnuncio(form);
  const invalido = conferir(anuncio);
  if (invalido) return invalido;

  const supabase = await criarClienteServidor();
  const { data, error } = id
    ? await supabase.from("anuncios_plataforma").update(anuncio).eq("id", id).select("id")
    : await supabase.from("anuncios_plataforma").insert(anuncio).select("id");
  if (error) return { erro: error.code === "23505" ? "Esse anúncio já está ligado a esse produto." : mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  redirect(voltar === "importar" ? "/financeiro/receber/importar" : CAMINHO);
}

export async function removerAnuncio(id: string): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("anuncios_plataforma").delete().eq("id", id).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}
