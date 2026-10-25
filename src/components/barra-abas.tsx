"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useAbas } from "./abas";

export function BarraAbas() {
  const { abas, ativa, fechar } = useAbas();

  return (
    <div className="flex min-w-0 flex-1 items-end gap-0.5 self-stretch overflow-x-auto [scrollbar-width:thin]">
      {abas.map((aba) => {
        const eAtiva = aba.href === ativa;
        return (
          <div
            key={aba.href}
            className={`group flex min-w-28 shrink items-center gap-1 rounded-t-lg border border-b-0 px-2.5 py-1 text-[13px] ${
              eAtiva ? "border-borda bg-fundo font-medium text-texto" : "border-transparent text-texto-suave hover:bg-fundo/60"
            }`}
          >
            <Link href={aba.href} className="min-w-0 max-w-44 truncate" title={aba.titulo}>
              {aba.titulo}
            </Link>
            <button
              onClick={() => fechar(aba.href)}
              className="shrink-0 rounded p-0.5 text-texto-suave hover:bg-borda hover:text-texto"
              aria-label={`Fechar ${aba.titulo}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
