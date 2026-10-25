"use client";

import type { EmailOtpType } from "@supabase/supabase-js";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { caminhoSeguro } from "@/lib/endereco";
import { marcarUso } from "@/lib/inatividade";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Moldura } from "../moldura";

// Destino dos links enviados por e-mail (recuperar senha, confirmar login):
// troca o código do link por uma sessão e segue para a tela pedida.
function Confirmar() {
  const busca = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const proximo = caminhoSeguro(busca.get("proximo"), "/login/nova-senha");
    const supabase = criarClienteNavegador();
    const codigo = busca.get("code");
    const tokenHash = busca.get("token_hash");
    const tipo = busca.get("type") as EmailOtpType | null;
    const troca = codigo
      ? supabase.auth.exchangeCodeForSession(codigo)
      : tokenHash && tipo
        ? supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo })
        : Promise.resolve({ error: new Error("sem código") });
    troca.then(({ error }) => {
      if (!error) marcarUso();
      router.replace(error ? "/login?erro=link" : proximo);
    });
  }, [busca, router]);

  return <Moldura subtitulo="Conferindo o link do e-mail...">{null}</Moldura>;
}

export default function PaginaConfirmar() {
  return (
    <Suspense>
      <Confirmar />
    </Suspense>
  );
}
