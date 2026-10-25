"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Fluxo, LinhaFluxo, Rastreio } from "@/lib/fluxo-caixa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { salvarPrevisao, titulosDaCelula, type TituloDaCelula } from "./actions";

// Número inteiro com milhar, como no fluxo da Drogarema; zero vira "–".
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "" : Math.round(v) === 0 ? "–" : Math.round(v).toLocaleString("pt-BR"));

const ESTILO_LINHA: Record<string, string> = {
  secao: "bg-primaria text-white text-[11px] font-bold uppercase tracking-wider",
  grupo: "font-semibold",
  categoria: "text-texto-suave text-[11px]",
  manual: "italic text-[#53389e] bg-[#f4ebff] text-[11px]",
  total: "font-bold bg-[#eef4ff] text-[#1e3a8a]",
  resultado: "font-bold",
  conta: "text-texto-suave text-[11px]",
  info: "text-texto-suave text-[11px]",
  saldo: "font-bold bg-[#fdf6ec] text-[#3d2b12] border-y-2 border-alerta",
};

type Modal = { titulo: string; sub: string; lista: TituloDaCelula[] | null; erro?: string; valorCelula: number };

export function TabelaFluxo({
  fluxo,
  modo,
  hoje,
  empresa,
  podeDigitar,
  rotuloAnterior,
}: {
  fluxo: Fluxo;
  modo: "dia" | "mes";
  hoje: string;
  empresa: string | null;
  podeDigitar: boolean;
  rotuloAnterior: string;
}) {
  const router = useRouter();
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [, iniciar] = useTransition();
  const { colunas, linhas } = fluxo;

  const alternar = (chave: string) => {
    const n = new Set(abertos);
    if (n.has(chave)) n.delete(chave);
    else n.add(chave);
    setAbertos(n);
  };
  const temFilhos = new Set(linhas.filter((l) => l.pai).map((l) => l.pai!));
  const visiveis = linhas.filter((l) => !l.pai || abertos.has(l.pai));

  async function abrir(l: LinhaFluxo, r: Rastreio, de: string, ate: string, valor: number) {
    setModal({ titulo: l.rotulo, sub: de === ate ? formatarData(de) : `${formatarData(de)} a ${formatarData(ate)}`, lista: null, valorCelula: valor });
    const res = await titulosDaCelula(r, de, ate, empresa);
    setModal((m) => (m ? { ...m, ...(Array.isArray(res) ? { lista: res } : { lista: [], erro: res.erro }) } : m));
  }

  function gravar(tipo: "entrada" | "saida", data: string, texto: string) {
    setEditando(null);
    const t = texto.trim();
    const valor = t === "" ? null : Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    if (valor !== null && !Number.isFinite(valor)) {
      setErro("Valor inválido.");
      return;
    }
    const atual = fluxo.previsoes[`${tipo}|${data}`] ?? null;
    if ((valor ?? 0) === (atual ?? 0)) return;
    iniciar(async () => {
      const r = await salvarPrevisao(empresa!, data, tipo, valor);
      if (r.erro) setErro(r.erro);
      else {
        setErro(null);
        router.refresh();
      }
    });
  }

  const classeColuna = (k: number) => {
    const c = colunas[k];
    return `${c.previsto ? "bg-[#f3f7fe]" : ""} ${c.fds ? "bg-[#eceff3]" : ""} ${c.hoje ? "shadow-[inset_3px_0_0_var(--color-alerta)]" : ""}`;
  };
  const comparar = linhas.some((l) => l.anterior !== undefined);
  const variacao = (atual: number | null, ant: number | null | undefined) => {
    if (ant === undefined || ant === null || atual === null || Math.round(ant) === 0) return "";
    const p = ((atual - ant) / Math.abs(ant)) * 100;
    return `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`;
  };

  return (
    <>
      {erro && <p className="text-sm text-perigo">{erro}</p>}
      <section className="max-h-[78vh] overflow-auto rounded-lg border border-borda bg-superficie">
        <table className="w-full border-separate border-spacing-0 text-xs tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-56 border-b border-borda bg-superficie px-3 py-1.5 text-left font-semibold text-texto-suave">
                {modo === "dia" ? "Dia" : "Mês"}
              </th>
              {colunas.map((c, k) => (
                <th
                  key={c.id}
                  title={c.feriado ? `Feriado: ${c.feriado}` : undefined}
                  className={`sticky top-0 z-20 whitespace-nowrap border-b border-borda px-2 py-1.5 text-right font-semibold text-texto-suave ${c.fds ? "bg-[#e4e7ec]" : "bg-superficie"} ${c.hoje ? "shadow-[inset_3px_0_0_var(--color-alerta)]" : ""}`}
                  data-k={k}
                >
                  {c.titulo}
                  {c.feriado ? " ★" : ""}
                </th>
              ))}
              <th className="sticky top-0 z-20 border-b border-borda bg-fundo px-2 py-1.5 text-right font-semibold">Total</th>
              {comparar && (
                <th className="sticky top-0 z-20 whitespace-nowrap border-b border-borda bg-fundo px-2 py-1.5 text-right font-semibold text-texto-suave" title={rotuloAnterior}>
                  {rotuloAnterior.split(" (")[0]}
                </th>
              )}
              {comparar && <th className="sticky top-0 z-20 border-b border-borda bg-fundo px-2 py-1.5 text-right font-semibold text-texto-suave">Var.</th>}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => {
              const abre = temFilhos.has(l.chave);
              const estilo = ESTILO_LINHA[l.tipo] ?? "";
              const fundoRotulo = l.tipo === "secao" ? "bg-primaria" : l.tipo === "total" ? "bg-[#eef4ff]" : l.tipo === "saldo" ? "bg-[#fdf6ec]" : l.tipo === "manual" ? "bg-[#f4ebff]" : "bg-superficie";
              return (
                <tr key={l.chave} className={estilo}>
                  <td
                    className={`sticky left-0 z-10 max-w-80 truncate border-b border-borda/60 px-3 py-[3px] text-left ${fundoRotulo} ${l.tipo === "categoria" || l.tipo === "conta" || l.tipo === "manual" ? "pl-7" : ""} ${abre ? "cursor-pointer" : ""}`}
                    title={l.dica ?? l.rotulo}
                    onClick={abre ? () => alternar(l.chave) : undefined}
                  >
                    {abre && <span className="inline-block w-3.5 text-texto-suave">{abertos.has(l.chave) ? "▾" : "▸"}</span>}
                    {l.rotulo}
                  </td>
                  {l.valores.map((v, k) => {
                    const c = colunas[k];
                    const podeEditar = l.editavel && podeDigitar && c.de >= hoje;
                    const chaveEd = `${l.editavel}|${c.id}`;
                    if (l.tipo === "secao") return <td key={k} className="border-b border-borda/60" />;
                    if (podeEditar && editando === chaveEd)
                      return (
                        <td key={k} className="border-b border-borda/60 px-1 py-0.5">
                          <input
                            autoFocus
                            inputMode="decimal"
                            defaultValue={fluxo.previsoes[`${l.editavel}|${c.id}`]?.toString().replace(".", ",") ?? ""}
                            onBlur={(e) => gravar(l.editavel!, c.id, e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setEditando(null);
                            }}
                            className="w-20 rounded border border-[#9e77ed] px-1 text-right text-xs"
                          />
                        </td>
                      );
                    const rastreia = l.rastreio && v;
                    return (
                      <td
                        key={k}
                        onClick={
                          podeEditar ? () => setEditando(chaveEd) : rastreia ? () => abrir(l, l.rastreio!, c.de, c.ate, v ?? 0) : undefined
                        }
                        className={`whitespace-nowrap border-b border-borda/60 px-2 py-[3px] text-right ${l.tipo === "saldo" || l.tipo === "total" || l.tipo === "manual" ? "" : classeColuna(k)} ${v !== null && v < -0.5 ? "text-perigo" : ""} ${podeEditar ? "cursor-text hover:outline hover:outline-1 hover:outline-[#9e77ed]" : rastreia ? "cursor-zoom-in hover:outline hover:outline-1 hover:outline-primaria" : ""} ${c.hoje ? "shadow-[inset_3px_0_0_var(--color-alerta)]" : ""}`}
                      >
                        {fmt(v)}
                      </td>
                    );
                  })}
                  <td
                    onClick={l.rastreio && l.total ? () => abrir(l, l.rastreio!, colunas[0].de, colunas[colunas.length - 1].ate, l.total ?? 0) : undefined}
                    className={`whitespace-nowrap border-b border-borda/60 bg-fundo px-2 py-[3px] text-right font-semibold ${l.total !== null && l.total < -0.5 ? "text-perigo" : ""} ${l.rastreio && l.total ? "cursor-zoom-in" : ""}`}
                  >
                    {l.tipo === "secao" ? "" : fmt(l.total)}
                  </td>
                  {comparar && (
                    <td className="whitespace-nowrap border-b border-borda/60 bg-fundo px-2 py-[3px] text-right text-texto-suave">
                      {l.anterior === undefined ? "" : fmt(l.anterior)}
                    </td>
                  )}
                  {comparar && (
                    <td className="whitespace-nowrap border-b border-borda/60 bg-fundo px-2 py-[3px] text-right text-texto-suave">{variacao(l.total, l.anterior)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="flex max-h-[85vh] w-full max-w-6xl flex-col rounded-xl bg-superficie shadow-xl">
            <div className="flex items-start gap-3 border-b border-borda px-4 py-2.5">
              <div className="flex-1">
                <p className="text-xs text-texto-suave">{modal.sub}</p>
                <h2 className="font-semibold">{modal.titulo}</h2>
              </div>
              <button type="button" onClick={() => setModal(null)} className="text-sm text-texto-suave hover:text-texto">
                Fechar
              </button>
            </div>
            {modal.lista === null ? (
              <p className="px-4 py-3 text-sm text-texto-suave">Buscando os títulos...</p>
            ) : (
              <>
                <p className="border-b border-borda/60 px-4 py-2 text-sm">
                  <strong>{modal.lista.length}</strong> título(s) · <strong className="tabular-nums">{formatarMoeda(modal.lista.reduce((s, t) => s + t.valor, 0))}</strong>
                  <span className="text-texto-suave"> · valor na célula {formatarMoeda(modal.valorCelula)}</span>
                  {modal.erro && <span className="text-perigo"> · {modal.erro}</span>}
                </p>
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-superficie text-left text-texto-suave">
                      <tr>
                        {["Data no fluxo", "Situação", "Vencimento", "Empresa", "Fornecedor / cliente", "Descrição", "Categoria", "Conta", "Valor"].map((c) => (
                          <th key={c} className={`px-2 py-1.5 font-medium ${c === "Valor" ? "text-right" : ""}`}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borda/60">
                      {modal.lista.map((t) => (
                        <tr key={t.id}>
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums">{formatarData(t.dataFluxo)}</td>
                          <td className="px-2 py-1">
                            <span className={t.situacao === "pago" ? "text-sucesso" : t.situacao === "atrasado" ? "text-alerta" : "text-primaria"}>
                              {t.situacao === "pago" ? (t.tipo === "pagar" ? "Pago" : "Recebido") : t.situacao === "atrasado" ? "Atrasado" : "Em aberto"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums">{formatarData(t.vencimento)}</td>
                          <td className="px-2 py-1">{t.empresa}</td>
                          <td className="px-2 py-1">{t.pessoa ?? "—"}</td>
                          <td className="px-2 py-1">{t.descricao}</td>
                          <td className="px-2 py-1 text-texto-suave">{t.categoria ?? "—"}</td>
                          <td className="px-2 py-1 text-texto-suave">{t.conta ?? "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatarMoeda(t.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
