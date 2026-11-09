"use client";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { dataCompleta, intervaloDeDias as dias, intervaloDoMes as mes } from "@/lib/filtro";
import { formatarData } from "@/lib/formato";
import { estiloBotao, estiloCampo } from "./ui";

// Filtro de período das telas financeiras: um botão só ("Período: ...") que
// abre um balão com os atalhos de mês e as datas livres. Vai na URL
// (?de=&ate=&por=), para buscar no banco só o intervalo; os outros filtros do
// endereço (situação etc.) são mantidos.

export type Periodo = { de: string; ate: string; por: string } | null;

export function lerPeriodo(params: { de?: string; ate?: string; por?: string }, campos: string[]): Periodo {
  const data = /^\d{4}-\d{2}-\d{2}$/;
  if (!params.de || !params.ate || !data.test(params.de) || !data.test(params.ate)) return null;
  const [de, ate] = params.de <= params.ate ? [params.de, params.ate] : [params.ate, params.de];
  return { de, ate, por: campos.includes(params.por ?? "") ? params.por! : campos[0] };
}

const LARGURA = 300;

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
  const router = useRouter();
  const busca = useSearchParams();
  const caixa = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  // Balão encostado à direita do botão quando não cabe à esquerda (telas menores).
  const [aDireita, setADireita] = useState(false);
  const [por, setPor] = useState(periodo?.por ?? Object.keys(campos)[0]);
  const [de, setDe] = useState(periodo?.de ?? "");
  const [ate, setAte] = useState(periodo?.ate ?? "");

  useEffect(() => {
    setPor(periodo?.por ?? Object.keys(campos)[0]);
    setDe(periodo?.de ?? "");
    setAte(periodo?.ate ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo?.de, periodo?.ate, periodo?.por]);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  const atalhos = [
    { rotulo: "Mês passado", ...mes(hoje, -1) },
    { rotulo: "Este mês", ...mes(hoje, 0) },
    { rotulo: "Próximo mês", ...mes(hoje, 1) },
    { rotulo: "Próximos 30 dias", ...dias(hoje, 30) },
  ];
  const atalhoAtivo = periodo ? atalhos.find((a) => a.de === periodo.de && a.ate === periodo.ate) : undefined;
  const rotulo = !periodo ? semPeriodo : atalhoAtivo ? atalhoAtivo.rotulo : `${formatarData(periodo.de)} a ${formatarData(periodo.ate)}`;
  const variasDatas = Object.keys(campos).length > 1;

  function ir(p: { de: string; ate: string; por: string } | null) {
    const q = new URLSearchParams(busca.toString());
    for (const k of ["de", "ate", "por"]) q.delete(k);
    if (p) {
      const [a, b] = p.de <= p.ate ? [p.de, p.ate] : [p.ate, p.de];
      q.set("de", a);
      q.set("ate", b);
      q.set("por", p.por);
    }
    setAberto(false);
    router.push(`?${q.toString()}`, { scroll: false });
  }

  const opcao = (marcado: boolean) =>
    `w-full rounded-lg px-2 py-1 text-left text-sm ${marcado ? "bg-primaria-suave font-medium text-primaria" : "hover:bg-fundo"}`;
  const curto = estiloCampo.replace("py-1.5", "py-1");

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => {
          const r = caixa.current?.getBoundingClientRect();
          setADireita(!!r && r.left + LARGURA > window.innerWidth - 16);
          setAberto(!aberto);
        }}
        aria-expanded={aberto}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] ${
          periodo ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-superficie hover:text-texto"
        }`}
      >
        <CalendarDays size={14} />
        <span className="text-texto-suave">Período:</span> {rotulo}
        {periodo && variasDatas && <span className="font-normal opacity-80">({campos[periodo.por]?.toLowerCase()})</span>}
        <ChevronDown size={13} />
      </button>
      {aberto && (
        <div
          style={{ width: LARGURA }}
          className={`absolute top-full z-30 mt-1 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl bg-superficie p-2 shadow-[0_4px_16px_rgba(16,24,40,0.16)] ${aDireita ? "right-0" : "left-0"}`}
        >
          {variasDatas && (
            <label className="block text-xs text-texto-suave">
              Data usada
              <select value={por} onChange={(e) => setPor(e.target.value)} className={`${curto} mt-0.5`}>
                {Object.entries(campos).map(([valor, r]) => (
                  <option key={valor} value={valor}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="space-y-0.5">
            <button type="button" onClick={() => ir(null)} className={opcao(!periodo)}>
              {semPeriodo}
            </button>
            {atalhos.map((a) => (
              <button key={a.rotulo} type="button" onClick={() => ir({ de: a.de, ate: a.ate, por })} className={opcao(atalhoAtivo === a)}>
                {a.rotulo}
                <span className="ml-1 text-xs text-texto-suave">
                  {formatarData(a.de).slice(0, 5)} a {formatarData(a.ate).slice(0, 5)}
                </span>
              </button>
            ))}
          </div>
          <form
            className="space-y-1.5 border-t border-borda/70 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (dataCompleta(de) && dataCompleta(ate)) ir({ de, ate, por });
            }}
          >
            <p className="text-xs text-texto-suave">Outras datas</p>
            <div className="grid grid-cols-2 gap-1.5">
              <input type="date" required value={de} onChange={(e) => setDe(e.target.value)} aria-label="De" className={curto} />
              <input type="date" required value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até" className={curto} />
            </div>
            <button type="submit" className={`${estiloBotao} w-full justify-center py-1`}>
              Aplicar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
