"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState } from "react";
import { estiloBotao } from "@/components/ui";
import { formatarMoeda } from "@/lib/formato";

// Marcar várias linhas pendentes do extrato na lista para conciliar juntas
// (ex.: um título recebido em duas entradas em dias diferentes). A escolha
// fica só nesta tela; ao clicar em "Conciliar juntas" as linhas vão para o
// endereço (?linha=id1,id2) e o painel de resolver abre com todas.
type Selecao = { marcadas: Set<string>; alternar: (id: string) => void; limpar: () => void };
const Contexto = createContext<Selecao | null>(null);

export function SelecaoLinhas({ children }: { children: React.ReactNode }) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const valor = useMemo<Selecao>(
    () => ({
      marcadas,
      alternar: (id) =>
        setMarcadas((m) => {
          const n = new Set(m);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        }),
      limpar: () => setMarcadas(new Set()),
    }),
    [marcadas],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function MarcarLinha({ id }: { id: string }) {
  const s = useContext(Contexto);
  if (!s) return null;
  return <input type="checkbox" checked={s.marcadas.has(id)} onChange={() => s.alternar(id)} aria-label="Marcar para conciliar junto" />;
}

// Faixa fina que aparece com 2 ou mais linhas marcadas. `pendentes`: linhas
// pendentes na tela (id → valor), para somar só as que ainda estão pendentes.
export function BarraSelecao({ pendentes, link }: { pendentes: Record<string, number>; link: (ids: string[]) => string }) {
  const s = useContext(Contexto);
  if (!s) return null;
  const ids = [...s.marcadas].filter((id) => id in pendentes);
  if (ids.length < 2) return null;
  const soma = ids.reduce((t, id) => t + pendentes[id], 0);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-primaria-suave/60 px-3 py-1.5 text-sm">
      <span>
        <strong>{ids.length}</strong> lançamentos marcados · <strong className="tabular-nums">{formatarMoeda(soma)}</strong>
      </span>
      <Link href={link(ids)} onClick={s.limpar} className={`${estiloBotao} py-1`}>
        Conciliar juntas com títulos
      </Link>
      <button type="button" onClick={s.limpar} className="text-sm text-texto-suave hover:underline">
        Desmarcar
      </button>
    </div>
  );
}
