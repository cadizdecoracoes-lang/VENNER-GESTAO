"use client";

import { useRouter } from "next/navigation";

// Conta bancária da conciliação, na linha do título. Mostra quantas linhas
// faltam conciliar em cada conta; ao escolher, troca o ?conta= do endereço.
export function SeletorConta({ contas, atual }: { contas: { id: string; nome: string; pendentes: number }[]; atual: string | null }) {
  const router = useRouter();
  return (
    <select
      aria-label="Conta bancária"
      title="Conta bancária"
      value={atual ?? ""}
      onChange={(e) => router.push(`?${new URLSearchParams({ conta: e.target.value }).toString()}`)}
      className="max-w-72 rounded-lg border border-borda bg-superficie px-2 py-1 text-sm outline-none focus:border-primaria"
    >
      {contas.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nome}
          {c.pendentes ? ` · ${c.pendentes} pendente(s)` : ""}
        </option>
      ))}
    </select>
  );
}
