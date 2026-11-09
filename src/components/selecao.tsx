"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

// Seleção de várias linhas de uma lista para alterar em massa. As caixas
// ficam nas linhas (<CaixaSelecao id=...>) e a barra de ações aparece quando
// há algo marcado. "Marcar todas" pega só as linhas visíveis no filtro.

type Contexto = {
  marcados: Set<string>;
  trocar: (id: string, ligado: boolean) => void;
  definir: (ids: string[]) => void;
};
const Ctx = createContext<Contexto | null>(null);

export function Selecao({ children }: { children: React.ReactNode }) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const area = useRef<HTMLDivElement>(null);

  // Linha que sumiu da lista (paga, cancelada, filtro do banco) sai da seleção.
  useEffect(() => {
    const ids = new Set([...(area.current?.querySelectorAll<HTMLInputElement>("input[data-selecao]") ?? [])].map((c) => c.value));
    setMarcados((atual) => {
      const resto = [...atual].filter((id) => ids.has(id));
      return resto.length === atual.size ? atual : new Set(resto);
    });
  }, [children]);

  return (
    <Ctx.Provider
      value={{
        marcados,
        trocar: (id, ligado) =>
          setMarcados((atual) => {
            const novo = new Set(atual);
            if (ligado) novo.add(id);
            else novo.delete(id);
            return novo;
          }),
        definir: (ids) => setMarcados(new Set(ids)),
      }}
    >
      <div ref={area} data-selecao-area>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function useSelecao() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSelecao precisa estar dentro de <Selecao>");
  return ctx;
}

export function CaixaSelecao({ id, rotulo }: { id: string; rotulo: string }) {
  const { marcados, trocar } = useSelecao();
  return (
    <input
      type="checkbox"
      data-selecao
      value={id}
      checked={marcados.has(id)}
      onChange={(e) => trocar(id, e.target.checked)}
      aria-label={`Marcar ${rotulo}`}
      className="align-middle"
    />
  );
}

// Caixa do cabeçalho: marca/desmarca todas as linhas visíveis.
export function CaixaTodas() {
  const { marcados, definir } = useSelecao();
  const caixa = useRef<HTMLInputElement>(null);
  const visiveis = () =>
    [...(caixa.current?.closest("[data-selecao-area]")?.querySelectorAll<HTMLInputElement>("input[data-selecao]") ?? [])]
      .filter((c) => !c.closest("tr")?.hidden)
      .map((c) => c.value);
  return (
    <input
      ref={caixa}
      type="checkbox"
      checked={marcados.size > 0}
      onChange={(e) => definir(e.target.checked ? visiveis() : [])}
      aria-label="Marcar todas as linhas visíveis"
      title="Marcar todas as linhas visíveis"
      className="align-middle"
    />
  );
}
