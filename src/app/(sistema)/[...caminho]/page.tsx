import { notFound } from "next/navigation";
import { EmConstrucao } from "@/components/em-construcao";
import { SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { MENU, telaPorHref } from "@/lib/menu";

export default async function PaginaModulo({ params }: { params: Promise<{ caminho: string[] }> }) {
  const { caminho } = await params;
  const href = "/" + caminho.join("/");
  const tela = telaPorHref(href);
  if (!tela) notFound();
  if (!pode(await carregarAcesso(), tela.codigo, "ver")) return <SemAcesso codigo={tela.codigo} />;
  const grupo = MENU.find((g) => g.telas.includes(tela))?.titulo;
  return <EmConstrucao tela={tela} grupo={grupo} />;
}
