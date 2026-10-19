import { Construction } from "lucide-react";
import type { Tela } from "@/lib/menu";

export function EmConstrucao({ tela, grupo }: { tela: Tela; grupo?: string }) {
  return (
    <div className="space-y-6">
      <div>
        {grupo && <p className="text-sm text-texto-suave">{grupo}</p>}
        <h1 className="text-2xl font-semibold">{tela.titulo}</h1>
        <p className="mt-1 text-texto-suave">{tela.descricao}</p>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-borda bg-superficie p-6 text-texto-suave">
        <Construction size={20} />
        <span>Esta tela será construída numa próxima etapa do plano.</span>
      </div>
    </div>
  );
}
