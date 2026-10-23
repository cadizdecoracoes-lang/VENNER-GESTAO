"use server";

import { redirect } from "next/navigation";
import { enderecoPublico } from "@/lib/endereco";
import { criarClienteServidor } from "@/lib/supabase/server";

export type EstadoLogin = { erro?: string; aviso?: string };

// Traduz as respostas do Supabase para o usuário saber o que fazer.
function motivo(mensagem: string) {
  const m = mensagem.toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
  if (m.includes("email not confirmed")) return "Este e-mail ainda não foi confirmado. Peça à diretoria para confirmar o seu login.";
  if (m.includes("rate limit") || m.includes("too many")) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if (m.includes("not authorized"))
    return "O envio de e-mails do sistema ainda não está liberado para este endereço. Fale com a diretoria.";
  if (m.includes("password") && (m.includes("short") || m.includes("at least") || m.includes("weak")))
    return "Senha fraca: use pelo menos 8 caracteres, misturando letras e números.";
  if (m.includes("same") && m.includes("password")) return "A senha nova precisa ser diferente da anterior.";
  return `Não foi possível concluir: ${mensagem}`;
}

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("senha") ?? ""),
  });
  if (error) return { erro: motivo(error.message) };
  redirect("/");
}

export async function enviarRecuperacao(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { erro: "Informe o seu e-mail." };
  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await enderecoPublico()}/login/confirmar?proximo=/login/nova-senha`,
  });
  if (error) return { erro: motivo(error.message) };
  return {
    aviso: "Se este e-mail tiver login no sistema, você vai receber um link para criar a senha nova. Confira também a caixa de spam.",
  };
}

export async function trocarSenha(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const senha = String(form.get("senha") ?? "");
  if (senha.length < 8) return { erro: "Use pelo menos 8 caracteres." };
  if (senha !== String(form.get("confirmacao") ?? "")) return { erro: "As duas senhas não são iguais." };
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: "O link expirou ou já foi usado. Peça um novo em “Esqueci minha senha”." };
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) return { erro: motivo(error.message) };
  redirect("/");
}

export async function sair() {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
