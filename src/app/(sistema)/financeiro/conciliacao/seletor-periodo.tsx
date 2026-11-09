"use client";

import { useRouter } from "next/navigation";
import { somarDias } from "@/lib/datas";

// Período da conciliação, na linha dos filtros: um dia (com ‹ › para andar),
// um período (de / até) ou tudo. Ao mudar, a lista atualiza sozinha e os
// outros filtros (conta, situação) ficam.
export function SeletorPeriodo({
  modo,
  dia,
  de,
  ate,
  parametros,
}: {
  modo: "dia" | "periodo" | "tudo";
  dia: string;
  de: string;
  ate: string;
  parametros: Record<string, string>;
}) {
  const router = useRouter();
  const ir = (extra: Record<string, string>) => router.push(`?${new URLSearchParams({ ...parametros, ...extra }).toString()}`);
  const valida = (v: string) => /^(19|2\d)\d{2}-\d{2}-\d{2}$/.test(v);
  const seg = (ativo: boolean) =>
    `px-2 py-0.5 text-sm ${ativo ? "bg-texto font-medium text-white" : "bg-superficie text-texto-suave hover:text-texto"}`;
  const campo = "rounded-md border border-borda bg-superficie px-1.5 py-0.5 text-sm";
  const seta = "rounded-md border border-borda bg-superficie px-1.5 py-0.5 text-sm text-texto-suave hover:text-texto";
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex overflow-hidden rounded-md border border-borda">
        <button type="button" className={seg(modo === "dia")} onClick={() => ir({ dia })}>
          Dia
        </button>
        <button type="button" className={seg(modo === "periodo")} onClick={() => ir({ de, ate })}>
          Período
        </button>
        <button type="button" className={seg(modo === "tudo")} onClick={() => ir({ tudo: "1" })} title="Todas as datas">
          Tudo
        </button>
      </span>
      {modo === "dia" && (
        <>
          <button type="button" className={seta} aria-label="Dia anterior" onClick={() => ir({ dia: somarDias(dia, -1) })}>
            ‹
          </button>
          <input
            type="date"
            value={dia}
            aria-label="Dia"
            onChange={(e) => valida(e.target.value) && ir({ dia: e.target.value })}
            className={campo}
          />
          <button type="button" className={seta} aria-label="Próximo dia" onClick={() => ir({ dia: somarDias(dia, 1) })}>
            ›
          </button>
        </>
      )}
      {modo === "periodo" && (
        <>
          <input
            type="date"
            value={de}
            aria-label="De"
            onChange={(e) => valida(e.target.value) && ir({ de: e.target.value, ate: e.target.value > ate ? e.target.value : ate })}
            className={campo}
          />
          <span className="text-xs text-texto-suave">até</span>
          <input
            type="date"
            value={ate}
            aria-label="Até"
            onChange={(e) => valida(e.target.value) && ir({ de: e.target.value < de ? e.target.value : de, ate: e.target.value })}
            className={campo}
          />
        </>
      )}
    </span>
  );
}
