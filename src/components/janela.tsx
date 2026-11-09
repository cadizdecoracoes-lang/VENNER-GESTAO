"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useEffect } from "react";

// Janela por cima da tela (pagar, editar, histórico...). A lista continua
// atrás, do jeito que estava. `fechar` é o endereço da tela sem a janela.
export function Janela({
  titulo,
  fechar,
  largura = "max-w-2xl",
  children,
}: {
  titulo: React.ReactNode;
  fechar: string;
  largura?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") router.push(fechar, { scroll: false });
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [fechar, router]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-10" role="dialog" aria-modal="true">
      <Link href={fechar} scroll={false} aria-label="Fechar" className="fixed inset-0 cursor-default" tabIndex={-1} />
      <section className={`relative w-full ${largura} rounded-xl bg-superficie shadow-[0_8px_32px_rgba(16,24,40,0.24)]`}>
        <div className="flex items-start justify-between gap-3 border-b border-borda/70 px-4 py-2.5">
          <h2 className="text-sm font-semibold">{titulo}</h2>
          <Link href={fechar} scroll={false} aria-label="Fechar" className="rounded p-0.5 text-texto-suave hover:bg-fundo hover:text-texto">
            <X size={16} />
          </Link>
        </div>
        <div className="p-4">{children}</div>
      </section>
    </div>
  );
}
