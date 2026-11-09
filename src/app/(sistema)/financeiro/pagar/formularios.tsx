"use client";

import { useState } from "react";
import { Campo, estiloCampo } from "@/components/ui";
import { gerarLancamentos, INTERVALOS, totalPago, type Intervalo, type TipoLancamento } from "@/lib/contas-pagar";
import { formatarData, formatarMoeda, lerNumero } from "@/lib/formato";

// Partes interativas dos formulários do contas a pagar.

const TIPOS: Record<TipoLancamento, string> = { unica: "Única", parcelada: "Parcelada", recorrente: "Recorrente" };

// Tipo do lançamento, valor, vencimento e, para parcelada/recorrente, a
// quantidade e o intervalo, com a prévia das contas que serão criadas.
export function CamposLancamento({ valorInicial, vencimentoInicial }: { valorInicial?: string; vencimentoInicial: string }) {
  const [tipo, setTipo] = useState<TipoLancamento>("unica");
  const [valor, setValor] = useState(valorInicial ?? "");
  const [vencimento, setVencimento] = useState(vencimentoInicial);
  const [quantidade, setQuantidade] = useState("12");
  const [intervalo, setIntervalo] = useState<Intervalo>("mensal");
  const n = Number(valor ? lerNumero(valor) : 0);
  const previa =
    tipo !== "unica" && n > 0 && vencimento
      ? gerarLancamentos({ tipo, valor: n, vencimento, quantidade: Math.min(120, Math.max(2, Number(quantidade) || 2)), intervalo })
      : [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 sm:col-span-2 lg:col-span-4" role="radiogroup" aria-label="Tipo de lançamento">
        <span className="mr-1 text-sm text-texto-suave">Lançamento</span>
        {(Object.keys(TIPOS) as TipoLancamento[]).map((t) => (
          <label
            key={t}
            className={`cursor-pointer rounded-full px-3 py-0.5 text-sm ${tipo === t ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-fundo"}`}
          >
            <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} className="sr-only" />
            {TIPOS[t]}
          </label>
        ))}
        <span className="ml-2 text-xs text-texto-suave">
          {tipo === "parcelada" ? "o valor total é dividido nas parcelas" : tipo === "recorrente" ? "o mesmo valor se repete (aluguel, mensalidade...)" : ""}
        </span>
      </div>
      <Campo rotulo={tipo === "parcelada" ? "Valor total (R$)" : tipo === "recorrente" ? "Valor de cada mês (R$)" : "Valor (R$)"}>
        <input name="valor" required inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className={estiloCampo} />
      </Campo>
      <Campo rotulo={tipo === "unica" ? "Vencimento" : "1º vencimento"}>
        <input name="vencimento" type="date" required value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={estiloCampo} />
      </Campo>
      {tipo !== "unica" && (
        <>
          <Campo rotulo={tipo === "parcelada" ? "Parcelas" : "Quantas vezes"}>
            <input name="quantidade" type="number" min={2} max={120} required value={quantidade} onChange={(e) => setQuantidade(e.target.value)} className={estiloCampo} />
          </Campo>
          <Campo rotulo="De quanto em quanto tempo">
            <select name="intervalo" value={intervalo} onChange={(e) => setIntervalo(e.target.value as Intervalo)} className={estiloCampo}>
              {Object.entries(INTERVALOS).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </select>
          </Campo>
        </>
      )}
      {previa.length > 0 && (
        <details className="text-xs text-texto-suave sm:col-span-2 lg:col-span-4">
          <summary className="cursor-pointer">
            Serão criadas {previa.length} contas: {formatarMoeda(previa[0].valor)} em {formatarData(previa[0].vencimento)} até{" "}
            {formatarData(previa[previa.length - 1].vencimento)} · total {formatarMoeda(previa.reduce((s, l) => s + l.valor, 0))}
          </summary>
          <p className="mt-1 columns-2 sm:columns-4">
            {previa.map((l) => (
              <span key={l.parcela} className="block tabular-nums">
                {l.parcela} · {formatarData(l.vencimento)} · {formatarMoeda(l.valor)}
              </span>
            ))}
          </p>
        </details>
      )}
    </>
  );
}

// Principal, juros, multa e desconto, com o total que sai do banco.
export function CamposPagamento({ principal }: { principal: number }) {
  const [v, setV] = useState({ principal: String(principal).replace(".", ","), juros: "", multa: "", desconto: "" });
  const num = (s: string) => (s.trim() ? lerNumero(s) : 0);
  const total = totalPago({ principal: num(v.principal), juros: num(v.juros), multa: num(v.multa), desconto: num(v.desconto) });
  const campo = (nome: keyof typeof v, rotulo: string, obrigatorio = false) => (
    <Campo rotulo={rotulo}>
      <input
        name={nome}
        required={obrigatorio}
        inputMode="decimal"
        placeholder="0,00"
        value={v[nome]}
        onChange={(e) => setV({ ...v, [nome]: e.target.value })}
        className={`${estiloCampo} tabular-nums`}
      />
    </Campo>
  );
  return (
    <>
      {campo("principal", "Principal (R$)", true)}
      {campo("juros", "Juros (R$)")}
      {campo("multa", "Multa (R$)")}
      {campo("desconto", "Desconto (R$)")}
      <p className="text-sm sm:col-span-4">
        <span className="text-texto-suave">Total que sai do banco: </span>
        <span className="font-semibold tabular-nums">{Number.isFinite(total) ? formatarMoeda(total) : "—"}</span>
      </p>
    </>
  );
}
