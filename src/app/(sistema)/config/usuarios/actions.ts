import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

export async function salvarUsuario(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const nome = String(form.get("nome") ?? "").trim();
  const perfil = String(form.get("perfil_id") ?? "") || null;
  const ativo = form.get("ativo") === "on";
  if (!nome) return { erro: "Informe o nome." };
  if (ativo && !perfil) return { erro: "Escolha o perfil antes de liberar o acesso." };

  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.from("usuarios").update({ nome, perfil_id: perfil, ativo }).eq("id", id).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  const empresas = form.getAll("empresas").map(String);
  const { error: erroEmpresas } = await supabase.rpc("definir_empresas_usuario", { usuario: id, empresas });
  if (erroEmpresas) return { erro: mensagemErro(erroEmpresas) };

  revalidatePath("/config/usuarios");
  redirect("/config/usuarios");
}
