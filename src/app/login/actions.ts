"use server";

import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

export type EstadoLogin = { erro?: string };

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? ""),
    password: String(form.get("senha") ?? ""),
  });
  if (error) return { erro: "E-mail ou senha inválidos." };
  redirect("/");
}

export async function sair() {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
