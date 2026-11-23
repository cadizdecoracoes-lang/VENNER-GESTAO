"use client";

import { useState } from "react";
import { estiloBotaoSecundario } from "@/components/ui";

// Copia a lista do que corrigir no Tiny, pronta para colar no WhatsApp ou no
// e-mail do financeiro.
export function CopiarAvisos({ texto, quantos }: { texto: string; quantos: number }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      window.prompt("Copie a lista:", texto);
    }
  }
  return (
    <button
      type="button"
      onClick={copiar}
      className={`${estiloBotaoSecundario} py-1.5`}
      title="Copia a lista das linhas que precisam de correção no Tiny, com o motivo de cada uma, para mandar ao financeiro"
    >
      {copiado ? "Copiado" : `Copiar ${quantos} para corrigir no Tiny`}
    </button>
  );
}
