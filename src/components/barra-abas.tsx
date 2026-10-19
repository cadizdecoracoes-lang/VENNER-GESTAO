"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useAbas } from "./abas";

export function BarraAbas() {
  const { abas, ativa, fechar } = useAbas();

  return (
    <div className="flex h-12 items-end gap-1 overflow-x-auto border-b border-borda/70 bg-superficie px-3">
      {abas.map((aba) => {
        const eAtiva = aba.href === ativa;
        return (
          <div
            key={aba.href}
            className={`group flex shrink-0 items-center gap-1 rounded-t-lg border border-b-0 px-3 py-1.5 text-sm ${
              eAtiva ? "border-borda bg-fundo font-medium text-texto" : "border-transparent text-texto-suave hover:bg-fundo/60"
            }`}
          >
            <Link href={aba.href} className="max-w-48 truncate">
              {aba.titulo}
            </Link>
            <button
              onClick={() => fechar(aba.href)}
              className="rounded p-0.5 text-texto-suave hover:bg-borda hover:text-texto"
              aria-label={`Fechar ${aba.titulo}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
