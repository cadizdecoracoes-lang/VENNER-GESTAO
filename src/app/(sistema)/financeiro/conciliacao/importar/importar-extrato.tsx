"use client";

import { ArrowLeftRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FormAcao } from "@/components/form-acao";
import { Campo, Cartao, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import {
  acharCabecalhoExtrato,
  CAMPOS_EXTRATO,
  lerOfx,
  lerPlanilhaExtrato,
  mapearColunasExtrato,
  type CampoExtrato,
  type ExtratoLido,
  type LinhaExtrato,
  type MapaExtrato,
} from "@/lib/extrato";
import { lerExtratoPdf } from "@/lib/extrato-pdf";
import { formatarData, formatarMoeda } from "@/lib/formato";
import type { Celula } from "@/lib/plataformas/planilha";
import { importarExtrato } from "../actions";
import { linhasDoPdf } from "./ler-pdf";

type Conta = { id: string; nome: string; empresa: string; numero: string | null };
type Origem = "ofx" | "planilha" | "pdf";

// CSV com ";" ou ",", aspas e quebras de linha dentro das aspas.
function lerCsv(texto: string): Celula[][] {
  const primeira = texto.slice(0, texto.indexOf("\n") + 1 || undefined);
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        celula += '"';
        i++;
      } else if (c === '"') aspas = false;
      else celula += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(celula);
      celula = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(celula);
      linhas.push(linha);
      linha = [];
      celula = "";
    } else celula += c;
  }
  if (celula || linha.length) linhas.push([...linha, celula]);
  return linhas;
}

// OFX e CSV de banco costumam vir em Windows-1252 (acentos).
async function lerTexto(f: File): Promise<string> {
  const bytes = await f.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const so = (t: string | null) => (t ?? "").replace(/\D/g, "").replace(/^0+/, "");

export function ImportarExtrato({ contas, contaInicial }: { contas: Conta[]; contaInicial: string }) {
  const [conta, setConta] = useState(contaInicial);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [origem, setOrigem] = useState<Origem | null>(null);
  const [planilha, setPlanilha] = useState<Celula[][] | null>(null);
  const [cabecalho, setCabecalho] = useState(0);
  const [mapa, setMapa] = useState<MapaExtrato>({});
  const [lido, setLido] = useState<ExtratoLido | null>(null);
  // Ajustes da conferência: linhas retiradas e sinais invertidos.
  const [fora, setFora] = useState<Set<number>>(new Set());
  const [invertidas, setInvertidas] = useState<Set<number>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);

  async function ler(f: File | undefined) {
    setErro(null);
    setLido(null);
    setPlanilha(null);
    setFora(new Set());
    setInvertidas(new Set());
    if (!f) return;
    setLendo(true);
    setArquivo(f.name);
    try {
      if (/\.ofx$/i.test(f.name)) {
        setOrigem("ofx");
        setLido(lerOfx(await lerTexto(f)));
      } else if (/\.pdf$/i.test(f.name)) {
        setOrigem("pdf");
        const { linhas, ocr } = await linhasDoPdf(f, setProgresso);
        setLido(lerExtratoPdf(linhas, { ocr }));
      } else if (/\.(xlsx|csv|txt)$/i.test(f.name)) {
        setOrigem("planilha");
        let dados: Celula[][];
        if (/\.xlsx$/i.test(f.name)) {
          const { default: lerXlsx } = await import("read-excel-file");
          dados = (await lerXlsx(f)) as Celula[][];
        } else dados = lerCsv(await lerTexto(f));
        const cab = Math.max(0, acharCabecalhoExtrato(dados));
        const m = mapearColunasExtrato(dados[cab] ?? []);
        setPlanilha(dados);
        setCabecalho(cab);
        setMapa(m);
      } else if (/\.xls$/i.test(f.name)) {
        throw new Error("Arquivo .xls antigo: abra no Excel e salve como .xlsx, ou baixe o extrato em OFX.");
      } else {
        throw new Error("Use o extrato em OFX, Excel (.xlsx), CSV ou PDF.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : typeof e === "string" ? e : "Não foi possível ler o arquivo.");
    } finally {
      setLendo(false);
      setProgresso(null);
    }
  }

  const leitura = useMemo(
    () => (origem === "planilha" && planilha ? lerPlanilhaExtrato(planilha, cabecalho + 1, mapa) : lido),
    [origem, planilha, cabecalho, mapa, lido],
  );
  const linhas: (LinhaExtrato & { i: number })[] = (leitura?.linhas ?? []).map((l, i) => ({
    ...l,
    i,
    valor: invertidas.has(i) ? -l.valor : l.valor,
  }));
  const valendo = linhas.filter((l) => !fora.has(l.i));
  const entradas = valendo.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0);
  const saidas = valendo.filter((l) => l.valor < 0).reduce((s, l) => s + l.valor, 0);
  const escolhida = contas.find((c) => c.id === conta);
  const contaDiferente =
    leitura?.conta.numero && escolhida?.numero && !so(escolhida.numero).includes(so(leitura.conta.numero).slice(0, 5)) && !so(leitura.conta.numero).includes(so(escolhida.numero).slice(0, 5));
  const colunas = planilha?.[cabecalho] ?? [];
  const aplicacoes = linhas.filter((l) => l.aplicacao && !fora.has(l.i));
  const aConferir = linhas.filter((l) => (l.conferir || (l.sinalIncerto && !invertidas.has(l.i))) && !fora.has(l.i)).length;

  const alternar = (s: Set<number>, i: number, set: (n: Set<number>) => void) => {
    const n = new Set(s);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    set(n);
  };

  const dados = JSON.stringify({
    conta,
    origem,
    arquivo,
    saldoFinal: leitura?.saldoFinal ?? null,
    linhas: valendo.map(({ data, descricao, documento, valor, saldo, id_banco }) => ({ data, descricao, documento, valor, saldo, id_banco })),
  });

  return (
    <div className="space-y-3">
      <Cartao>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Conta bancária do extrato">
            <select value={conta} onChange={(e) => setConta(e.target.value)} className={estiloCampo}>
              <option value="" disabled>
                Escolha...
              </option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} · {c.empresa}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Arquivo do banco" dica="OFX é o mais exato. Também aceita Excel (.xlsx), CSV e PDF.">
            <input type="file" accept=".ofx,.xlsx,.xls,.csv,.txt,.pdf" onChange={(e) => ler(e.target.files?.[0])} className={estiloCampo} />
          </Campo>
          {leitura && (
            <div className="text-sm">
              <p className="text-texto-suave">Resumo do arquivo{leitura.banco ? ` · ${leitura.banco}` : ""}</p>
              <p>
                <strong>{valendo.length}</strong> lançamento(s) · entradas <span className="tabular-nums text-sucesso">{formatarMoeda(entradas)}</span> · saídas{" "}
                <span className="tabular-nums text-perigo">{formatarMoeda(saidas)}</span>
              </p>
              {(leitura.saldoInicial ?? null) !== null && <p className="text-texto-suave">Saldo anterior: {formatarMoeda(leitura.saldoInicial!)}</p>}
              {leitura.saldoFinal !== null && <p className="text-texto-suave">Saldo final informado: {formatarMoeda(leitura.saldoFinal)}</p>}
            </div>
          )}
        </div>
        {lendo && <p className="mt-2 text-sm text-texto-suave">{progresso ?? "Lendo o arquivo..."}</p>}
        {erro && <p className="mt-2 text-sm text-perigo">{erro}</p>}
        {contaDiferente && (
          <p className="mt-2 text-sm text-alerta">
            O arquivo é da conta {leitura?.conta.numero} e a conta escolhida é {escolhida?.numero}. Confira antes de importar.
          </p>
        )}
        {leitura?.avisos.map((a) => (
          <p key={a} className={`mt-1 text-sm ${a.startsWith("Conferido") ? "text-sucesso" : "text-alerta"}`}>
            {a}
          </p>
        ))}
      </Cartao>

      {origem === "planilha" && planilha && (
        <Cartao titulo="Colunas da planilha">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Campo rotulo="Linha do cabeçalho">
              <input
                type="number"
                min={1}
                max={planilha.length}
                value={cabecalho + 1}
                onChange={(e) => {
                  const c = Math.max(0, Number(e.target.value) - 1);
                  setCabecalho(c);
                  setMapa(mapearColunasExtrato(planilha[c] ?? []));
                }}
                className={estiloCampo}
              />
            </Campo>
            {(Object.keys(CAMPOS_EXTRATO) as CampoExtrato[]).map((campo) => (
              <Campo key={campo} rotulo={CAMPOS_EXTRATO[campo]}>
                <select
                  value={mapa[campo] ?? ""}
                  onChange={(e) => setMapa({ ...mapa, [campo]: e.target.value === "" ? undefined : Number(e.target.value) })}
                  className={estiloCampo}
                >
                  <option value="">—</option>
                  {colunas.map((c, i) => (
                    <option key={i} value={i}>
                      {String(c ?? `Coluna ${i + 1}`)}
                    </option>
                  ))}
                </select>
              </Campo>
            ))}
          </div>
        </Cartao>
      )}

      {linhas.length > 0 && (
        <Cartao
          titulo="Confira antes de importar"
          acoes={
            <span className="flex flex-wrap items-center gap-3 text-xs">
              {aConferir > 0 && <span className="text-alerta">{aConferir} linha(s) em amarelo para conferir</span>}
              {aplicacoes.length > 0 && (
                <button
                  type="button"
                  title="Aplicação e resgate automáticos do banco (ex.: BB Rende Fácil): não têm título no pagar/receber"
                  onClick={() => setFora(new Set([...fora, ...aplicacoes.map((l) => l.i)]))}
                  className="text-primaria hover:underline"
                >
                  Tirar {aplicacoes.length} aplicação(ões) automática(s)
                </button>
              )}
            </span>
          }
        >
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-superficie">
                <tr className="text-left text-xs text-texto-suave">
                  <th className="px-2 py-1.5 font-medium">Data</th>
                  <th className="px-2 py-1.5 font-medium">Lançamento</th>
                  <th className="px-2 py-1.5 text-right font-medium">Valor</th>
                  <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borda/70">
                {linhas.map((l) => (
                  <tr key={l.i} className={fora.has(l.i) ? "text-texto-suave line-through" : l.conferir || (l.sinalIncerto && !invertidas.has(l.i)) ? "bg-alerta/10" : ""}>
                    <td className="whitespace-nowrap px-2 py-1 tabular-nums">{formatarData(l.data)}</td>
                    <td className="px-2 py-1">
                      {l.descricao}
                      {l.documento && <span className="text-xs text-texto-suave"> · doc {l.documento}</span>}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${l.valor < 0 ? "text-perigo" : "text-sucesso"}`}>{formatarMoeda(l.valor)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-texto-suave">{l.saldo === null ? "" : formatarMoeda(l.saldo)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      <button type="button" title="Inverter entrada/saída" onClick={() => alternar(invertidas, l.i, setInvertidas)} className="p-1 text-texto-suave hover:text-texto">
                        <ArrowLeftRight size={14} />
                      </button>
                      <button type="button" title="Tirar da importação" onClick={() => alternar(fora, l.i, setFora)} className="p-1 text-texto-suave hover:text-perigo">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FormAcao acao={importarExtrato} rotulo={`Importar ${valendo.length} lançamento(s)`} enviando="Importando..." className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="dados" value={dados} />
            <span className="text-xs text-texto-suave">Lançamentos que já estão no sistema são reconhecidos e não entram de novo.</span>
            <Link href="/financeiro/conciliacao" className={estiloBotaoSecundario}>
              Cancelar
            </Link>
          </FormAcao>
        </Cartao>
      )}
    </div>
  );
}
