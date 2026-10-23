"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FormAcao } from "@/components/form-acao";
import { Campo, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import { CAMPOS_ENDERECO, FRETE_POR_CONTA, lerDias } from "@/lib/cadastros-comercial";
import type { Estado } from "@/lib/erros";
import { formatarMoeda, lerNumero } from "@/lib/formato";
import { dividirParcelas } from "@/lib/parcelas";
import { PRIORIDADES } from "@/lib/rotulos";
import type { Opcao, OpcoesPedido, Produto } from "@/lib/vendas";

export type ParcelaForm = { dias: number | null; vencimento: string | null; valor: number; observacao: string | null };

export type PedidoForm = {
  empresa_id: string;
  cliente_id: string;
  data_pedido: string;
  prazo_entrega: string | null;
  condicao_pagamento: string | null;
  prazo_recebimento_dias: number;
  prioridade: number;
  observacao: string | null;
  numero_ordem_compra?: string | null;
  vendedor_cadastro_id?: string | null;
  lista_preco_id?: string | null;
  natureza_operacao_id?: string | null;
  forma_pagamento_id?: string | null;
  categoria_id?: string | null;
  transportadora_id?: string | null;
  forma_envio_id?: string | null;
  frete_por_conta?: string | null;
  valor_frete?: number;
  valor_desconto?: number;
  valor_outras_despesas?: number;
  endereco_entrega?: Record<string, string> | null;
  observacao_interna?: string | null;
  parcelas?: ParcelaForm[];
  itens: { item_id: string; quantidade: number; preco_unitario: number; info_adicional?: string | null }[];
};

type Linha = { chave: number; item_id: string; quantidade: string; preco: string; info: string };
type LinhaParcela = { chave: number; dias: string; vencimento: string; valor: string; observacao: string };

const paraTexto = (v: number | null | undefined) => (v ? String(v).replace(".", ",") : "");
const arredondar = (v: number) => Math.round(v * 100) / 100;

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t border-borda pt-4">
      <legend className="pr-2 text-sm font-semibold">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function Escolha({ nome, opcoes, valor, vazio = "—" }: { nome: string; opcoes: Opcao[]; valor?: string | null; vazio?: string }) {
  return (
    <select name={nome} defaultValue={valor ?? ""} className={estiloCampo}>
      <option value="">{vazio}</option>
      {opcoes.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nome}
        </option>
      ))}
    </select>
  );
}

// Pedido com os mesmos blocos do Tiny: cliente, dados gerais, itens, totais,
// pagamento (parcelas), transporte e observações. Itens, parcelas e endereço
// de entrega vão em campos ocultos (JSON).
export function FormPedido({
  acao,
  pedido,
  empresas,
  clientes,
  produtos,
  opcoes,
  hoje,
  voltar,
}: {
  acao: (estado: Estado, form: FormData) => Promise<Estado>;
  pedido?: PedidoForm;
  empresas: { id: string; nome: string }[];
  clientes: { id: string; nome: string }[];
  produtos: Produto[];
  opcoes: OpcoesPedido;
  hoje: string;
  voltar: string;
}) {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const [listaId, setListaId] = useState(pedido?.lista_preco_id ?? "");
  const lista = opcoes.listas.find((l) => l.id === listaId);
  // Preço do produto na lista escolhida: o próprio da lista ou o de venda com o acréscimo/desconto.
  const precoNaLista = (itemId: string, l = lista) => {
    if (l?.precos[itemId] !== undefined) return l.precos[itemId];
    const base = Number(porId.get(itemId)?.preco_venda ?? 0);
    return arredondar(base * (1 + (l?.acrescimo_desconto ?? 0) / 100));
  };

  const [linhas, setLinhas] = useState<Linha[]>(
    pedido?.itens.length
      ? pedido.itens.map((i, k) => ({
          chave: k,
          item_id: i.item_id,
          quantidade: paraTexto(i.quantidade),
          preco: paraTexto(i.preco_unitario),
          info: i.info_adicional ?? "",
        }))
      : [{ chave: 0, item_id: "", quantidade: "1", preco: "", info: "" }],
  );
  const mudar = (chave: number, campo: keyof Linha, valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));

  const [dataPedido, setDataPedido] = useState(pedido?.data_pedido ?? hoje);
  const [frete, setFrete] = useState(paraTexto(pedido?.valor_frete));
  const [desconto, setDesconto] = useState(paraTexto(pedido?.valor_desconto));
  const [outras, setOutras] = useState(paraTexto(pedido?.valor_outras_despesas));
  const [condicao, setCondicao] = useState(pedido?.condicao_pagamento ?? "");
  const [formaPagamento, setFormaPagamento] = useState(pedido?.forma_pagamento_id ?? "");
  const [parcelas, setParcelas] = useState<LinhaParcela[]>(
    (pedido?.parcelas ?? []).map((p, k) => ({
      chave: k,
      dias: p.dias === null ? "" : String(p.dias),
      vencimento: p.vencimento ?? "",
      valor: paraTexto(p.valor),
      observacao: p.observacao ?? "",
    })),
  );
  const [comEndereco, setComEndereco] = useState(!!pedido?.endereco_entrega);
  const [endereco, setEndereco] = useState<Record<string, string>>(pedido?.endereco_entrega ?? {});

  const produtosTotal = linhas.reduce((s, l) => s + (lerNumero(l.quantidade) || 0) * (lerNumero(l.preco) || 0), 0);
  const total = arredondar(produtosTotal + (lerNumero(frete) || 0) + (lerNumero(outras) || 0) - (lerNumero(desconto) || 0));
  const somaParcelas = arredondar(parcelas.reduce((s, p) => s + (lerNumero(p.valor) || 0), 0));

  const itens = linhas.map((l) => ({
    item_id: l.item_id,
    quantidade: lerNumero(l.quantidade),
    preco_unitario: lerNumero(l.preco),
    info_adicional: l.info,
  }));
  const parcelasJson = parcelas.map((p) => ({
    dias: p.dias === "" ? null : Number(p.dias),
    vencimento: p.vencimento,
    valor: lerNumero(p.valor),
    observacao: p.observacao,
    forma_pagamento_id: formaPagamento,
  }));

  // Parcelas pela condição: dias contados da data do pedido, valor dividido em partes iguais.
  function gerarParcelas() {
    const dias = lerDias(condicao) ?? [];
    const lista = dias.length ? dias : [0];
    setParcelas(
      dividirParcelas(total, lista, dataPedido).map((p, k) => ({
        chave: k,
        dias: String(lista[k]),
        vencimento: p.vencimento,
        valor: paraTexto(p.valor),
        observacao: "",
      })),
    );
  }

  return (
    <FormAcao acao={acao} rotulo="Salvar pedido" className="space-y-5">
      <input type="hidden" name="itens" value={JSON.stringify(itens)} />
      <input type="hidden" name="parcelas" value={JSON.stringify(parcelasJson)} />
      <input type="hidden" name="endereco_entrega" value={JSON.stringify(comEndereco ? endereco : {})} />
      <input type="hidden" name="prazo_recebimento_dias" value={pedido?.prazo_recebimento_dias ?? 28} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Empresa que vende" className="sm:col-span-2">
          <select
            name="empresa_id"
            required
            defaultValue={pedido?.empresa_id ?? (empresas.length === 1 ? empresas[0].id : "")}
            disabled={!!pedido?.cliente_id}
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
          rotulo="Cliente"
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
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={comEndereco} onChange={(e) => setComEndereco(e.target.checked)} />
        Entregar em endereço diferente do cadastro do cliente
      </label>
      {comEndereco && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CAMPOS_ENDERECO.map((c) => (
            <Campo key={c.nome} rotulo={c.rotulo} className={"largo" in c ? "sm:col-span-2" : undefined}>
              <input
                value={endereco[c.nome] ?? ""}
                onChange={(e) => setEndereco((atual) => ({ ...atual, [c.nome]: e.target.value }))}
                className={estiloCampo}
              />
            </Campo>
          ))}
        </div>
      )}

      <Secao titulo="Dados gerais">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Data do pedido">
            <input
              name="data_pedido"
              type="date"
              required
              value={dataPedido}
              onChange={(e) => setDataPedido(e.target.value)}
              disabled={!!pedido?.cliente_id}
              className={estiloCampo}
            />
          </Campo>
          <Campo rotulo="Data prevista" dica="Usada para o atraso e a fila de produção.">
            <input name="prazo_entrega" type="date" defaultValue={pedido?.prazo_entrega ?? ""} className={estiloCampo} />
          </Campo>
          <Campo rotulo="Nº da ordem de compra" dica="O número do pedido do cliente.">
            <input name="numero_ordem_compra" defaultValue={pedido?.numero_ordem_compra ?? ""} className={estiloCampo} />
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
          <Campo rotulo="Vendedor">
            <Escolha nome="vendedor_cadastro_id" opcoes={opcoes.vendedores} valor={pedido?.vendedor_cadastro_id} />
          </Campo>
          <Campo rotulo="Lista de preço" dica="Ao trocar, os preços dos produtos são refeitos.">
            <select
              name="lista_preco_id"
              value={listaId}
              onChange={(e) => {
                const nova = opcoes.listas.find((l) => l.id === e.target.value);
                setListaId(e.target.value);
                setLinhas((atual) => atual.map((l) => (l.item_id ? { ...l, preco: paraTexto(precoNaLista(l.item_id, nova)) } : l)));
              }}
              className={estiloCampo}
            >
              <option value="">Padrão (preço de venda)</option>
              {opcoes.listas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Natureza de operação" className="sm:col-span-2">
            <Escolha nome="natureza_operacao_id" opcoes={opcoes.naturezas} valor={pedido?.natureza_operacao_id} />
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Itens">
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
                <tr key={l.chave} className="align-top">
                  <td className="py-1 pr-2">
                    <select
                      aria-label="Produto"
                      value={l.item_id}
                      onChange={(e) => {
                        const preco = precoNaLista(e.target.value);
                        setLinhas((atual) =>
                          atual.map((x) =>
                            x.chave === l.chave ? { ...x, item_id: e.target.value, preco: preco > 0 ? paraTexto(preco) : x.preco } : x,
                          ),
                        );
                      }}
                      className={estiloCampo}
                    >
                      <option value="">Escolha o produto...</option>
                      {produtos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.codigo} · {p.descricao}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Informação adicional do item"
                      placeholder="Informação adicional (sai na nota)"
                      value={l.info}
                      onChange={(e) => mudar(l.chave, "info", e.target.value)}
                      className={`${estiloCampo} mt-1 text-xs`}
                    />
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
                  <td className="py-1 pr-2 pt-3 text-right tabular-nums">
                    {formatarMoeda((lerNumero(l.quantidade) || 0) * (lerNumero(l.preco) || 0))}
                  </td>
                  <td className="py-1 pt-2 text-right">
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
          </table>
        </div>
        <button
          type="button"
          onClick={() =>
            setLinhas((atual) => [
              ...atual,
              { chave: Math.max(...atual.map((x) => x.chave)) + 1, item_id: "", quantidade: "1", preco: "", info: "" },
            ])
          }
          className="inline-flex items-center gap-1 text-sm text-primaria hover:underline"
        >
          <Plus size={14} /> Adicionar produto
        </button>
      </Secao>

      <Secao titulo="Totais">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Campo rotulo="Produtos">
            <p className="py-2 tabular-nums">{formatarMoeda(produtosTotal)}</p>
          </Campo>
          <Campo rotulo="Frete (R$)">
            <input name="valor_frete" inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} className={estiloCampo} />
          </Campo>
          <Campo rotulo="Outras despesas (R$)">
            <input
              name="valor_outras_despesas"
              inputMode="decimal"
              value={outras}
              onChange={(e) => setOutras(e.target.value)}
              className={estiloCampo}
            />
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
          <Campo rotulo="Total do pedido">
            <p className="py-2 font-semibold tabular-nums">{formatarMoeda(total)}</p>
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Pagamento">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Forma de recebimento">
            <select
              name="forma_pagamento_id"
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
              className={estiloCampo}
            >
              <option value="">—</option>
              {opcoes.formasPagamento.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Condição de pagamento" dica="Escolha da lista ou escreva os dias, como 28/56.">
            <input
              name="condicao_pagamento"
              list="condicoes-pagamento"
              value={condicao}
              onChange={(e) => setCondicao(e.target.value)}
              className={estiloCampo}
            />
            <datalist id="condicoes-pagamento">
              {opcoes.condicoes.map((c) => (
                <option key={c.id} value={c.nome} />
              ))}
            </datalist>
          </Campo>
          <Campo rotulo="Categoria" dica={opcoes.categorias.length ? undefined : "Definida pelo financeiro."}>
            <Escolha nome="categoria_id" opcoes={opcoes.categorias} valor={pedido?.categoria_id} />
          </Campo>
          <div className="flex items-end">
            <button type="button" onClick={gerarParcelas} className={estiloBotaoSecundario}>
              Gerar parcelas
            </button>
          </div>
        </div>
        {parcelas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-texto-suave">
                  <th className="w-10 pb-1 pr-2 font-medium">Nº</th>
                  <th className="w-24 pb-1 pr-2 font-medium">Dias</th>
                  <th className="w-44 pb-1 pr-2 font-medium">Vencimento</th>
                  <th className="w-36 pb-1 pr-2 font-medium">Valor (R$)</th>
                  <th className="pb-1 pr-2 font-medium">Observação</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {parcelas.map((p, i) => {
                  const mudarParcela = (campo: keyof LinhaParcela, valor: string) =>
                    setParcelas((atual) => atual.map((x) => (x.chave === p.chave ? { ...x, [campo]: valor } : x)));
                  return (
                    <tr key={p.chave}>
                      <td className="py-1 pr-2 tabular-nums text-texto-suave">{i + 1}</td>
                      <td className="py-1 pr-2">
                        <input
                          aria-label="Dias"
                          inputMode="numeric"
                          value={p.dias}
                          onChange={(e) => mudarParcela("dias", e.target.value.replace(/\D/g, ""))}
                          className={estiloCampo}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          aria-label="Vencimento"
                          type="date"
                          value={p.vencimento}
                          onChange={(e) => mudarParcela("vencimento", e.target.value)}
                          className={estiloCampo}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          aria-label="Valor da parcela"
                          inputMode="decimal"
                          value={p.valor}
                          onChange={(e) => mudarParcela("valor", e.target.value)}
                          className={estiloCampo}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          aria-label="Observação da parcela"
                          value={p.observacao}
                          onChange={(e) => mudarParcela("observacao", e.target.value)}
                          className={estiloCampo}
                        />
                      </td>
                      <td className="py-1 text-right">
                        <button
                          type="button"
                          aria-label="Tirar parcela"
                          onClick={() => setParcelas((atual) => atual.filter((x) => x.chave !== p.chave))}
                          className="rounded p-1 text-texto-suave hover:text-perigo"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {somaParcelas !== total && (
              <p className="mt-1 text-xs text-alerta">
                As parcelas somam {formatarMoeda(somaParcelas)} e o pedido, {formatarMoeda(total)}. Clique em “Gerar parcelas” para refazer.
              </p>
            )}
          </div>
        )}
      </Secao>

      <Secao titulo="Transporte">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Transportadora" className="sm:col-span-2">
            <Escolha nome="transportadora_id" opcoes={opcoes.transportadoras} valor={pedido?.transportadora_id} />
          </Campo>
          <Campo rotulo="Forma de envio">
            <Escolha nome="forma_envio_id" opcoes={opcoes.formasEnvio} valor={pedido?.forma_envio_id} />
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
        </div>
      </Secao>

      <Secao titulo="Observações">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Observações" dica="Saem no pedido e na nota.">
            <textarea name="observacao" rows={3} defaultValue={pedido?.observacao ?? ""} className={estiloCampo} />
          </Campo>
          <Campo rotulo="Observações internas" dica="Só para a equipe.">
            <textarea name="observacao_interna" rows={3} defaultValue={pedido?.observacao_interna ?? ""} className={estiloCampo} />
          </Campo>
        </div>
      </Secao>

      <div className="flex justify-end">
        <Link href={voltar} className={estiloBotaoSecundario}>
          Cancelar
        </Link>
      </div>
    </FormAcao>
  );
}
