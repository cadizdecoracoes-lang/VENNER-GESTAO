"use client";

import { useRouter } from "next/navigation";

// Mês da conciliação: ao escolher, a tela já atualiza (sem botão).
// Vazio = todos os meses.
export function SeletorMes({ mes, parametros }: { mes: string | null; parametros: Record<string, string> }) {
  const router = useRouter();
  const ir = (valor: string) => {
    const p = new URLSearchParams(parametros);
    if (valor) p.set("mes", valor);
    else p.delete("mes");
    router.push(`?${p.toString()}`);
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-texto-suave">Mês</span>
      <input
        type="month"
        value={mes ?? ""}
        onChange={(e) => {
          if (/^(19|2\d)\d{2}-\d{2}$/.test(e.target.value) || e.target.value === "") ir(e.target.value);
        }}
        aria-label="Mês"
        title="Escolha o mês: a lista atualiza sozinha"
        className="rounded-md border border-borda bg-superficie px-2 py-0.5 text-sm"
      />
      {mes ? (
        <button type="button" onClick={() => ir("")} className="text-xs text-primaria hover:underline">
          ver todos os meses
        </button>
      ) : (
        <span className="text-xs text-texto-suave">todos os meses</span>
      )}
    </span>
  );
}
