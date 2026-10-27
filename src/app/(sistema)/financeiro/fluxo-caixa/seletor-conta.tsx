"use client";

import { useRouter } from "next/navigation";

// Conta bancária do fluxo: "todas" ou uma só. Ao escolher, troca o endereço
// (o mesmo ?conta= de antes), mantendo o período.
export function SeletorConta({
  contas,
  atual,
  periodo,
}: {
  contas: { id: string; nome: string }[];
  atual: string | null;
  periodo: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Conta bancária"
      title="Conta bancária"
      value={atual ?? ""}
      onChange={(e) => router.push(`?${new URLSearchParams(e.target.value ? { ...periodo, conta: e.target.value } : periodo).toString()}`)}
      className="max-w-64 rounded-lg border border-borda bg-superficie px-2 py-1 text-sm outline-none focus:border-primaria"
    >
      <option value="">Todas as contas · {contas.length}</option>
      {contas.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nome}
        </option>
      ))}
    </select>
  );
}
