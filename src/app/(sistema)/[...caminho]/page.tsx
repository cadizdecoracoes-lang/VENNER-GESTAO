import { existsSync } from "node:fs";
import { join } from "node:path";
import { TODAS_TELAS } from "@/lib/menu";
import { ModuloEmConstrucao } from "./modulo";

// Telas do menu que ainda não existem: a página "em construção" de cada uma é
// gerada na publicação (o site é estático).
export function generateStaticParams() {
  return TODAS_TELAS.filter((t) => t.href !== "/" && !existsSync(join(process.cwd(), "src/app/(sistema)", t.href, "page.tsx"))).map(
    (t) => ({ caminho: t.href.slice(1).split("/") }),
  );
}

export default async function PaginaModulo({ params }: { params: Promise<{ caminho: string[] }> }) {
  const { caminho } = await params;
  return <ModuloEmConstrucao href={"/" + caminho.join("/")} />;
}
