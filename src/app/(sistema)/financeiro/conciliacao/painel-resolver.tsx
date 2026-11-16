"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FormAcao } from "@/components/form-acao";
import { Cartao, estiloBotao, estiloCampo } from "@/components/ui";
import type { Estado } from "@/lib/erros";
import type { TituloCandidato } from "@/lib/extrato";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { conciliar, conciliarVarios, ignorar, marcarTransferencia } from "./actions";
import type { LinhaConciliacao } from "./dados";

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Resolve uma ou mais linhas do extrato: escolher os títulos que elas quitam,
// marcar como transferência ou ignorar (estes dois só com uma linha). A
// conciliação não lança nada: sem título, o atalho abre a conta nova no
// pagar/receber já preenchida. Com várias linhas (ex.: um título recebido em
// duas entradas), os títulos têm de somar exatamente o total das linhas.
export function PainelResolver({
  linhas,
  candidatos,
  linkCriar,
  voltar,
}: {
  linhas: LinhaConciliacao[];
  candidatos: TituloCandidato[];
  linkCriar: string;
  voltar: string;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const linha = linhas[0];
  const varias = linhas.length > 1;
  const valor = Math.round(linhas.reduce((s, l) => s + Math.abs(Number(l.valor)), 0) * 100) / 100;
  const saida = Number(linha.valor) < 0;
  const misturadas = linhas.some((l) => Number(l.valor) < 0 !== saida);
  // Título do lado da linha soma; o do outro lado desconta (ex.: juros da
  // antecipação no crédito líquido da factoring). Com várias linhas, só do lado.
  const doLado = (t: TituloCandidato) => t.tipo === (saida ? "pagar" : "receber");
  const dataRef = linha.data;

  const lista = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    return candidatos
      .filter((t) => !varias || doLado(t))
      .filter((t) => {
        const texto = semAcento(`${t.pessoa ?? ""} ${t.descricao} ${formatarMoeda(t.valor)} ${formatarData(t.data)}`);
        return termos.every((p) => texto.includes(p));
      })
      .sort((a, b) => {
        // Valor igual primeiro, depois a data mais perto.
        const va = Math.abs(a.valor - valor) < 0.01 ? 0 : 1;
        const vb = Math.abs(b.valor - valor) < 0.01 ? 0 : 1;
        const da = Math.abs(Date.parse(a.data) - Date.parse(dataRef));
        const db = Math.abs(Date.parse(b.data) - Date.parse(dataRef));
        return Number(doLado(b)) - Number(doLado(a)) || va - vb || da - db;
      })
      .slice(0, 200);
  }, [candidatos, busca, valor, dataRef, varias]);

  const escolhidos = candidatos.filter((t) => marcados.has(t.id));
  const temDoLado = escolhidos.some(doLado);
  // Com uma linha e um título só em aberto, a baixa usa o valor do extrato (juros/desconto).
  const pelaLinha = !varias && escolhidos.length === 1 && !escolhidos[0].pago && temDoLado;
  const soma = pelaLinha ? valor : escolhidos.reduce((s, t) => s + (doLado(t) ? t.valor : -t.valor), 0);
  const diferenca = Math.round((soma - valor) * 100) / 100;
  const exigeExato = varias || escolhidos.length > 1;

  function alternar(id: string) {
    const n = new Set(marcados);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setMarcados(n);
  }

  function enviar() {
    setErro(null);
    const pagar = escolhidos.filter((t) => t.tipo === "pagar").map((t) => t.id);
    const receber = escolhidos.filter((t) => t.tipo === "receber").map((t) => t.id);
    iniciar(async () => {
      const r = varias
        ? await conciliarVarios(
            linhas.map((l) => l.id),
            pagar,
            receber,
          )
        : await conciliar(linha.id, pagar, receber);
      if (r.erro) setErro(r.erro);
      else router.push(voltar);
    });
  }

  const depois = async (p: Promise<Estado>) => {
    const r = await p;
    if (!r.erro) router.push(voltar);
    return r;
  };

  const titulo = varias
    ? `${linhas.length} lançamentos do extrato juntos · ${formatarMoeda(saida ? -valor : valor)}`
    : `${formatarData(linha.data)} · ${linha.descricao} · ${formatarMoeda(Number(linha.valor))}`;

  return (
    <Cartao
      titulo={titulo}
      acoes={
        <Link href={voltar} className="text-sm text-texto-suave hover:underline">
          Fechar
        </Link>
      }
    >
      {varias && (
        <p className="mb-2 truncate text-xs text-texto-suave" title={linhas.map((l) => `${formatarData(l.data)} ${l.descricao} ${formatarMoeda(Number(l.valor))}`).join("\n")}>
          {linhas.map((l) => `${formatarData(l.data)} ${formatarMoeda(Number(l.valor))}`).join(" + ")}
        </p>
      )}
      {misturadas ? (
        <p className="text-sm text-perigo">
          Marque só entradas ou só saídas para conciliar juntas. <Link href={voltar} className="underline">Voltar</Link>
        </p>
      ) : (
        <div className={`grid gap-4 ${varias ? "" : "lg:grid-cols-[2fr_1fr]"}`}>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar título por nome, descrição, valor..."
                className={`${estiloCampo} max-w-md py-1.5`}
              />
              <span className="text-sm text-texto-suave">
                Escolhidos: <strong className="tabular-nums text-texto">{formatarMoeda(soma)}</strong> de {formatarMoeda(valor)}
                {exigeExato && escolhidos.length > 0 && diferenca !== 0 && (
                  <span className="text-perigo">
                    {" "}
                    · {diferenca < 0 ? `falta ${formatarMoeda(-diferenca)}` : `passa ${formatarMoeda(diferenca)}`}
                  </span>
                )}
                {pelaLinha && Math.abs(escolhidos[0].valor - valor) > 0.009 && (
                  <span className="text-alerta"> · baixa pelo valor do extrato (título de {formatarMoeda(escolhidos[0].valor)})</span>
                )}
              </span>
              <button
                type="button"
                onClick={enviar}
                disabled={!temDoLado || pendente || (exigeExato && diferenca !== 0)}
                className={`${estiloBotao} py-1.5`}
              >
                {pendente ? "Conciliando..." : varias ? "Conciliar tudo junto" : "Conciliar escolhidos"}
              </button>
            </div>
            {erro && <p className="text-sm text-perigo">{erro}</p>}
            <div className="max-h-72 overflow-auto rounded-lg border border-borda">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-borda/70">
                  {lista.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-texto-suave">
                        Nenhum título {saida ? "a pagar" : "a receber"} perto desta data.{varias ? "" : " Crie o título pelo atalho ao lado."}
                      </td>
                    </tr>
                  )}
                  {lista.map((t) => (
                    <tr key={t.id} onClick={() => alternar(t.id)} className={`cursor-pointer hover:bg-fundo ${marcados.has(t.id) ? "bg-primaria-suave/60" : ""}`}>
                      <td className="w-8 px-3 py-1.5">
                        <input type="checkbox" readOnly checked={marcados.has(t.id)} aria-label="Escolher" />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-texto-suave">
                        {t.pago ? "pago" : "vence"} {formatarData(t.data)}
                      </td>
                      <td className="px-2 py-1.5">
                        {t.pessoa && <span className="font-medium">{t.pessoa} · </span>}
                        {t.descricao}
                        {!doLado(t) && <span className="text-xs text-texto-suave"> · a {t.tipo}, desconta</span>}
                      </td>
                      <td
                        className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${doLado(t) ? "" : "text-perigo"} ${Math.abs(t.valor - valor) < 0.01 ? "font-semibold" : ""}`}
                      >
                        {formatarMoeda(doLado(t) ? t.valor : -t.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!varias && (
            <div className="space-y-3 text-sm">
              <div className="space-y-1">
                <p className="font-medium">Sem título correspondente?</p>
                <p className="text-xs text-texto-suave">
                  A conciliação só dá baixa. Crie o título no contas {saida ? "a pagar" : "a receber"} (já vai preenchido com esta linha) e volte aqui para conciliar.
                </p>
                <Link href={linkCriar} className={`${estiloBotao} py-1.5`}>
                  Criar conta {saida ? "a pagar" : "a receber"}
                </Link>
              </div>
              <div className="flex flex-wrap items-start gap-3 border-t border-borda pt-3">
                <FormAcao acao={() => depois(marcarTransferencia(linha.id))} rotulo="É transferência entre contas" secundario />
              </div>
              <FormAcao acao={(e, f) => depois(ignorar(linha.id, e, f))} rotulo="Ignorar" secundario className="flex flex-wrap items-center gap-2 border-t border-borda pt-3">
                <input name="motivo" placeholder="Motivo (ex.: estorno que se anula)" className={`${estiloCampo} w-auto flex-1 py-1.5`} />
              </FormAcao>
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}
