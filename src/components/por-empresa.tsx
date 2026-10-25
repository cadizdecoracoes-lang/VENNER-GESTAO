import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatarMoeda } from "@/lib/formato";

// Quadro do consolidado: uma linha por empresa (CNPJ) e o total do grupo. Cada
// valor abre a lista daquela empresa já filtrada. Fica recolhido, numa linha,
// para a lista de lançamentos continuar no alto da tela.
export type LinhaEmpresa = { id: string; nome: string; valores: number[]; quantidades: number[] };

export function ResumoPorEmpresa({
  colunas,
  linhas,
  caminho,
  filtros,
  fonte,
  extra = "",
}: {
  colunas: string[];
  linhas: LinhaEmpresa[];
  // Tela de destino e o filtro de situação de cada coluna (ex.: "vencido").
  caminho: string;
  filtros: string[];
  fonte: string;
  // Período em uso, para os links abrirem o mesmo recorte (ex.: "&de=...&ate=...&por=...").
  extra?: string;
}) {
  const total = colunas.map((_, i) => linhas.reduce((s, l) => s + l.valores[i], 0));
  const qtdTotal = colunas.map((_, i) => linhas.reduce((s, l) => s + l.quantidades[i], 0));
  const abrir = (empresa: string, i: number) =>
    `/empresa/escolher?id=${empresa}&volta=${encodeURIComponent(`${caminho}?situacao=${filtros[i]}${extra}`)}`;
  return (
    <details className="group rounded-xl bg-superficie shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-xs text-texto-suave hover:text-texto [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
        Ver por empresa ({linhas.length})
      </summary>
      <div className="overflow-x-auto px-3 pb-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-texto-suave">
              <th className="pb-1 font-medium">Empresa</th>
              {colunas.map((c) => (
                <th key={c} className="pb-1 text-right font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-borda/70">
            {linhas.map((l) => (
              <tr key={l.id}>
                <td className="py-1">
                  <Link
                    href={`/empresa/escolher?id=${l.id}&volta=${encodeURIComponent(extra ? `${caminho}?${extra.slice(1)}` : caminho)}`}
                    className="hover:underline"
                  >
                    {l.nome}
                  </Link>
                </td>
                {l.valores.map((v, i) => (
                  <td key={i} className="py-1 text-right tabular-nums">
                    {l.quantidades[i] > 0 ? (
                      <Link href={abrir(l.id, i)} className="text-primaria hover:underline">
                        {formatarMoeda(v)}
                      </Link>
                    ) : (
                      <span className="text-texto-suave">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-1">Grupo (consolidado)</td>
              {total.map((v, i) => (
                <td key={i} className="py-1 text-right tabular-nums">
                  {qtdTotal[i] > 0 ? (
                    <Link href={`${caminho}?situacao=${filtros[i]}${extra}`} className="hover:underline">
                      {formatarMoeda(v)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-3 pb-2 text-xs leading-relaxed text-texto-suave">{fonte} Clique numa empresa para ver só os títulos dela.</p>
    </details>
  );
}
