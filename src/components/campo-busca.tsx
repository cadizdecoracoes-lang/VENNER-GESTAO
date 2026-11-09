"use client";

import { X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { contem, normalizar } from "@/lib/filtro";
import { estiloCampo } from "./ui";

export type OpcaoBusca = { id: string; nome: string; detalhe?: string | null };

// Campo de escolha com busca: digita qualquer parte do nome (ou do CNPJ) e a
// lista mostra todos os cadastros que CONTÊM o texto, sem acento. Grava o id
// num campo escondido com o `name` dado, como um <select>.
export function CampoBusca({
  name,
  opcoes,
  inicial = "",
  vazio = "Nenhum",
  obrigatorio = false,
  placeholder = "Digite para procurar...",
  acima = false,
}: {
  name: string;
  opcoes: OpcaoBusca[];
  inicial?: string;
  // Rótulo da opção "sem escolha"; null = não oferece.
  vazio?: string | null;
  obrigatorio?: boolean;
  placeholder?: string;
  // Lista abre para cima (campo no rodapé da tela).
  acima?: boolean;
}) {
  const [id, setId] = useState(inicial);
  const nomeDe = (v: string) => opcoes.find((o) => o.id === v)?.nome ?? "";
  const [texto, setTexto] = useState(nomeDe(inicial));
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  const achadas = useMemo(() => {
    const t = texto.trim();
    // Com o nome escolhido no campo, mostra a lista toda.
    if (!t || t === nomeDe(id)) return opcoes.slice(0, 200);
    const n = normalizar(t);
    return opcoes
      .filter((o) => contem(o.nome, t) || (o.detalhe ? contem(o.detalhe, t) : false))
      .sort((a, b) => Number(!normalizar(a.nome).startsWith(n)) - Number(!normalizar(b.nome).startsWith(n)))
      .slice(0, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, opcoes, id]);

  function escolher(o: OpcaoBusca | null) {
    setId(o?.id ?? "");
    setTexto(o?.nome ?? "");
    setAberto(false);
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={id} />
      <input
        ref={campo}
        value={texto}
        required={obrigatorio && !id}
        placeholder={id ? undefined : placeholder}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberto(true);
          setDestaque(0);
          if (!e.target.value) setId("");
        }}
        onFocus={(e) => {
          e.currentTarget.select();
          setAberto(true);
        }}
        onBlur={() => {
          // Saiu sem escolher: volta o nome do que estava escolhido.
          setTimeout(() => {
            setAberto(false);
            setTexto((t) => (t.trim() === "" ? "" : nomeDe(id) || ""));
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setAberto(true);
            setDestaque((d) => Math.max(0, Math.min(achadas.length - 1, d + (e.key === "ArrowDown" ? 1 : -1))));
          } else if (e.key === "Enter" && aberto) {
            e.preventDefault();
            if (achadas[destaque]) escolher(achadas[destaque]);
          } else if (e.key === "Escape" && aberto) {
            // Fecha só a lista; com ela fechada, o Esc fecha a janela.
            e.nativeEvent.stopImmediatePropagation();
            setAberto(false);
          }
        }}
        className={`${estiloCampo} pr-7`}
        autoComplete="off"
        role="combobox"
        aria-expanded={aberto}
      />
      {id && vazio !== null && (
        <button
          type="button"
          onClick={() => {
            escolher(null);
            campo.current?.focus();
          }}
          aria-label="Tirar a escolha"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-texto-suave hover:text-texto"
        >
          <X size={14} />
        </button>
      )}
      {aberto && (
        <ul role="listbox" className={`absolute left-0 z-50 max-h-64 ${acima ? "bottom-full mb-1" : "top-full mt-1"} w-full overflow-y-auto rounded-lg bg-superficie p-1 text-sm shadow-[0_4px_16px_rgba(16,24,40,0.18)]`}>
          {vazio !== null && !texto.trim() && (
            <li>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(null)} className="w-full rounded px-2 py-1 text-left text-texto-suave hover:bg-fundo">
                {vazio}
              </button>
            </li>
          )}
          {achadas.map((o, i) => (
            <li key={o.id} role="option" aria-selected={o.id === id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setDestaque(i)}
                onClick={() => escolher(o)}
                className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left ${i === destaque ? "bg-primaria-suave" : ""} ${o.id === id ? "font-medium text-primaria" : ""}`}
              >
                <span className="truncate">{o.nome}</span>
                {o.detalhe && <span className="shrink-0 text-xs text-texto-suave">{o.detalhe}</span>}
              </button>
            </li>
          ))}
          {achadas.length === 0 && <li className="px-2 py-1 text-texto-suave">Nenhum cadastro contém “{texto}”.</li>}
        </ul>
      )}
    </div>
  );
}
