"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { estiloBotaoSecundario, estiloCampo } from "@/components/ui";

// Folha alvo do ponto de equilíbrio. Vai no endereço (?folha=), para a tela
// ao vivo refazer a conta com o mesmo valor.
export function SimuladorFolha({ valor }: { valor: number }) {
  const router = useRouter();
  const busca = useSearchParams();
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => setTexto(String(valor)), [valor]);
  return (
    <form
      className="flex items-center gap-1.5 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const numero = Number(texto.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(numero) || numero < 0) return;
        const q = new URLSearchParams(busca.toString());
        q.set("folha", String(Math.round(numero)));
        router.push(`?${q.toString()}`, { scroll: false });
      }}
    >
      <label htmlFor="folha-alvo" className="text-texto-suave">
        Folha mensal da meta R$
      </label>
      <input
        id="folha-alvo"
        inputMode="decimal"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className={`${estiloCampo} w-28 py-1 text-right`}
      />
      <button type="submit" className={`${estiloBotaoSecundario} py-1`}>
        Simular
      </button>
    </form>
  );
}
