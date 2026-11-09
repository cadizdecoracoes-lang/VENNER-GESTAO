"use client";

import { useEffect, useState } from "react";
import { revalidatePath } from "@/lib/navegacao";
import { criarClienteNavegador } from "@/lib/supabase/client";

// Telas ao vivo: qualquer criação, edição ou exclusão no banco (desta pessoa,
// de outra, de outra aba ou do robô do Tiny) faz a tela aberta buscar os
// dados de novo, sem F5 e sem botão. A tela continua no mesmo endereço, então
// filtros, período, aba e janela aberta ficam como estavam.
//
// Como funciona:
// - o Supabase Realtime avisa cada mudança das tabelas da publicação
//   "supabase_realtime" (migração 20261109000031_telas_ao_vivo.sql), já
//   filtrada pelas permissões de quem está logado;
// - vários avisos seguidos (importação, robô) viram uma busca só;
// - ao reconectar, ao voltar para a aba do navegador ou à internet, busca de
//   novo (pode ter perdido avisos no meio);
// - sem conexão com o Realtime, busca a cada 30 segundos até voltar.

const JUNTAR_MS = 700;
const SEM_CONEXAO_MS = 30_000;

type Estado = "conectando" | "ao-vivo" | "sem-conexao";

export function AoVivo() {
  const [estado, setEstado] = useState<Estado>("conectando");

  useEffect(() => {
    const supabase = criarClienteNavegador();
    let espera: ReturnType<typeof setTimeout> | undefined;
    let reserva: ReturnType<typeof setInterval> | undefined;
    let jaConectou = false;

    const atualizar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => revalidatePath(), JUNTAR_MS);
    };
    const pararReserva = () => {
      clearInterval(reserva);
      reserva = undefined;
    };

    const canal = supabase
      .channel("telas-ao-vivo")
      .on("postgres_changes", { event: "*", schema: "public" }, atualizar)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setEstado("ao-vivo");
          pararReserva();
          // Reconectou: o que mudou enquanto estava fora não foi avisado.
          if (jaConectou) atualizar();
          jaConectou = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setEstado("sem-conexao");
          if (!reserva) reserva = setInterval(atualizar, SEM_CONEXAO_MS);
        }
      });

    const aoVoltarParaAba = () => {
      if (document.visibilityState === "visible") atualizar();
    };
    document.addEventListener("visibilitychange", aoVoltarParaAba);
    window.addEventListener("online", atualizar);

    return () => {
      clearTimeout(espera);
      pararReserva();
      document.removeEventListener("visibilitychange", aoVoltarParaAba);
      window.removeEventListener("online", atualizar);
      void supabase.removeChannel(canal);
    };
  }, []);

  const [cor, texto, dica] =
    estado === "ao-vivo"
      ? ["bg-sucesso", "Ao vivo", "As telas se atualizam sozinhas a cada criação, edição ou exclusão."]
      : estado === "conectando"
        ? ["bg-texto-suave/50", "Conectando", "Ligando a atualização automática das telas."]
        : ["bg-alerta", "Sem conexão", "Sem aviso ao vivo agora: as telas se atualizam a cada 30 segundos até a conexão voltar."];

  return (
    <span className="flex items-center gap-1.5 text-xs text-texto-suave" title={dica} role="status">
      <span className={`h-2 w-2 rounded-full ${cor}`} aria-hidden />
      <span className="hidden lg:inline">{texto}</span>
    </span>
  );
}
