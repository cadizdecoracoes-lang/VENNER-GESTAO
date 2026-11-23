import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Etiqueta } from "@/components/ui";
import { formatarMoeda } from "@/lib/formato";
import { rotuloMes, type Gravidade, type LinhaMes } from "@/lib/indicadores";

// Peças visuais da tela de Indicadores.

export type Formato = "moeda" | "numero" | "pct" | "dias" | "vezes";

export function formatar(v: number | null | undefined, formato: Formato): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (formato) {
    case "moeda":
      return formatarMoeda(v);
    case "numero":
      return Math.round(v).toLocaleString("pt-BR");
    case "pct":
      return `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "dias":
      return `${Math.round(v)} d`;
    case "vezes":
      return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`;
  }
}

export type LinhaTabelaMes = {
  rotulo: string;
  valor: (m: LinhaMes) => number | null;
  formato?: Formato;
  // "total" = linha em negrito; "sub" = recuada.
  estilo?: "total" | "sub";
  // Média nos meses fechados; por padrão média simples dos meses com valor.
  media?: number | null;
  dica?: string;
  negativoRuim?: boolean;
  href?: (m: LinhaMes) => string | undefined;
};

// Tabela com uma coluna por mês e a média no fim.
export function TabelaMeses({
  meses,
  mesesMedia,
  linhas,
}: {
  meses: LinhaMes[];
  mesesMedia: string[];
  linhas: (LinhaTabelaMes | "separador")[];
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-superficie shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-texto-suave">
            <th className="sticky left-0 border-b border-borda/70 bg-superficie px-3 py-2 text-left font-medium" />
            {meses.map((m) => (
              <th key={m.mes} className="whitespace-nowrap border-b border-borda/70 px-3 py-2 text-right font-medium">
                {rotuloMes(m.mes)}
              </th>
            ))}
            <th
              className="whitespace-nowrap border-b border-borda/70 px-3 py-2 text-right font-medium"
              title={`Média de ${mesesMedia.length} mês(es) fechado(s): ${mesesMedia.map(rotuloMes).join(", ")}`}
            >
              Média/mês
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borda/70">
          {linhas.map((l, i) => {
            if (l === "separador") {
              return (
                <tr key={i}>
                  <td colSpan={meses.length + 2} className="h-1 bg-fundo/60 p-0" />
                </tr>
              );
            }
            const f = l.formato ?? "moeda";
            const base = meses.filter((m) => mesesMedia.includes(m.mes)).map(l.valor).filter((v): v is number => v !== null);
            const media = l.media !== undefined ? l.media : base.length ? base.reduce((s, v) => s + v, 0) / base.length : null;
            const cor = (v: number | null) => (l.negativoRuim && v !== null && v < 0 ? "text-perigo" : "");
            return (
              <tr key={i} className={l.estilo === "total" ? "font-semibold" : ""}>
                <td
                  className={`sticky left-0 whitespace-nowrap bg-superficie px-3 py-1.5 ${l.estilo === "sub" ? "pl-6 text-texto-suave" : ""}`}
                  title={l.dica}
                >
                  {l.rotulo}
                </td>
                {meses.map((m) => {
                  const v = l.valor(m);
                  const href = l.href?.(m);
                  return (
                    <td key={m.mes} className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${cor(v)}`}>
                      {href && v ? (
                        <Link href={href} className="hover:text-primaria hover:underline">
                          {formatar(v, f)}
                        </Link>
                      ) : (
                        formatar(v, f)
                      )}
                    </td>
                  );
                })}
                <td className={`whitespace-nowrap bg-fundo/40 px-3 py-1.5 text-right tabular-nums ${cor(media)}`}>{formatar(media, f)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const COR_GRAVIDADE: Record<Gravidade, { cor: "neutra" | "primaria" | "sucesso" | "alerta"; texto: string; classe?: string }> = {
  critico: { cor: "alerta", texto: "Crítico", classe: "!bg-perigo/10 !text-perigo" },
  atencao: { cor: "alerta", texto: "Atenção" },
  ok: { cor: "sucesso", texto: "Em ordem" },
  sem_dados: { cor: "neutra", texto: "Sem dados" },
};

export function EtiquetaGravidade({ gravidade }: { gravidade: Gravidade }) {
  const g = COR_GRAVIDADE[gravidade];
  return g.classe ? (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${g.classe}`}>{g.texto}</span>
  ) : (
    <Etiqueta cor={g.cor}>{g.texto}</Etiqueta>
  );
}

// Aviso fino de dado que ainda não chega ao sistema.
export function SemDados({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-fundo px-3 py-1.5 text-xs text-texto-suave">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-alerta" />
      <span>{children}</span>
    </p>
  );
}

export function Secao({ titulo, children, dica }: { titulo: string; children: React.ReactNode; dica?: string }) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-sm font-semibold" title={dica}>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

// Barra horizontal fina (proporção de 0 a 1).
export function Barra({ fracao, cor = "bg-primaria" }: { fracao: number; cor?: string }) {
  const w = Math.max(0, Math.min(1, fracao)) * 100;
  return (
    <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-fundo align-middle">
      <span className={`block h-full ${cor}`} style={{ width: `${w}%` }} />
    </span>
  );
}
