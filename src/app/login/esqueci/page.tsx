"use client";

import { useActionState } from "react";
import { enviarRecuperacao, type EstadoLogin } from "../actions";
import { BotaoEntrada, CampoEntrada, LinkEntrada, Mensagens, Moldura } from "../moldura";

export default function PaginaEsqueci() {
  const [estado, acao, enviando] = useActionState<EstadoLogin, FormData>(enviarRecuperacao, {});

  return (
    <Moldura subtitulo="Informe seu e-mail. Enviaremos um link para você criar uma senha nova.">
      <form action={acao} className="space-y-4">
        <CampoEntrada rotulo="E-mail" name="email" type="email" autoComplete="email" />
        <Mensagens erro={estado.erro} aviso={estado.aviso} />
        <BotaoEntrada enviando={enviando} rotulo="Enviar link" rotuloEnviando="Enviando..." />
      </form>
      <LinkEntrada href="/login">Voltar para o login</LinkEntrada>
    </Moldura>
  );
}
