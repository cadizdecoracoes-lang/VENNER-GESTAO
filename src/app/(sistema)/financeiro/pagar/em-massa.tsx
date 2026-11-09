"use client";

import { CheckSquare, X } from "lucide-react";
import { startTransition, useActionState, useEffect, useState } from "react";
import { CampoBusca, type OpcaoBusca } from "@/components/campo-busca";
import { useSelecao } from "@/components/selecao";
import { estiloBotao, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import type { Estado } from "@/lib/erros";
import { formatarMoeda } from "@/lib/formato";
import { alterarEmMassa, cancelarEmMassa, pagarEmMassa } from "./actions";

type Banco = { id: string; nome: string; empresa_id: string };

// Barra que aparece embaixo quando há contas marcadas: pagar, alterar ou
// cancelar todas de uma vez.
export function BarraEmMassa({
  bancos,
  fornecedores,
  categorias,
  centros,
  hoje,
}: {
  bancos: Banco[];
  fornecedores: OpcaoBusca[];
  categorias: OpcaoBusca[];
  centros: OpcaoBusca[];
  hoje: string;
}) {
  const { marcados, definir } = useSelecao();
  const [modo, setModo] = useState<"pagar" | "alterar" | null>(null);
  const [linhas, setLinhas] = useState<{ empresa: string; soma: number }[]>([]);

  useEffect(() => {
    const achadas = [...document.querySelectorAll<HTMLInputElement>("input[data-selecao]")]
      .filter((c) => marcados.has(c.value))
      .map((c) => {
        const tr = c.closest("tr");
        return { empresa: tr?.dataset.empresa ?? "", soma: Number(tr?.dataset.soma ?? 0) };
      });
    setLinhas(achadas);
    if (marcados.size === 0) setModo(null);
  }, [marcados]);

  if (marcados.size === 0) return null;
  const ids = [...marcados].join(",");
  const empresas = new Set(linhas.map((l) => l.empresa));
  const soma = linhas.reduce((s, l) => s + l.soma, 0);
  const limpar = () => definir([]);

  return (
    <div className="sticky bottom-0 z-20 -mx-1 rounded-xl bg-superficie px-3 py-2 shadow-[0_-4px_16px_rgba(16,24,40,0.12)]">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CheckSquare size={16} className="text-primaria" />
        <span>
          <span className="font-semibold">{marcados.size}</span> {marcados.size === 1 ? "conta marcada" : "contas marcadas"} ·{" "}
          <span className="font-semibold tabular-nums">{formatarMoeda(soma)}</span>
        </span>
        <span className="mx-1 h-4 w-px bg-borda" />
        <button type="button" onClick={() => setModo(modo === "pagar" ? null : "pagar")} className={modo === "pagar" ? estiloBotao : estiloBotaoSecundario}>
          Pagar
        </button>
        <button type="button" onClick={() => setModo(modo === "alterar" ? null : "alterar")} className={modo === "alterar" ? estiloBotao : estiloBotaoSecundario}>
          Alterar
        </button>
        <FormMassa
          acao={cancelarEmMassa}
          ids={ids}
          rotulo="Cancelar"
          discreto
          confirmar={`Cancelar ${marcados.size} conta(s)? Elas podem ser reabertas depois em Canceladas.`}
          aoTerminar={limpar}
        />
        <button type="button" onClick={limpar} className="ml-auto inline-flex items-center gap-1 text-xs text-texto-suave hover:text-texto">
          <X size={14} /> Desmarcar
        </button>
      </div>

      {modo === "pagar" &&
        (empresas.size > 1 ? (
          <p className="mt-2 text-sm text-perigo">Para pagar em massa, marque contas de uma empresa só (cada CNPJ paga pela sua conta bancária).</p>
        ) : (
          <FormMassa acao={pagarEmMassa} ids={ids} rotulo={`Pagar ${marcados.size} conta(s)`} aoTerminar={limpar} confirmar="Confirmar o pagamento das contas marcadas, cada uma pelo seu valor?">
            <input name="data_pagamento" type="date" required defaultValue={hoje} aria-label="Data do pagamento" className={`${estiloCampo} w-40`} />
            <select name="conta_bancaria_id" required defaultValue="" aria-label="Conta bancária" className={`${estiloCampo} w-56`}>
              <option value="" disabled>
                Conta bancária...
              </option>
              {bancos
                .filter((b) => empresas.has(b.empresa_id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
            </select>
            <span className="text-xs text-texto-suave">Cada conta é paga pelo seu valor; juros e multa, pague uma a uma.</span>
          </FormMassa>
        ))}

      {modo === "alterar" && (
        <FormMassa acao={alterarEmMassa} ids={ids} rotulo="Aplicar nas marcadas" aoTerminar={limpar}>
          <label className="text-xs text-texto-suave">
            Vencimento
            <input name="vencimento" type="date" className={`${estiloCampo} w-40`} />
          </label>
          <label className="w-64 text-xs text-texto-suave">
            Categoria
            <CampoBusca name="categoria_id" opcoes={categorias} vazio={null} placeholder="Não mudar" acima />
          </label>
          <label className="w-56 text-xs text-texto-suave">
            Centro de custo
            <CampoBusca name="centro_custo_id" opcoes={[{ id: "nenhum", nome: "Nenhum (tirar)" }, ...centros]} vazio={null} placeholder="Não mudar" acima />
          </label>
          <label className="w-64 text-xs text-texto-suave">
            Fornecedor
            <CampoBusca name="fornecedor_id" opcoes={fornecedores} vazio={null} placeholder="Não mudar" acima />
          </label>
          <span className="self-end pb-1.5 text-xs text-texto-suave">Só os campos preenchidos mudam.</span>
        </FormMassa>
      )}
    </div>
  );
}

function FormMassa({
  acao,
  ids,
  rotulo,
  discreto = false,
  confirmar,
  aoTerminar,
  children,
}: {
  acao: (e: Estado, f: FormData) => Promise<Estado>;
  ids: string;
  rotulo: string;
  discreto?: boolean;
  confirmar?: string;
  aoTerminar: () => void;
  children?: React.ReactNode;
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  useEffect(() => {
    if (estado?.ok) aoTerminar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado?.ok]);
  return (
    <form
      className={discreto ? "contents" : "mt-2 flex flex-wrap items-end gap-2"}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmar && !window.confirm(confirmar)) return;
        const dados = new FormData(e.currentTarget);
        startTransition(() => enviar(dados));
      }}
    >
      <input type="hidden" name="ids" value={ids} />
      {children}
      <button type="submit" disabled={pendente} className={discreto ? "text-sm text-texto-suave hover:text-perigo disabled:opacity-60" : estiloBotao}>
        {pendente ? "Salvando..." : rotulo}
      </button>
      {estado?.erro && <p className="text-sm text-perigo">{estado.erro}</p>}
    </form>
  );
}
