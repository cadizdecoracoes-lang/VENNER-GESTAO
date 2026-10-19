"use client";

import { useEffect, useState } from "react";

export type EmpresaResumo = { id: string; nome: string };

const CHAVE = "venner.empresa";
export const CONSOLIDADO = "grupo";

// Escolhe a empresa (CNPJ) cujos dados as telas mostram, ou o consolidado do grupo.
export function SeletorEmpresa({ empresas }: { empresas: EmpresaResumo[] }) {
  const [valor, setValor] = useState(CONSOLIDADO);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE);
      if (salvo && (salvo === CONSOLIDADO || empresas.some((e) => e.id === salvo))) setValor(salvo);
    } catch {
      // Sem armazenamento local: fica no consolidado.
    }
  }, [empresas]);

  function mudar(novo: string) {
    setValor(novo);
    try {
      localStorage.setItem(CHAVE, novo);
    } catch {}
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-texto-suave">Empresa</span>
      <select
        value={valor}
        onChange={(e) => mudar(e.target.value)}
        className="rounded-lg border border-borda bg-superficie px-2 py-1 outline-none focus:border-primaria"
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
