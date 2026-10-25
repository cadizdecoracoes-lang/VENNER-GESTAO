"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FormAcao } from "@/components/form-acao";
import { Cartao, estiloBotao, estiloCampo } from "@/components/ui";
import type { Estado } from "@/lib/erros";
import type { TituloCandidato } from "@/lib/extrato";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { conciliar, ignorar, marcarTransferencia } from "./actions";
import type { LinhaConciliacao } from "./dados";

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Resolve uma linha do extrato: escolher os títulos que ela quita, marcar como
// transferência ou ignorar. A conciliação não lança nada: sem título, o atalho
// abre a conta nova no pagar/receber já preenchida.
export function PainelResolver({
  linha,
  candidatos,
  linkCriar,
  voltar,
}: {
  linha: LinhaConciliacao;
  candidatos: TituloCandidato[];
  linkCriar: string;
  voltar: string;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const valor = Math.abs(Number(linha.valor));
  const saida = Number(linha.valor) < 0;

  const lista = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    return candidatos
      .filter((t) => {
        const texto = semAcento(`${t.pessoa ?? ""} ${t.descricao} ${formatarMoeda(t.valor)} ${formatarData(t.data)}`);
        return termos.every((p) => texto.includes(p));
      })
      .sort((a, b) => {
        // Valor igual primeiro, depois a data mais perto.
        const va = Math.abs(a.valor - valor) < 0.01 ? 0 : 1;
        const vb = Math.abs(b.valor - valor) < 0.01 ? 0 : 1;
        const da = Math.abs(Date.parse(a.data) - Date.parse(linha.data));
        const db = Math.abs(Date.parse(b.data) - Date.parse(linha.data));
        return va - vb || da - db;
      })
      .slice(0, 200);
  }, [candidatos, busca, valor, linha.data]);

  const escolhidos = candidatos.filter((t) => marcados.has(t.id));
  // Com um título só em aberto, a baixa usa o valor do extrato (juros/desconto).
  const soma = escolhidos.length === 1 && !escolhidos[0].pago ? valor : escolhidos.reduce((s, t) => s + t.valor, 0);
  const diferenca = Math.round((soma - valor) * 100) / 100;

  function alternar(id: string) {
    const n = new Set(marcados);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setMarcados(n);
  }

  function enviar() {
    setErro(null);
    const ids = [...marcados];
    iniciar(async () => {
      const r = await conciliar(linha.id, saida ? ids : [], saida ? [] : ids);
      if (r.erro) setErro(r.erro);
      else router.push(voltar);
    });
  }

  const depois = async (p: Promise<Estado>) => {
    const r = await p;
    if (!r.erro) router.push(voltar);
    return r;
  };

  return (
    <Cartao
      titulo={`${formatarData(linha.data)} · ${linha.descricao} · ${formatarMoeda(Number(linha.valor))}`}
      acoes={
        <Link href={voltar} className="text-sm text-texto-suave hover:underline">
          Fechar
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={`Buscar ${saida ? "conta a pagar" : "conta a receber"} por nome, descrição, valor...`}
              className={`${estiloCampo} max-w-md py-1.5`}
            />
            <span className="text-sm text-texto-suave">
              Escolhidos: <strong className="tabular-nums text-texto">{formatarMoeda(soma)}</strong> de {formatarMoeda(valor)}
              {escolhidos.length > 1 && diferenca !== 0 && <span className="text-perigo"> · falta {formatarMoeda(-diferenca)}</span>}
              {escolhidos.length === 1 && !escolhidos[0].pago && Math.abs(escolhidos[0].valor - valor) > 0.009 && (
                <span className="text-alerta"> · baixa pelo valor do extrato (título de {formatarMoeda(escolhidos[0].valor)})</span>
              )}
            </span>
            <button type="button" onClick={enviar} disabled={!marcados.size || pendente || (escolhidos.length > 1 && diferenca !== 0)} className={`${estiloBotao} py-1.5`}>
              {pendente ? "Conciliando..." : "Conciliar escolhidos"}
            </button>
          </div>
          {erro && <p className="text-sm text-perigo">{erro}</p>}
          <div className="max-h-72 overflow-auto rounded-lg border border-borda">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-borda/70">
                {lista.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-texto-suave">
                      Nenhum título {saida ? "a pagar" : "a receber"} perto desta data. Crie o título pelo atalho ao lado.
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
                    </td>
                    <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${Math.abs(t.valor - valor) < 0.01 ? "font-semibold" : ""}`}>
                      {formatarMoeda(t.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

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
      </div>
    </Cartao>
  );
}
