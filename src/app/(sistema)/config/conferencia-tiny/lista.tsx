"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Filtro } from "@/components/filtro";
import { Celula, Tabela, estiloBotao, estiloBotaoSecundario } from "@/components/ui";
import {
  NOME_MODULO,
  NOME_PROBLEMA,
  chaveDiferenca,
  escolhidosPorModulo,
  linkRegistro,
  type Diferenca,
  type ModuloConferencia,
  type Problema,
} from "@/lib/conferencia-tiny";
import { mensagemErro } from "@/lib/erros";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { revalidatePath } from "@/lib/navegacao";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

const COR_PROBLEMA: Record<Problema, "perigo" | "alerta" | undefined> = {
  falta_aqui: "perigo",
  sobra_aqui: "perigo",
  diferente: "alerta",
  so_aqui: undefined,
};

const lado = (situacao: string | null, valor: number | null, data: string | null) =>
  [situacao, valor !== null ? formatarMoeda(Number(valor)) : null, data ? formatarData(data) : null].filter(Boolean).join(" · ") || "—";

// Lista das diferenças, com a escolha dos itens para "Deixar igual ao Tiny".
export function ListaDiferencas({ lista, corrigir }: { lista: Diferenca[]; corrigir: boolean }) {
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ erro?: string; ok?: string } | null>(null);
  const area = useRef<HTMLDivElement>(null);

  const corrigiveis = lista.filter((d) => d.corrigivel);
  const marcados = corrigiveis.filter((d) => escolhidos.has(chaveDiferenca(d)));
  const porProblema = (p: Problema) => lista.filter((d) => d.problema === p).length;

  function trocar(chave: string) {
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  }

  // Marca as linhas que o filtro deixou à vista.
  function marcarVisiveis() {
    const visiveis = [...(area.current?.querySelectorAll<HTMLTableRowElement>("tr[data-chave]") ?? [])]
      .filter((tr) => !tr.hidden && tr.dataset.corrigivel === "1")
      .map((tr) => tr.dataset.chave!);
    setEscolhidos(new Set(visiveis));
  }

  async function igualar() {
    if (!supabaseConfigurado) return;
    setOcupado(true);
    setAviso(null);
    const supabase = criarClienteNavegador();
    let igualados = 0;
    let conciliados = 0;
    for (const [modulo, numeros] of Object.entries(escolhidosPorModulo(lista, escolhidos))) {
      const { data, error } = await supabase.rpc("igualar_ao_tiny", { modulo, numeros });
      if (error) {
        setOcupado(false);
        return setAviso({ erro: mensagemErro(error) });
      }
      igualados += Number((data as { igualados?: number })?.igualados ?? 0);
      conciliados += Number((data as { conciliados?: number })?.conciliados ?? 0);
    }
    setOcupado(false);
    setConfirmando(false);
    setEscolhidos(new Set());
    setAviso({
      ok:
        `${igualados} ${igualados === 1 ? "item mandado" : "itens mandados"} para ficar igual ao Tiny. O robô relê em até 1 minuto e a lista se atualiza sozinha.` +
        (conciliados ? ` ${conciliados} conciliado(s) com o extrato ficaram como estão.` : ""),
    });
    revalidatePath("/config/conferencia-tiny");
  }

  return (
    <div ref={area} className="space-y-2">
      {aviso?.erro && <p className="rounded-lg bg-perigo/10 px-3 py-1.5 text-sm text-perigo">{aviso.erro}</p>}
      {aviso?.ok && <p className="rounded-lg bg-sucesso/10 px-3 py-1.5 text-sm text-sucesso">{aviso.ok}</p>}

      {confirmando && (
        <div className="space-y-2 rounded-xl bg-superficie px-3 py-2 text-sm shadow-[0_0_0_1.5px_var(--color-alerta)]">
          <p>
            <b>{marcados.length}</b> {marcados.length === 1 ? "item vai" : "itens vão"} ficar igual ao Tiny. O que foi alterado ou excluído
            aqui nesses itens será substituído pelo que está no Tiny:
          </p>
          <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-xs text-texto-suave">
            {marcados.map((d) => (
              <li key={chaveDiferenca(d)}>
                {NOME_MODULO[d.modulo]} · {d.referencia ?? `Tiny nº ${d.tiny_id}`}: {lado(d.venner_situacao, d.venner_valor, d.venner_data)} →{" "}
                {d.problema === "sobra_aqui" ? "como no Tiny (apagado lá)" : lado(d.tiny_situacao, d.tiny_valor, d.tiny_data)}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" className={estiloBotao} disabled={ocupado} onClick={igualar}>
              {ocupado ? "Mandando..." : "Confirmar"}
            </button>
            <button type="button" className={estiloBotaoSecundario} disabled={ocupado} onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <Filtro
        periodo={false}
        situacoes={{
          rotulo: "Problema",
          opcoes: [
            { valor: "", rotulo: "Todas", quantidade: lista.length },
            ...(["falta_aqui", "sobra_aqui", "diferente", "so_aqui"] as Problema[]).map((p) => ({
              valor: p,
              rotulo: NOME_PROBLEMA[p],
              quantidade: porProblema(p),
              cor: COR_PROBLEMA[p],
            })),
          ],
        }}
        atalhos={[
          {
            rotulo: "Módulo",
            opcoes: (Object.keys(NOME_MODULO) as ModuloConferencia[])
              .filter((m) => lista.some((d) => d.modulo === m))
              .map((m) => ({ valor: m, rotulo: NOME_MODULO[m] })),
          },
        ]}
        ferramentas={
          corrigir && corrigiveis.length > 0 ? (
            <span className="flex items-center gap-2">
              <button type="button" className={estiloBotaoSecundario} onClick={marcarVisiveis}>
                Marcar os da lista
              </button>
              <button type="button" className={estiloBotao} disabled={!marcados.length || ocupado} onClick={() => setConfirmando(true)}>
                Deixar igual ao Tiny{marcados.length ? ` (${marcados.length})` : ""}
              </button>
            </span>
          ) : undefined
        }
      >
        <Tabela
          colunas={["", "Módulo", "Problema", "Registro", "No Tiny", "Aqui", "Motivo"]}
          vazio="Nenhuma diferença: o sistema está igual ao Tiny."
        >
          {lista.map((d) => {
            const chave = chaveDiferenca(d);
            const link = linkRegistro(d);
            return (
              <tr key={chave} data-chave={chave} data-corrigivel={d.corrigivel ? "1" : "0"} data-tags={`${d.problema} ${d.modulo}`}>
                <Celula className="w-6">
                  {corrigir && d.corrigivel && (
                    <input type="checkbox" checked={escolhidos.has(chave)} onChange={() => trocar(chave)} aria-label="Escolher" />
                  )}
                </Celula>
                <Celula className="whitespace-nowrap">{NOME_MODULO[d.modulo]}</Celula>
                <Celula className="whitespace-nowrap">
                  <span className={COR_PROBLEMA[d.problema] === "perigo" ? "text-perigo" : COR_PROBLEMA[d.problema] === "alerta" ? "text-alerta" : ""}>
                    {NOME_PROBLEMA[d.problema]}
                  </span>
                  {d.campos && <span className="ml-1 text-xs text-texto-suave">{d.campos}</span>}
                </Celula>
                <Celula>
                  {link ? (
                    <Link href={link} className="text-primaria hover:underline">
                      {d.referencia ?? "Abrir"}
                    </Link>
                  ) : (
                    (d.referencia ?? "—")
                  )}
                  {d.tiny_id !== null && <span className="ml-1 text-xs text-texto-suave">Tiny nº {d.tiny_id}</span>}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums">{lado(d.tiny_situacao, d.tiny_valor, d.tiny_data)}</Celula>
                <Celula className="whitespace-nowrap tabular-nums">{lado(d.venner_situacao, d.venner_valor, d.venner_data)}</Celula>
                <Celula className="text-xs text-texto-suave">{d.motivo}</Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
    </div>
  );
}
