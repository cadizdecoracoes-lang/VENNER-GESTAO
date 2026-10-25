"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { redirect } from "@/lib/navegacao";
import { FormLogin } from "./form-login";

function Login() {
  const busca = useSearchParams();
  const codigo = busca.get("code");

  useEffect(() => {
    // Link de e-mail que caiu no endereço principal (Site URL) em vez da tela de confirmação.
    if (codigo) redirect(`/login/confirmar?code=${encodeURIComponent(codigo)}&proximo=/login/nova-senha`);
  }, [codigo]);

  const erro =
    busca.get("erro") === "inatividade"
      ? "Sua sessão foi encerrada depois de 15 minutos sem uso. Entre de novo."
      : busca.get("erro") === "link" || busca.get("error_description")
        ? "O link do e-mail expirou ou já foi usado. Peça um novo em “Esqueci minha senha”."
        : undefined;
  return <FormLogin erroInicial={erro} />;
}

export default function PaginaLogin() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
