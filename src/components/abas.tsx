"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PAINEL, telaPorHref, type Tela } from "@/lib/menu";

// Abas abertas na faixa superior. Cada tela visitada vira uma aba, que fica
// aberta ao trocar de tela e é lembrada no próximo acesso (por navegador).

const CHAVE = "venner.abas";

type ContextoAbas = {
  abas: Tela[];
  ativa: string;
  fechar: (href: string) => void;
};

const Contexto = createContext<ContextoAbas | null>(null);

function lerSalvas(): Tela[] {
  try {
    const hrefs: unknown = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    if (!Array.isArray(hrefs)) return [];
    return hrefs.map((h) => telaPorHref(String(h))).filter((t): t is Tela => !!t);
  } catch {
    return [];
  }
}

function salvar(abas: Tela[]) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(abas.map((a) => a.href)));
  } catch {
    // Sem armazenamento local (janela privada, por exemplo): as abas só não são lembradas.
  }
}

export function AbasProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [abas, setAbas] = useState<Tela[]>([]);

  useEffect(() => {
    setAbas(lerSalvas());
  }, []);

  useEffect(() => {
    const atual = telaPorHref(pathname);
    if (!atual) return;
    setAbas((lista) => {
      if (lista.some((a) => a.href === atual.href)) return lista;
      const nova = [...lista, atual];
      salvar(nova);
      return nova;
    });
  }, [pathname]);

  const fechar = useCallback(
    (href: string) => {
      const i = abas.findIndex((a) => a.href === href);
      if (i < 0) return;
      const nova = abas.filter((a) => a.href !== href);
      setAbas(nova);
      salvar(nova);
      if (href === pathname) {
        const vizinha = nova[i] ?? nova[i - 1] ?? PAINEL;
        router.push(vizinha.href);
      }
    },
    [abas, pathname, router],
  );

  return <Contexto.Provider value={{ abas, ativa: pathname, fechar }}>{children}</Contexto.Provider>;
}

export function useAbas() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useAbas precisa estar dentro de AbasProvider");
  return ctx;
}
