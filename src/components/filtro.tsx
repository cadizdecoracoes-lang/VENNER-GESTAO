"use client";

import { CalendarDays, Columns3, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { hojeBrasil } from "@/lib/datas";
import {
  contem,
  dataDaCelula,
  intervaloDeDias,
  intervaloDoMes,
  juntarColunas,
  montarColunas,
  normalizar,
  sugerir,
  type ColunaFiltro,
} from "@/lib/filtro";
import { formatarData } from "@/lib/formato";

// Filtro inteligente das listas, o mesmo em todas as telas:
// - busca instantânea em todas as colunas (sem acento, várias palavras,
//   CNPJ/CPF com ou sem pontuação); a partir de duas letras sugere os
//   cadastros da lista (fornecedor, cliente, item...) e, ao escolher um, filtra
//   só aquela coluna;
// - "Colunas": filtra por qualquer coluna da lista, escolhendo os valores;
// - "Período": nas listas com coluna de data e sem período próprio da tela;
// - atalhos por grupo (situação, tipo...): cada <tr> pode trazer
//   data-tags="ativo materia_prima".
// Lê as tabelas já desenhadas (título das colunas e texto principal de cada
// célula, sem os complementos em letra pequena). Uma célula pode trazer
// data-valor="..." para dizer qual é o seu valor no filtro.

export type GrupoAtalho = { rotulo: string; opcoes: { valor: string; rotulo: string }[] };

// Situações com número: uma faixa fina acima da lista que é, ao mesmo tempo, o
// resumo (valor e quantidade) e o filtro. Substitui os cartões de resumo.
export type OpcaoSituacao = {
  valor: string;
  rotulo: string;
  total?: string;
  quantidade?: number;
  cor?: "perigo" | "sucesso" | "alerta";
  // De onde vem o número; aparece ao passar o mouse.
  dica?: string;
};
export type GrupoSituacao = { rotulo: string; opcoes: OpcaoSituacao[] };

const COR_SITUACAO = { perigo: "text-perigo", sucesso: "text-sucesso", alerta: "text-alerta" };

type PeriodoLocal = { coluna: string; de: string; ate: string };

const estiloPilula = (marcado: boolean) =>
  `inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] transition-colors ${
    marcado ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-superficie hover:text-texto"
  }`;
const estiloBalao =
  "absolute top-full z-30 mt-1 rounded-xl bg-superficie p-2 text-sm shadow-[0_4px_16px_rgba(16,24,40,0.14)]";
const estiloCampoCurto =
  "rounded-lg border border-borda bg-superficie px-2 py-1 text-sm outline-none focus:border-primaria";

const PEQUENO = ".text-xs, .text-\\[11px\\], .text-\\[10px\\], [data-filtro-ignorar]";

// Texto principal da célula: sem etiquetas e complementos em letra pequena.
function textoPrincipal(celula: HTMLTableCellElement): string {
  if (celula.dataset.valor !== undefined) return celula.dataset.valor;
  const partes: string[] = [];
  const andar = document.createTreeWalker(celula, NodeFilter.SHOW_TEXT);
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const pequeno = n.parentElement?.closest(PEQUENO);
    if (pequeno && pequeno !== celula && celula.contains(pequeno)) continue;
    partes.push(n.textContent ?? "");
  }
  const texto = partes.join("").replace(/\s+/g, " ").trim().replace(/^[·•]\s*|\s*[·•]$/g, "");
  return texto || (celula.textContent ?? "").replace(/\s+/g, " ").trim();
}

type TabelaLida = { rotulos: string[]; linhas: { tr: HTMLTableRowElement; celulas: string[] }[] };

function lerTabelas(raiz: HTMLElement): TabelaLida[] {
  return [...raiz.querySelectorAll("table")].map((tabela) => {
    const rotulos = [...(tabela.tHead?.rows[0]?.cells ?? [])].map((c) => (c.textContent ?? "").trim());
    const linhas = [...tabela.tBodies]
      .flatMap((corpo) => [...corpo.rows])
      .filter((tr) => !tr.hasAttribute("data-vazio"))
      .map((tr) => ({ tr, celulas: [...tr.cells].map(textoPrincipal) }));
    return { rotulos, linhas };
  });
}

export function Filtro({
  children,
  atalhos = [],
  situacoes,
  ferramentas,
  placeholder = "Filtrar por qualquer informação da lista",
  iniciais = {},
  periodo = true,
}: {
  children: React.ReactNode;
  atalhos?: GrupoAtalho[];
  situacoes?: GrupoSituacao;
  // Controles extras na mesma linha da busca (ex.: o período da tela).
  ferramentas?: React.ReactNode;
  placeholder?: string;
  // Atalho já marcado ao abrir (ex.: vindo de um número do painel): { Situação: "vencido" }.
  iniciais?: Record<string, string>;
  // false nas telas que já têm período próprio (FiltroPeriodo, que busca no banco).
  periodo?: boolean;
}) {
  const area = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const barra = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState("");
  const [escolhas, setEscolhas] = useState<Record<string, string>>(iniciais);
  const [porColuna, setPorColuna] = useState<Record<string, string[]>>({});
  const [periodoLocal, setPeriodoLocal] = useState<PeriodoLocal | null>(null);
  const [colunas, setColunas] = useState<ColunaFiltro[]>([]);
  const [contagem, setContagem] = useState<{ visiveis: number; total: number } | null>(null);
  // Qual balão está aberto: sugestões da busca, colunas ou período.
  const [aberto, setAberto] = useState<"sugestoes" | "colunas" | "periodo" | null>(null);
  const [destaque, setDestaque] = useState(-1);

  useEffect(() => {
    const raiz = area.current;
    if (!raiz) return;
    const tabelas = lerTabelas(raiz);
    setColunas(juntarColunas(tabelas.map((t) => montarColunas(t.rotulos, t.linhas.map((l) => l.celulas)))));

    const termos = normalizar(texto).split(" ").filter(Boolean);
    const exigidas = Object.values(escolhas).filter(Boolean);
    const filtrosColuna = Object.entries(porColuna)
      .filter(([, valores]) => valores.length > 0)
      .map(([rotulo, valores]) => ({ rotulo, valores: new Set(valores.map(normalizar)) }));
    let visiveis = 0;
    let total = 0;
    for (const { rotulos, linhas } of tabelas) {
      const indice = (rotulo: string) => rotulos.indexOf(rotulo);
      for (const { tr, celulas } of linhas) {
        total++;
        const tudo = tr.textContent ?? "";
        const tags = (tr.dataset.tags ?? "").split(" ");
        let passa = termos.every((t) => contem(tudo, t)) && exigidas.every((e) => tags.includes(e));
        for (const f of filtrosColuna) {
          if (!passa) break;
          const i = indice(f.rotulo);
          passa = i >= 0 && f.valores.has(normalizar(celulas[i] ?? ""));
        }
        if (passa && periodoLocal) {
          const i = indice(periodoLocal.coluna);
          const data = i >= 0 ? dataDaCelula(celulas[i] ?? "") : null;
          passa = data !== null && data >= periodoLocal.de && data <= periodoLocal.ate;
        }
        tr.hidden = !passa;
        if (passa) visiveis++;
      }
    }
    // Blocos (ex.: um por empresa) somem quando nenhuma linha deles passa.
    for (const bloco of raiz.querySelectorAll<HTMLElement>("[data-bloco-filtro]")) {
      bloco.hidden = !bloco.querySelector("tbody tr:not([data-vazio]):not([hidden])");
    }
    setContagem({ visiveis, total });
  }, [texto, escolhas, porColuna, periodoLocal, children]);

  // Atalho de teclado: "/" vai para o filtro.
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName)) {
        e.preventDefault();
        campo.current?.focus();
      }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  // Clique fora fecha o balão aberto.
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (!barra.current?.contains(e.target as Node)) setAberto(null);
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  const sugestoes = useMemo(() => sugerir(colunas, texto), [colunas, texto]);
  const colunasTexto = colunas.filter((c) => c.tipo === "texto" && c.valores.length > 1);
  const colunasData = colunas.filter((c) => c.tipo === "data" && c.valores.length > 0);
  const mostrarPeriodo = periodo && colunasData.length > 0;

  const marcarValor = (coluna: string, valor: string, ligado: boolean) =>
    setPorColuna((atual) => {
      const valores = (atual[coluna] ?? []).filter((v) => v !== valor);
      return { ...atual, [coluna]: ligado ? [...valores, valor] : valores };
    });

  function escolherSugestao(i: number) {
    const s = sugestoes[i];
    if (!s) return;
    marcarValor(s.coluna, s.valor, true);
    setTexto("");
    setAberto(null);
    setDestaque(-1);
  }

  function limparTudo() {
    setTexto("");
    setEscolhas({});
    setPorColuna({});
    setPeriodoLocal(null);
  }

  const chips = Object.entries(porColuna).flatMap(([coluna, valores]) => valores.map((valor) => ({ coluna, valor })));
  const filtrando =
    texto.trim() !== "" || Object.values(escolhas).some(Boolean) || chips.length > 0 || periodoLocal !== null;
  const situacaoAtual = situacoes ? (escolhas[situacoes.rotulo] ?? "") : "";

  return (
    <div className="space-y-2">
      {situacoes && (
        <div
          role="group"
          aria-label={situacoes.rotulo}
          className="flex overflow-x-auto rounded-xl bg-superficie shadow-[0_1px_3px_rgba(16,24,40,0.06)] [scrollbar-width:thin]"
        >
          {situacoes.opcoes.map((o) => {
            const ativo = situacaoAtual === o.valor;
            return (
              <button
                key={o.valor || "todas"}
                type="button"
                title={o.dica}
                aria-pressed={ativo}
                onClick={() => setEscolhas((atual) => ({ ...atual, [situacoes.rotulo]: o.valor }))}
                className={`min-w-28 flex-1 border-b-2 px-3 py-1.5 text-left transition-colors first:rounded-l-xl last:rounded-r-xl ${
                  ativo ? "border-primaria bg-primaria-suave/60" : "border-transparent hover:bg-fundo"
                }`}
              >
                <span className={`block truncate text-xs ${ativo ? "font-medium text-primaria" : "text-texto-suave"}`}>
                  {o.rotulo}
                  {o.quantidade !== undefined && <span className="ml-1 tabular-nums opacity-80">({o.quantidade})</span>}
                </span>
                {o.total !== undefined && (
                  <span className={`block whitespace-nowrap text-sm font-semibold tabular-nums ${o.cor && o.quantidade ? COR_SITUACAO[o.cor] : ""}`}>
                    {o.total}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div ref={barra} className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-full max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-suave" />
          <input
            ref={campo}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setAberto("sugestoes");
              setDestaque(-1);
            }}
            onFocus={() => setAberto("sugestoes")}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setAberto("sugestoes");
                const passo = e.key === "ArrowDown" ? 1 : -1;
                setDestaque((d) => Math.max(-1, Math.min(sugestoes.length - 1, d + passo)));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (destaque >= 0) escolherSugestao(destaque);
                else setAberto(null);
              } else if (e.key === "Escape") {
                setAberto(null);
              }
            }}
            placeholder={placeholder}
            aria-label="Filtrar lista"
            aria-autocomplete="list"
            aria-expanded={aberto === "sugestoes" && sugestoes.length > 0}
            className="w-full rounded-lg bg-superficie py-1.5 pl-9 pr-8 text-sm shadow-[0_0_0_1px_var(--color-borda)] outline-none placeholder:text-texto-suave/70 focus:shadow-[0_0_0_1.5px_var(--color-primaria)]"
          />
          {texto && (
            <button
              type="button"
              onClick={() => setTexto("")}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-texto-suave hover:text-texto"
            >
              <X size={14} />
            </button>
          )}
          {aberto === "sugestoes" && sugestoes.length > 0 && (
            <ul role="listbox" className={`${estiloBalao} left-0 w-[min(28rem,90vw)] p-1`}>
              {sugestoes.map((s, i) => (
                <li key={`${s.coluna}|${s.valor}`} role="option" aria-selected={i === destaque}>
                  <button
                    type="button"
                    onMouseEnter={() => setDestaque(i)}
                    onClick={() => escolherSugestao(i)}
                    className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1 text-left ${
                      i === destaque ? "bg-primaria-suave" : ""
                    }`}
                  >
                    <span className="truncate">{s.valor}</span>
                    <span className="shrink-0 text-xs text-texto-suave">
                      {s.coluna} · {s.quantidade}
                    </span>
                  </button>
                </li>
              ))}
              <li className="px-2 pb-0.5 pt-1 text-[11px] text-texto-suave">
                Escolha um para filtrar só essa coluna; Enter filtra pelo texto em todas.
              </li>
            </ul>
          )}
        </div>
        {atalhos.map((g) => (
          <div key={g.rotulo} className="flex items-center gap-0.5" role="group" aria-label={g.rotulo}>
            <span className="mr-1 text-xs text-texto-suave">{g.rotulo}</span>
            {[{ valor: "", rotulo: "Todos" }, ...g.opcoes].map((o) => (
              <button
                key={o.valor || "todos"}
                type="button"
                onClick={() => setEscolhas((atual) => ({ ...atual, [g.rotulo]: o.valor }))}
                className={estiloPilula((escolhas[g.rotulo] ?? "") === o.valor)}
              >
                {o.rotulo}
              </button>
            ))}
          </div>
        ))}
        {ferramentas}
        {mostrarPeriodo && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAberto(aberto === "periodo" ? null : "periodo")}
              className={estiloPilula(periodoLocal !== null)}
            >
              <CalendarDays size={14} />
              {periodoLocal ? `${formatarData(periodoLocal.de)} a ${formatarData(periodoLocal.ate)}` : "Período"}
            </button>
            {aberto === "periodo" && (
              <BalaoPeriodo
                colunas={colunasData.map((c) => c.rotulo)}
                atual={periodoLocal}
                aplicar={(p) => {
                  setPeriodoLocal(p);
                  setAberto(null);
                }}
              />
            )}
          </div>
        )}
        {colunasTexto.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAberto(aberto === "colunas" ? null : "colunas")}
              className={estiloPilula(chips.length > 0)}
            >
              <Columns3 size={14} />
              Colunas
            </button>
            {aberto === "colunas" && (
              <BalaoColunas colunas={colunasTexto} marcados={porColuna} marcar={marcarValor} />
            )}
          </div>
        )}
        {contagem && contagem.total > 0 && (
          <span className="ml-auto text-xs text-texto-suave">
            {filtrando
              ? `${contagem.visiveis} de ${contagem.total}`
              : `${contagem.total} ${contagem.total === 1 ? "registro" : "registros"}`}
          </span>
        )}
      </div>
      {(chips.length > 0 || periodoLocal) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {periodoLocal && (
            <Chip rotulo={`${periodoLocal.coluna}: ${formatarData(periodoLocal.de)} a ${formatarData(periodoLocal.ate)}`} tirar={() => setPeriodoLocal(null)} />
          )}
          {chips.map((c) => (
            <Chip key={`${c.coluna}|${c.valor}`} rotulo={`${c.coluna}: ${c.valor}`} tirar={() => marcarValor(c.coluna, c.valor, false)} />
          ))}
          <button type="button" onClick={limparTudo} className="px-1 text-primaria hover:underline">
            Limpar filtros
          </button>
        </div>
      )}
      <div ref={area}>{children}</div>
      {filtrando && contagem?.visiveis === 0 && contagem.total > 0 && (
        <p className="py-6 text-center text-sm text-texto-suave">
          Nada encontrado com esse filtro.{" "}
          <button type="button" className="text-primaria hover:underline" onClick={limparTudo}>
            Limpar filtro
          </button>
        </p>
      )}
    </div>
  );
}

function Chip({ rotulo, tirar }: { rotulo: string; tirar: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-primaria-suave py-0.5 pl-2.5 pr-1 text-primaria">
      <span className="truncate">{rotulo}</span>
      <button type="button" onClick={tirar} aria-label={`Tirar filtro ${rotulo}`} className="rounded-full p-0.5 hover:bg-primaria/10">
        <X size={12} />
      </button>
    </span>
  );
}

// Escolhe a coluna e marca os valores que devem aparecer.
function BalaoColunas({
  colunas,
  marcados,
  marcar,
}: {
  colunas: ColunaFiltro[];
  marcados: Record<string, string[]>;
  marcar: (coluna: string, valor: string, ligado: boolean) => void;
}) {
  const [coluna, setColuna] = useState(colunas[0].rotulo);
  const [busca, setBusca] = useState("");
  const atual = colunas.find((c) => c.rotulo === coluna) ?? colunas[0];
  const valores = atual.valores.filter(([v]) => !busca || contem(v, busca));
  return (
    <div className={`${estiloBalao} right-0 flex w-[min(30rem,92vw)] gap-2`}>
      <ul className="max-h-72 w-36 shrink-0 overflow-y-auto border-r border-borda/70 pr-1">
        {colunas.map((c) => {
          const quantos = marcados[c.rotulo]?.length ?? 0;
          return (
            <li key={c.rotulo}>
              <button
                type="button"
                onClick={() => {
                  setColuna(c.rotulo);
                  setBusca("");
                }}
                className={`flex w-full justify-between gap-1 rounded-lg px-2 py-1 text-left ${
                  c.rotulo === atual.rotulo ? "bg-primaria-suave font-medium text-primaria" : "hover:bg-fundo"
                }`}
              >
                <span className="truncate">{c.rotulo}</span>
                {quantos > 0 && <span className="text-xs">{quantos}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-w-0 flex-1 space-y-1">
        <input
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={`Procurar em ${atual.rotulo.toLowerCase()}`}
          className={`${estiloCampoCurto} w-full`}
        />
        <ul className="max-h-60 overflow-y-auto">
          {valores.slice(0, 300).map(([valor, quantidade]) => {
            const ligado = marcados[atual.rotulo]?.includes(valor) ?? false;
            return (
              <li key={valor}>
                <label className="flex cursor-pointer items-baseline gap-2 rounded-lg px-1.5 py-0.5 hover:bg-fundo">
                  <input
                    type="checkbox"
                    checked={ligado}
                    onChange={(e) => marcar(atual.rotulo, valor, e.target.checked)}
                    className="translate-y-0.5"
                  />
                  <span className="min-w-0 flex-1 truncate">{valor}</span>
                  <span className="text-xs tabular-nums text-texto-suave">{quantidade}</span>
                </label>
              </li>
            );
          })}
          {valores.length === 0 && <li className="px-1.5 py-1 text-texto-suave">Nada com esse texto.</li>}
          {valores.length > 300 && (
            <li className="px-1.5 py-1 text-xs text-texto-suave">Mostrando 300 de {valores.length}; digite para achar os outros.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// Período sobre uma coluna de data da própria lista.
function BalaoPeriodo({
  colunas,
  atual,
  aplicar,
}: {
  colunas: string[];
  atual: PeriodoLocal | null;
  aplicar: (p: PeriodoLocal | null) => void;
}) {
  const hoje = hojeBrasil();
  const [coluna, setColuna] = useState(atual?.coluna ?? colunas[0]);
  const [de, setDe] = useState(atual?.de ?? "");
  const [ate, setAte] = useState(atual?.ate ?? "");
  const atalhos = [
    { rotulo: "Este mês", ...intervaloDoMes(hoje, 0) },
    { rotulo: "Mês passado", ...intervaloDoMes(hoje, -1) },
    { rotulo: "Últimos 30 dias", ...intervaloDeDias(hoje, -30) },
    { rotulo: "Próximos 30 dias", ...intervaloDeDias(hoje, 30) },
  ];
  return (
    <div className={`${estiloBalao} right-0 w-max max-w-[92vw] space-y-2`}>
      {colunas.length > 1 && (
        <select value={coluna} onChange={(e) => setColuna(e.target.value)} aria-label="Data usada" className={estiloCampoCurto}>
          {colunas.map((c) => (
            <option key={c} value={c}>
              por {c.toLowerCase()}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-wrap gap-0.5">
        {atalhos.map((a) => (
          <button
            key={a.rotulo}
            type="button"
            onClick={() => aplicar({ coluna, de: a.de, ate: a.ate })}
            className={estiloPilula(atual?.coluna === coluna && atual.de === a.de && atual.ate === a.ate)}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (de && ate) aplicar({ coluna, de: de <= ate ? de : ate, ate: de <= ate ? ate : de });
        }}
      >
        <input type="date" required value={de} onChange={(e) => setDe(e.target.value)} aria-label="De" className={estiloCampoCurto} />
        <span className="text-texto-suave">até</span>
        <input type="date" required value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até" className={estiloCampoCurto} />
        <button type="submit" className="rounded-lg bg-primaria px-2.5 py-1 text-white hover:opacity-90">
          Aplicar
        </button>
        {atual && (
          <button type="button" onClick={() => aplicar(null)} className="text-primaria hover:underline">
            Tirar período
          </button>
        )}
      </form>
    </div>
  );
}

// Atalhos comuns a quase todos os cadastros.
export const ATALHO_SITUACAO: GrupoAtalho = {
  rotulo: "Situação",
  opcoes: [
    { valor: "ativo", rotulo: "Ativos" },
    { valor: "inativo", rotulo: "Inativos" },
  ],
};
