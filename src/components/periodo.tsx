import Link from "next/link";
import { estiloBotaoSecundario, estiloCampo } from "./ui";

// Filtro de período das telas financeiras: atalhos de mês e datas livres.
// Vai na URL (?de=&ate=&por=), para o servidor buscar só o intervalo.

const campoCurto = estiloCampo.replace("w-full", "w-auto") + " py-1.5";

export type Periodo = { de: string; ate: string; por: string } | null;

function mes(hoje: string, deslocamento: number): { de: string; ate: string } {
  const [a, m] = hoje.split("-").map(Number);
  const inicio = new Date(Date.UTC(a, m - 1 + deslocamento, 1));
  const fim = new Date(Date.UTC(a, m + deslocamento, 0));
  return { de: inicio.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10) };
}

function dias(hoje: string, quantidade: number): { de: string; ate: string } {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + quantidade);
  const outro = d.toISOString().slice(0, 10);
  return quantidade >= 0 ? { de: hoje, ate: outro } : { de: outro, ate: hoje };
}

export function lerPeriodo(params: { de?: string; ate?: string; por?: string }, campos: string[]): Periodo {
  const data = /^\d{4}-\d{2}-\d{2}$/;
  if (!params.de || !params.ate || !data.test(params.de) || !data.test(params.ate)) return null;
  const [de, ate] = params.de <= params.ate ? [params.de, params.ate] : [params.ate, params.de];
  return { de, ate, por: campos.includes(params.por ?? "") ? params.por! : campos[0] };
}

export function FiltroPeriodo({
  periodo,
  hoje,
  campos,
  semPeriodo,
}: {
  periodo: Periodo;
  hoje: string;
  // Datas que podem ser filtradas, ex.: { vencimento: "Vencimento", data_pagamento: "Pagamento" }.
  campos: Record<string, string>;
  // O que a tela mostra sem período escolhido.
  semPeriodo: string;
}) {
  const por = periodo?.por ?? Object.keys(campos)[0];
  const atalhos = [
    { rotulo: "Mês passado", ...mes(hoje, -1) },
    { rotulo: "Este mês", ...mes(hoje, 0) },
    { rotulo: "Próximo mês", ...mes(hoje, 1) },
    { rotulo: "Próximos 30 dias", ...dias(hoje, 30) },
  ];
  const ativo = (a: { de: string; ate: string }) => periodo?.de === a.de && periodo?.ate === a.ate;
  const pilula = (marcado: boolean) =>
    `rounded-full px-3 py-1 text-sm transition-colors ${marcado ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-superficie hover:text-texto"}`;

  return (
    <form method="get" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-sm text-texto-suave">Período</span>
      <Link href="?" className={pilula(!periodo)}>
        {semPeriodo}
      </Link>
      {atalhos.map((a) => (
        <Link key={a.rotulo} href={`?de=${a.de}&ate=${a.ate}&por=${por}`} className={pilula(ativo(a))}>
          {a.rotulo}
        </Link>
      ))}
      <span className="flex flex-wrap items-center gap-2">
        {Object.keys(campos).length > 1 && (
          <select name="por" defaultValue={por} aria-label="Data usada no período" className={campoCurto}>
            {Object.entries(campos).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                por {rotulo.toLowerCase()}
              </option>
            ))}
          </select>
        )}
        <input type="date" name="de" required defaultValue={periodo?.de} aria-label="De" className={campoCurto} />
        <span className="text-sm text-texto-suave">até</span>
        <input type="date" name="ate" required defaultValue={periodo?.ate} aria-label="Até" className={campoCurto} />
        <button type="submit" className={`${estiloBotaoSecundario} py-1.5`}>
          Aplicar
        </button>
      </span>
    </form>
  );
}
