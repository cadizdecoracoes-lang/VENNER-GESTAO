import Link from "next/link";
import { formatarMoeda } from "@/lib/formato";

// Quadro do consolidado: uma linha por empresa (CNPJ) e o total do grupo. Cada
// valor abre a lista daquela empresa já filtrada.
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
    <section className="rounded-2xl bg-superficie px-5 py-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <h2 className="mb-2 font-medium">Por empresa</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-texto-suave">
              <th className="pb-2 font-medium">Empresa</th>
              {colunas.map((c) => (
                <th key={c} className="pb-2 text-right font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-borda/70">
            {linhas.map((l) => (
              <tr key={l.id}>
                <td className="py-2">
                  <Link
                    href={`/empresa/escolher?id=${l.id}&volta=${encodeURIComponent(extra ? `${caminho}?${extra.slice(1)}` : caminho)}`}
                    className="hover:underline"
                  >
                    {l.nome}
                  </Link>
                </td>
                {l.valores.map((v, i) => (
                  <td key={i} className="py-2 text-right tabular-nums">
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
              <td className="py-2">Grupo (consolidado)</td>
              {total.map((v, i) => (
                <td key={i} className="py-2 text-right tabular-nums">
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
      <p className="mt-2 text-xs leading-relaxed text-texto-suave">{fonte} Clique numa empresa para ver só os títulos dela.</p>
    </section>
  );
}
