"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ICONE_PAINEL, MENU, PAINEL } from "@/lib/menu";

// `telas`: códigos que o perfil pode ver; null mostra tudo (modo de demonstração).
export function MenuLateral({ telas }: { telas: string[] | null }) {
  const pathname = usePathname();
  const menu =
    telas === null
      ? MENU
      : MENU.map((g) => ({ ...g, telas: g.telas.filter((t) => telas.includes(t.codigo)) })).filter((g) => g.telas.length > 0);
  const [recolhido, setRecolhido] = useState(false);
  const grupoAtual = MENU.find((g) => g.telas.some((t) => t.href === pathname))?.codigo;
  const [abertos, setAbertos] = useState<Set<string>>(new Set(grupoAtual ? [grupoAtual] : ["producao"]));

  // Ao abrir uma tela pela aba, o grupo dela se abre no menu.
  useEffect(() => {
    if (grupoAtual) setAbertos((s) => (s.has(grupoAtual) ? s : new Set(s).add(grupoAtual)));
  }, [grupoAtual]);

  function alternar(codigo: string) {
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(codigo)) n.delete(codigo);
      else n.add(codigo);
      return n;
    });
  }

  const item = (ativo: boolean) =>
    `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
      ativo ? "bg-primaria-suave font-medium text-primaria" : "text-texto hover:bg-white/70"
    }`;

  return (
    <aside className={`flex shrink-0 flex-col border-r border-borda/60 bg-lateral transition-[width] ${recolhido ? "w-16" : "w-64"}`}>
      <div className="flex h-14 items-center justify-between px-4">
        {!recolhido && <span className="text-lg font-semibold">Venner</span>}
        <button
          onClick={() => setRecolhido(!recolhido)}
          className="rounded-lg p-1.5 text-texto-suave hover:bg-white/70"
          aria-label={recolhido ? "Expandir menu" : "Recolher menu"}
        >
          {recolhido ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        <Link href={PAINEL.href} className={item(pathname === PAINEL.href)} title={PAINEL.titulo}>
          <ICONE_PAINEL size={18} className="shrink-0" />
          {!recolhido && PAINEL.titulo}
        </Link>

        {menu.map((grupo) => {
          const Icone = grupo.icone;
          const aberto = abertos.has(grupo.codigo);
          return (
            <div key={grupo.codigo} className="pt-2">
              <button
                onClick={() => (recolhido ? setRecolhido(false) : alternar(grupo.codigo))}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-texto-suave hover:bg-white/70"
                title={grupo.titulo}
              >
                <Icone size={18} className="shrink-0" />
                {!recolhido && (
                  <>
                    <span className="flex-1 text-left">{grupo.titulo}</span>
                    <ChevronDown size={14} className={`transition-transform ${aberto ? "" : "-rotate-90"}`} />
                  </>
                )}
              </button>
              {!recolhido && aberto && (
                <div className="mt-1 space-y-0.5 pl-6">
                  {grupo.telas.map((t) => (
                    <Link key={t.codigo} href={t.href} className={item(pathname === t.href)}>
                      {t.titulo}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
