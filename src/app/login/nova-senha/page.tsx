"use client";

import { useActionState, useEffect } from "react";
import { guardarSessaoDoLink } from "@/lib/supabase/sessao-do-link";
import { trocarSenha, type EstadoLogin } from "../actions";
import { BotaoEntrada, CampoEntrada, LinkEntrada, Mensagens, Moldura } from "../moldura";

export default function PaginaNovaSenha() {
  const [estado, acao, enviando] = useActionState<EstadoLogin, FormData>(trocarSenha, {});

  useEffect(() => {
    guardarSessaoDoLink();
  }, []);

  return (
    <Moldura subtitulo="Crie sua senha nova. Use pelo menos 8 caracteres.">
      <form action={acao} className="space-y-4">
        <CampoEntrada rotulo="Senha nova" name="senha" type="password" autoComplete="new-password" minLength={8} />
        <CampoEntrada rotulo="Repita a senha nova" name="confirmacao" type="password" autoComplete="new-password" minLength={8} />
        <Mensagens erro={estado?.erro} />
        <BotaoEntrada enviando={enviando} rotulo="Salvar e entrar" rotuloEnviando="Salvando..." />
      </form>
      <LinkEntrada href="/login">Voltar para o login</LinkEntrada>
    </Moldura>
  );
}
