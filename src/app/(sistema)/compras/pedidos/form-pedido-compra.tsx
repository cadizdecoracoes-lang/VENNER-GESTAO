"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FormAcao } from "@/components/form-acao";
import { Campo, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import { totalPedidoCompra, type MaterialCompra } from "@/lib/compras";
import type { Estado } from "@/lib/erros";
import { formatarMoeda, lerNumero } from "@/lib/formato";
import { FRETE_POR_CONTA, MEIOS_PAGAMENTO } from "@/lib/rotulos";

export type PedidoCompraForm = {
  empresa_id: string;
  fornecedor_id: string | null;
  categoria_id: string | null;
  data_pedido: string;
  data_prevista: string | null;
  condicao_pagamento: string | null;
  dias_parcelas: string;
  meio_pagamento: string | null;
  frete_por_conta: string | null;
  transportador: string | null;
  valor_frete: number;
  valor_desconto: number;
  observacoes: string | null;
  observacoes_internas: string | null;
  itens: { item_id: string; quantidade: number; valor_unitario: number; aliquota_ipi: number; informacoes_adicionais: string | null }[];
};

type Linha = { chave: number; item_id: string; quantidade: string; valor: string; ipi: string; info: string };

const paraTexto = (v: number) => String(v).replace(".", ",");

// Mesmos campos da ordem de compra do Tiny. Os itens vão num campo oculto (JSON).
export function FormPedidoCompra({
  acao,
  pedido,
  empresas,
  fornecedores,
  categorias,
  itens,
  hoje,
  voltar,
  editando = false,
}: {
  acao: (estado: Estado, form: FormData) => Promise<Estado>;
  pedido?: PedidoCompraForm;
  empresas: { id: string; nome: string }[];
  fornecedores: { id: string; nome: string }[];
  categorias: { id: string; codigo: string; nome: string }[];
  itens: MaterialCompra[];
  hoje: string;
  voltar: string;
  editando?: boolean;
}) {
  const [linhas, setLinhas] = useState<Linha[]>(
    pedido?.itens.length
      ? pedido.itens.map((i, k) => ({
          chave: k,
          item_id: i.item_id,
          quantidade: paraTexto(i.quantidade),
          valor: paraTexto(i.valor_unitario),
          ipi: paraTexto(i.aliquota_ipi),
          info: i.informacoes_adicionais ?? "",
        }))
      : [{ chave: 0, item_id: "", quantidade: "1", valor: "", ipi: "0", info: "" }],
  );
  const [frete, setFrete] = useState(paraTexto(pedido?.valor_frete ?? 0));
  const [desconto, setDesconto] = useState(paraTexto(pedido?.valor_desconto ?? 0));
  const mudar = (chave: number, campo: keyof Linha, valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  const lista = linhas.map((l) => ({
    item_id: l.item_id,
    quantidade: lerNumero(l.quantidade),
    valor_unitario: lerNumero(l.valor),
    aliquota_ipi: lerNumero(l.ipi) || 0,
    informacoes_adicionais: l.info,
  }));
  const conta = totalPedidoCompra(lista, lerNumero(frete) || 0, lerNumero(desconto) || 0);
  const porId = new Map(itens.map((p) => [p.id, p]));

  return (
    <FormAcao
      acao={acao}
      rotulo="Salvar pedido"
      className="space-y-3"
      extra={
        <Link href={voltar} className={estiloBotaoSecundario}>
          Cancelar
        </Link>
      }
    >
      <input type="hidden" name="itens" value={JSON.stringify(lista)} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Empresa que compra" className="sm:col-span-2">
          <select
            name="empresa_id"
            required
            defaultValue={pedido?.empresa_id ?? (empresas.length === 1 ? empresas[0].id : "")}
            disabled={editando}
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
        <Campo rotulo="Fornecedor" className="sm:col-span-2" dica="Pode ficar em branco: o orçamento escolhido define.">
          <select name="fornecedor_id" defaultValue={pedido?.fornecedor_id ?? ""} className={estiloCampo}>
            <option value="">A definir pelo orçamento</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Data do pedido">
          <input name="data_pedido" type="date" required defaultValue={pedido?.data_pedido ?? hoje} className={estiloCampo} />
        </Campo>
        <Campo rotulo="Data prevista de entrega">
          <input name="data_prevista" type="date" defaultValue={pedido?.data_prevista ?? ""} className={estiloCampo} />
        </Campo>
        <Campo rotulo="Categoria financeira" className="sm:col-span-2">
          <select name="categoria_id" defaultValue={pedido?.categoria_id ?? ""} className={estiloCampo}>
            <option value="">Sem categoria</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} · {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Condição de pagamento">
          <input
            name="condicao_pagamento"
            placeholder="Ex.: 30/60 dias, boleto"
            defaultValue={pedido?.condicao_pagamento ?? ""}
            className={estiloCampo}
          />
        </Campo>
        <Campo rotulo="Parcelas (dias)" dica="Ex.: 30/60/90. Vazio = sem parcelas ainda.">
          <input name="dias_parcelas" placeholder="30/60" defaultValue={pedido?.dias_parcelas ?? ""} className={estiloCampo} />
        </Campo>
        <Campo rotulo="Meio de pagamento">
          <select name="meio_pagamento" defaultValue={pedido?.meio_pagamento ?? ""} className={estiloCampo}>
            <option value="">—</option>
            {Object.entries(MEIOS_PAGAMENTO).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Frete por conta">
          <select name="frete_por_conta" defaultValue={pedido?.frete_por_conta ?? ""} className={estiloCampo}>
            <option value="">—</option>
            {Object.entries(FRETE_POR_CONTA).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Transportador">
          <input name="transportador" defaultValue={pedido?.transportador ?? ""} className={estiloCampo} />
        </Campo>
        <Campo rotulo="Frete (R$)">
          <input name="valor_frete" inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} className={estiloCampo} />
        </Campo>
        <Campo rotulo="Desconto (R$)">
          <input
            name="valor_desconto"
            inputMode="decimal"
            value={desconto}
            onChange={(e) => setDesconto(e.target.value)}
            className={estiloCampo}
          />
        </Campo>
        <Campo rotulo="Observações (vão para o fornecedor)" className="sm:col-span-2">
          <input name="observacoes" defaultValue={pedido?.observacoes ?? ""} className={estiloCampo} />
        </Campo>
        <Campo rotulo="Observações internas" className="sm:col-span-2">
          <input name="observacoes_internas" defaultValue={pedido?.observacoes_internas ?? ""} className={estiloCampo} />
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
                <th className="w-32 pb-1 pr-2 font-medium">Valor unitário (R$)</th>
                <th className="w-20 pb-1 pr-2 font-medium">IPI %</th>
                <th className="w-40 pb-1 pr-2 font-medium">Informações adicionais</th>
                <th className="w-28 pb-1 pr-2 text-right font-medium">Total</th>
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
                      onChange={(e) => {
                        const custo = Number(porId.get(e.target.value)?.custo_medio ?? 0);
                        // Último custo médio como ponto de partida, quando a linha está sem valor.
                        setLinhas((atual) =>
                          atual.map((x) =>
                            x.chave === l.chave
                              ? { ...x, item_id: e.target.value, valor: x.valor || custo <= 0 ? x.valor : paraTexto(custo) }
                              : x,
                          ),
                        );
                      }}
                      className={estiloCampo}
                    >
                      <option value="">Escolha o produto...</option>
                      {itens.map((p) => (
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
                      aria-label="Valor unitário"
                      inputMode="decimal"
                      value={l.valor}
                      onChange={(e) => mudar(l.chave, "valor", e.target.value)}
                      className={estiloCampo}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label="Alíquota de IPI"
                      inputMode="decimal"
                      value={l.ipi}
                      onChange={(e) => mudar(l.chave, "ipi", e.target.value)}
                      className={estiloCampo}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label="Informações adicionais"
                      value={l.info}
                      onChange={(e) => mudar(l.chave, "info", e.target.value)}
                      className={estiloCampo}
                    />
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {formatarMoeda((lerNumero(l.quantidade) || 0) * (lerNumero(l.valor) || 0))}
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
                        { chave: Math.max(...atual.map((x) => x.chave)) + 1, item_id: "", quantidade: "1", valor: "", ipi: "0", info: "" },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-sm text-primaria hover:underline"
                  >
                    <Plus size={14} /> Adicionar produto
                  </button>
                </td>
                <td colSpan={4} className="pt-2 text-right text-xs text-texto-suave">
                  Itens {formatarMoeda(conta.itens)} + IPI {formatarMoeda(conta.ipi)} + frete − desconto
                </td>
                <td className="pt-2 pr-2 text-right font-semibold tabular-nums">{formatarMoeda(conta.total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </FormAcao>
  );
}
