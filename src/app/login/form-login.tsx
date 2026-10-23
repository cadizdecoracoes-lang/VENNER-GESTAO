"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { guardarSessaoDoLink } from "@/lib/supabase/sessao-do-link";
import { entrar, type EstadoLogin } from "./actions";
import { BotaoEntrada, CampoEntrada, LinkEntrada, Mensagens, Moldura } from "./moldura";

export function FormLogin({ erroInicial }: { erroInicial?: string }) {
  const [estado, acao, enviando] = useActionState<EstadoLogin, FormData>(entrar, {});
  const router = useRouter();

  // Link de recuperação no formato antigo (sessão depois do "#").
  useEffect(() => {
    guardarSessaoDoLink().then((tipo) => {
      if (tipo === "recovery") router.replace("/login/nova-senha");
      else if (tipo) router.replace("/");
    });
  }, [router]);

  return (
    <Moldura subtitulo="Entre com seu e-mail e senha.">
      <form action={acao} className="space-y-4">
        <CampoEntrada rotulo="E-mail" name="email" type="email" autoComplete="email" />
        <CampoEntrada rotulo="Senha" name="senha" type="password" autoComplete="current-password" />
        <Mensagens erro={estado.erro ?? erroInicial} />
        <BotaoEntrada enviando={enviando} rotulo="Entrar" rotuloEnviando="Entrando..." />
      </form>
      <LinkEntrada href="/login/esqueci">Esqueci minha senha</LinkEntrada>
    </Moldura>
  );
}
