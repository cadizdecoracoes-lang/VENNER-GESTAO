"use client";

import { useTransition } from "react";
import { COOKIE_EMPRESA, type EmpresaResumo } from "@/lib/empresa-cookie";
import { revalidatePath } from "@/lib/navegacao";

export type { EmpresaResumo };

const CONSOLIDADO = "";

// Escolhe a empresa (CNPJ) cujos dados as telas mostram, ou o consolidado do grupo.
export function SeletorEmpresa({ empresas, valor }: { empresas: EmpresaResumo[]; valor: string | null }) {
  const [mudando, iniciar] = useTransition();

  function mudar(novo: string) {
    document.cookie = novo
      ? `${COOKIE_EMPRESA}=${novo}; path=/; max-age=31536000; samesite=lax`
      : `${COOKIE_EMPRESA}=; path=/; max-age=0; samesite=lax`;
    iniciar(() => revalidatePath());
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-texto-suave">Empresa</span>
      <select
        value={valor ?? CONSOLIDADO}
        disabled={mudando}
        onChange={(e) => mudar(e.target.value)}
        className="rounded-lg border border-borda bg-superficie px-2 py-1 outline-none focus:border-primaria disabled:opacity-60"
      >
        <option value={CONSOLIDADO}>Grupo (consolidado)</option>
        {empresas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
