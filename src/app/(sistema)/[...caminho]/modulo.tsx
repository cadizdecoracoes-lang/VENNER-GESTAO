"use client";

import { useCallback } from "react";
import { EmConstrucao } from "@/components/em-construcao";
import { TelaCliente } from "@/components/tela-cliente";
import { SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { MENU, telaPorHref } from "@/lib/menu";
import { notFound } from "@/lib/navegacao";

export function ModuloEmConstrucao({ href }: { href: string }) {
  const montar = useCallback(async () => {
    const tela = telaPorHref(href);
    if (!tela) notFound();
    if (!pode(await carregarAcesso(), tela.codigo, "ver")) return <SemAcesso codigo={tela.codigo} />;
    const grupo = MENU.find((g) => g.telas.includes(tela))?.titulo;
    return <EmConstrucao tela={tela} grupo={grupo} />;
  }, [href]);
  return <TelaCliente montar={montar} />;
}
