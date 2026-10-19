"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

const CAMINHO = "/config/perfis";

// `todasEmpresas`: perfis de acesso total têm as permissões travadas, só nome e descrição mudam.
export async function salvarPerfil(id: string | null, todasEmpresas: boolean, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const nome = String(form.get("nome") ?? "").trim();
  if (!nome) return { erro: "Informe o nome do perfil." };
  const dados = { nome, descricao: String(form.get("descricao") ?? "").trim() || null };

  const supabase = await criarClienteServidor();
  const { data, error } = id
    ? await supabase.from("perfis").update(dados).eq("id", id).select("id")
    : await supabase.from("perfis").insert(dados).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  if (!todasEmpresas) {
    const permissoes = form.getAll("permissoes").map(String);
    const { error: erroPermissoes } = await supabase.rpc("definir_permissoes_perfil", { perfil: data[0].id, permissoes });
    if (erroPermissoes) return { erro: mensagemErro(erroPermissoes) };
  }

  revalidatePath(CAMINHO);
  redirect(CAMINHO);
}

export async function excluirPerfil(id: string): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("perfis").delete().eq("id", id).select("id");
  if (error) {
    if (error.code === "23503") return { erro: "Há usuários com este perfil. Troque o perfil deles antes de excluir." };
    return { erro: mensagemErro(error) };
  }
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  redirect(CAMINHO);
}
