"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FormAcao } from "@/components/form-acao";
import { Campo, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import type { Estado } from "@/lib/erros";
import { formatarMoeda, lerNumero } from "@/lib/formato";
import { PRIORIDADES } from "@/lib/rotulos";
import type { Produto } from "@/lib/vendas";

export type PedidoForm = {
  empresa_id: string;
  cliente_id: string;
  data_pedido: string;
  prazo_entrega: string | null;
  condicao_pagamento: string | null;
  prazo_recebimento_dias: number;
  prioridade: number;
  observacao: string | null;
  itens: { item_id: string; quantidade: number; preco_unitario: number }[];
};

type Linha = { chave: number; item_id: string; quantidade: string; preco: string };

const paraTexto = (v: number) => String(v).replace(".", ",");

// Cabeçalho e itens do pedido. Os itens vão num campo oculto (JSON).
export function FormPedido({
  acao,
  pedido,
  empresas,
  clientes,
  produtos,
  hoje,
  voltar,
}: {
  acao: (estado: Estado, form: FormData) => Promise<Estado>;
  pedido?: PedidoForm;
  empresas: { id: string; nome: string }[];
  clientes: { id: string; nome: string }[];
  produtos: Produto[];
  hoje: string;
  voltar: string;
}) {
  const [linhas, setLinhas] = useState<Linha[]>(
    pedido?.itens.length
      ? pedido.itens.map((i, k) => ({
          chave: k,
          item_id: i.item_id,
          quantidade: paraTexto(i.quantidade),
          preco: paraTexto(i.preco_unitario),
        }))
      : [{ chave: 0, item_id: "", quantidade: "1", preco: "" }],
  );
  const mudar = (chave: number, campo: keyof Linha, valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  const total = linhas.reduce((s, l) => s + (lerNumero(l.quantidade) || 0) * (lerNumero(l.preco) || 0), 0);
  const itens = linhas.map((l) => ({ item_id: l.item_id, quantidade: lerNumero(l.quantidade), preco_unitario: lerNumero(l.preco) }));
  const porId = new Map(produtos.map((p) => [p.id, p]));

  return (
    <FormAcao acao={acao} rotulo="Salvar pedido" className="space-y-5">
      <input type="hidden" name="itens" value={JSON.stringify(itens)} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Empresa que vende" className="sm:col-span-2">
          <select
            name="empresa_id"
            required
            defaultValue={pedido?.empresa_id ?? (empresas.length === 1 ? empresas[0].id : "")}
            disabled={!!pedido}
            className={estiloCampo}
          >
            <option value="" disabled>
              Escolha...
            </option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          rotulo="Cliente (distribuidor)"
          className="sm:col-span-2"
          dica={clientes.length === 0 ? "Cadastre o cliente em Vendas > Clientes." : undefined}
        >
          <select name="cliente_id" required defaultValue={pedido?.cliente_id ?? ""} className={estiloCampo}>
            <option value="" disabled>
              Escolha...
            </option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Data do pedido">
          <input
            name="data_pedido"
            type="date"
            required
            defaultValue={pedido?.data_pedido ?? hoje}
            disabled={!!pedido}
            className={estiloCampo}
          />
        </Campo>
        <Campo rotulo="Prazo de entrega" dica="Usado para o atraso e a fila de produção.">
          <input name="prazo_entrega" type="date" defaultValue={pedido?.prazo_entrega ?? ""} className={estiloCampo} />
        </Campo>
        <Campo rotulo="Condição de pagamento">
          <input
            name="condicao_pagamento"
            placeholder="Ex.: 28/56 dias, boleto"
            defaultValue={pedido?.condicao_pagamento ?? ""}
            className={estiloCampo}
          />
        </Campo>
        <Campo rotulo="Recebimento (dias após entrega)" dica="0 = à vista. Pesa na fila de produção.">
          <input
            name="prazo_recebimento_dias"
            type="number"
            min={0}
            defaultValue={pedido?.prazo_recebimento_dias ?? 28}
            className={estiloCampo}
          />
        </Campo>
        <Campo rotulo="Prioridade">
          <select name="prioridade" defaultValue={pedido?.prioridade ?? 0} className={estiloCampo}>
            {Object.entries(PRIORIDADES).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Observação" className="sm:col-span-2 lg:col-span-3">
          <input name="observacao" defaultValue={pedido?.observacao ?? ""} className={estiloCampo} />
        </Campo>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Produtos</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-texto-suave">
                <th className="pb-1 pr-2 font-medium">Produto</th>
                <th className="w-28 pb-1 pr-2 font-medium">Quantidade</th>
                <th className="w-36 pb-1 pr-2 font-medium">Preço unitário (R$)</th>
                <th className="w-32 pb-1 pr-2 text-right font-medium">Total</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave}>
                  <td className="py-1 pr-2">
                    <select
                      aria-label="Produto"
                      value={l.item_id}
                      onChange={(e) => mudar(l.chave, "item_id", e.target.value)}
                      className={estiloCampo}
                    >
                      <option value="">Escolha o produto...</option>
                      {produtos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.codigo} · {p.descricao}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1">
                      <input
                        aria-label="Quantidade"
                        inputMode="decimal"
                        value={l.quantidade}
                        onChange={(e) => mudar(l.chave, "quantidade", e.target.value)}
                        className={estiloCampo}
                      />
                      <span className="text-xs text-texto-suave">{porId.get(l.item_id)?.unidade}</span>
                    </div>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label="Preço unitário"
                      inputMode="decimal"
                      value={l.preco}
                      onChange={(e) => mudar(l.chave, "preco", e.target.value)}
                      className={estiloCampo}
                    />
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {formatarMoeda((lerNumero(l.quantidade) || 0) * (lerNumero(l.preco) || 0))}
                  </td>
                  <td className="py-1 text-right">
                    {linhas.length > 1 && (
                      <button
                        type="button"
                        aria-label="Tirar produto"
                        onClick={() => setLinhas((atual) => atual.filter((x) => x.chave !== l.chave))}
                        className="rounded p-1 text-texto-suave hover:text-perigo"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-2">
                  <button
                    type="button"
                    onClick={() =>
                      setLinhas((atual) => [
                        ...atual,
                        { chave: Math.max(...atual.map((x) => x.chave)) + 1, item_id: "", quantidade: "1", preco: "" },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-sm text-primaria hover:underline"
                  >
                    <Plus size={14} /> Adicionar produto
                  </button>
                </td>
                <td colSpan={2} className="pt-2 text-right text-texto-suave">
                  Total do pedido
                </td>
                <td className="pt-2 pr-2 text-right font-semibold tabular-nums">{formatarMoeda(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div className="flex justify-end">
        <Link href={voltar} className={estiloBotaoSecundario}>
          Cancelar
        </Link>
      </div>
    </FormAcao>
  );
}
