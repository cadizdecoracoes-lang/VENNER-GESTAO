import { Construction } from "lucide-react";
import type { Tela } from "@/lib/menu";

export function EmConstrucao({ tela, grupo }: { tela: Tela; grupo?: string }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {grupo && <span className="text-xs text-texto-suave">{grupo} /</span>}
        <h1 className="text-lg font-semibold leading-tight" title={tela.descricao}>
          {tela.titulo}
        </h1>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-superficie p-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)] text-texto-suave">
        <Construction size={20} />
        <span>Esta tela será construída numa próxima etapa do plano.</span>
      </div>
    </div>
  );
}
