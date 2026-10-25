"use client";

import { useEffect } from "react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { comBase } from "@/lib/endereco";
import { esquecerUso, LIMITE_SEM_USO, marcarUso, ultimoUso } from "@/lib/inatividade";

// Depois de 15 minutos sem uso, encerra o login e volta para a tela de entrada.
export function SaidaPorInatividade() {
  useEffect(() => {
    let ultimo = ultimoUso() || Date.now();
    let saindo = false;

    async function conferir() {
      ultimo = Math.max(ultimo, ultimoUso());
      if (saindo || Date.now() - ultimo < LIMITE_SEM_USO) return;
      saindo = true;
      esquecerUso();
      // Sai mesmo sem internet: o login guardado neste navegador é apagado de qualquer jeito.
      await criarClienteNavegador()
        .auth.signOut()
        .catch(() => criarClienteNavegador().auth.signOut({ scope: "local" }))
        .catch(() => undefined);
      window.location.assign(comBase("/login?erro=inatividade"));
    }

    // Quem volta ao sistema depois de muito tempo já cai fora logo ao abrir.
    void conferir();
    if (!saindo) marcarUso();

    let gravado = Date.now();
    const usou = () => {
      ultimo = Date.now();
      // Grava no máximo a cada 15 segundos.
      if (ultimo - gravado > 15_000) {
        gravado = ultimo;
        marcarUso();
      }
    };
    const eventos = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
    eventos.forEach((e) => window.addEventListener(e, usou, { passive: true }));
    const relogio = window.setInterval(conferir, 30_000);
    const aoVoltar = () => document.visibilityState === "visible" && void conferir();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      eventos.forEach((e) => window.removeEventListener(e, usou));
      window.clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  return null;
}
