"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Filtro inteligente das listas: busca instantânea em todas as colunas (sem
// acento, várias palavras, CNPJ/CPF com ou sem pontuação) e atalhos por grupo
// (situação, tipo...). Filtra as linhas já desenhadas pelo servidor: cada
// <tr> pode trazer data-tags="ativo materia_prima" para os atalhos.

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

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Filtro({
  children,
  atalhos = [],
  situacoes,
  ferramentas,
  placeholder = "Filtrar por qualquer informação da lista",
  iniciais = {},
}: {
  children: React.ReactNode;
  atalhos?: GrupoAtalho[];
  situacoes?: GrupoSituacao;
  // Controles extras na mesma linha da busca (ex.: o período).
  ferramentas?: React.ReactNode;
  placeholder?: string;
  // Atalho já marcado ao abrir (ex.: vindo de um número do painel): { Situação: "vencido" }.
  iniciais?: Record<string, string>;
}) {
  const area = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState("");
  const [escolhas, setEscolhas] = useState<Record<string, string>>(iniciais);
  const [contagem, setContagem] = useState<{ visiveis: number; total: number } | null>(null);

  useEffect(() => {
    const raiz = area.current;
    if (!raiz) return;
    const termos = normalizar(texto).split(/\s+/).filter(Boolean);
    const exigidas = Object.values(escolhas).filter(Boolean);
    const linhas = [...raiz.querySelectorAll<HTMLTableRowElement>("tbody tr:not([data-vazio])")];
    let visiveis = 0;
    for (const linha of linhas) {
      const conteudo = normalizar(linha.textContent ?? "");
      const digitos = conteudo.replace(/\D/g, "");
      const tags = (linha.dataset.tags ?? "").split(" ");
      const passa =
        termos.every(
          (t) => conteudo.includes(t) || (/^[\d.\-/]+$/.test(t) && t.replace(/\D/g, "") !== "" && digitos.includes(t.replace(/\D/g, ""))),
        ) && exigidas.every((e) => tags.includes(e));
      linha.hidden = !passa;
      if (passa) visiveis++;
    }
    // Blocos (ex.: um por empresa) somem quando nenhuma linha deles passa.
    for (const bloco of raiz.querySelectorAll<HTMLElement>("[data-bloco-filtro]")) {
      bloco.hidden = !bloco.querySelector("tbody tr:not([data-vazio]):not([hidden])");
    }
    setContagem({ visiveis, total: linhas.length });
  }, [texto, escolhas, children]);

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

  const filtrando = texto.trim() !== "" || Object.values(escolhas).some(Boolean);

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-full max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texto-suave" />
          <input
            ref={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={placeholder}
            aria-label="Filtrar lista"
            className="w-full rounded-lg bg-superficie py-1.5 pl-9 pr-8 text-sm shadow-[0_0_0_1px_var(--color-borda)] outline-none placeholder:text-texto-suave/70 focus:shadow-[0_0_0_1.5px_var(--color-primaria)]"
          />
          {texto && (
            <button
              type="button"
              onClick={() => setTexto("")}
              aria-label="Limpar filtro"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-texto-suave hover:text-texto"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {atalhos.map((g) => (
          <div key={g.rotulo} className="flex items-center gap-0.5 text-[13px]" role="group" aria-label={g.rotulo}>
            <span className="mr-1 text-xs text-texto-suave">{g.rotulo}</span>
            {[{ valor: "", rotulo: "Todos" }, ...g.opcoes].map((o) => {
              const ativo = (escolhas[g.rotulo] ?? "") === o.valor;
              return (
                <button
                  key={o.valor || "todos"}
                  type="button"
                  onClick={() => setEscolhas((atual) => ({ ...atual, [g.rotulo]: o.valor }))}
                  className={`rounded-full px-2.5 py-0.5 transition-colors ${ativo ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-superficie hover:text-texto"}`}
                >
                  {o.rotulo}
                </button>
              );
            })}
          </div>
        ))}
        {ferramentas}
        {contagem && contagem.total > 0 && (
          <span className="ml-auto text-xs text-texto-suave">
            {filtrando
              ? `${contagem.visiveis} de ${contagem.total}`
              : `${contagem.total} ${contagem.total === 1 ? "registro" : "registros"}`}
          </span>
        )}
      </div>
      <div ref={area}>{children}</div>
      {filtrando && contagem?.visiveis === 0 && contagem.total > 0 && (
        <p className="py-6 text-center text-sm text-texto-suave">
          Nada encontrado com esse filtro.{" "}
          <button
            type="button"
            className="text-primaria hover:underline"
            onClick={() => {
              setTexto("");
              setEscolhas({});
            }}
          >
            Limpar filtro
          </button>
        </p>
      )}
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
