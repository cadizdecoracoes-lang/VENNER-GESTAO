"use client";

import { Printer } from "lucide-react";
import { estiloBotao } from "@/components/ui";

export function BotaoImprimir() {
  return (
    <button type="button" onClick={() => window.print()} className={`${estiloBotao} print:hidden`}>
      <Printer size={16} /> Imprimir ou salvar em PDF
    </button>
  );
}
