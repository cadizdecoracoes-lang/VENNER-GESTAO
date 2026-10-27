"use client";

import { Check, FileUp, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "@/lib/navegacao";
import { FormAcao } from "@/components/form-acao";
import {
  CabecalhoTela,
  Campo,
  Cartao,
  Celula,
  Etiqueta,
  Fonte,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { CAMPOS_PEDIDO_COMPRA, COR_ETAPA_COMPRA, type PedidoCompraResumo } from "@/lib/compras";
import { carregarEmpresas } from "@/lib/empresa";
import { carregarFornecedores } from "@/lib/financeiro";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/formato";
import { ETAPAS_COMPRA, FRETE_POR_CONTA, MEIOS_PAGAMENTO, type EtapaCompra } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { escolherOrcamento, excluirOrcamento, incluirOrcamento, mudarEtapaCompra } from "../actions";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "compras.pedidos";

type ItemPedido = {
  item_id: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  aliquota_ipi: number;
  informacoes_adicionais: string | null;
  itens: { codigo: string; descricao: string; unidade: string } | null;
};
type Orcamento = {
  id: string;
  valor_total: number;
  prazo_entrega_dias: number | null;
  condicao_pagamento: string | null;
  validade: string | null;
  observacao: string | null;
  escolhido: boolean;
  fornecedores: { nome: string; nome_fantasia: string | null } | null;
};
type Parcela = { id: string; dias: number; vencimento: string; valor: number; meio_pagamento: string | null };
type Historico = { etapa: EtapaCompra; observacao: string | null; em: string; usuario: string | null };
type NotaLigada = { id: string; numero: string; serie: string | null; data_emissao: string; valor_total: number };

// Botão de troca de etapa; com `motivo`, pede o texto antes (obrigatório no banco).
function BotaoEtapa({
  id,
  destino,
  rotulo,
  motivo,
  principal = false,
}: {
  id: string;
  destino: EtapaCompra;
  rotulo: string;
  motivo?: string;
  principal?: boolean;
}) {
  const acao = mudarEtapaCompra.bind(null, id, destino);
  if (!motivo) return <FormAcao acao={acao} rotulo={rotulo} secundario={!principal} enviando="Gravando..." />;
  return (
    <details className="group">
      <summary className={`${estiloBotaoSecundario} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{rotulo}</summary>
      <FormAcao acao={acao} rotulo={`Confirmar: ${rotulo.toLowerCase()}`} secundario className="mt-2 flex flex-wrap items-center gap-2">
        <input name="motivo" required minLength={3} placeholder={motivo} className={`${estiloCampo} max-w-sm`} />
      </FormAcao>
    </details>
  );
}

async function PaginaPedidoCompra({ params }: { params: Promise<{ id: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const { id } = await params;
  if (!supabaseConfigurado) notFound();
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("pedidos_compra_resumo").select(CAMPOS_PEDIDO_COMPRA).eq("id", id).maybeSingle();
  if (!data) notFound();
  const p = data as unknown as PedidoCompraResumo;

  const [{ data: itensData }, { data: orcData }, { data: parcData }, { data: histData }, { data: notasData }, empresas, fornecedores, { data: cat }] =
    await Promise.all([
      supabase
        .from("pedido_compra_itens")
        .select("item_id, quantidade, valor_unitario, valor_total, aliquota_ipi, informacoes_adicionais, itens(codigo, descricao, unidade)")
        .eq("pedido_id", id),
      supabase
        .from("pedido_compra_orcamentos")
        .select("id, valor_total, prazo_entrega_dias, condicao_pagamento, validade, observacao, escolhido, fornecedores(nome, nome_fantasia)")
        .eq("pedido_id", id)
        .order("valor_total"),
      supabase.from("pedido_compra_parcelas").select("id, dias, vencimento, valor, meio_pagamento").eq("pedido_id", id).order("vencimento"),
      supabase.rpc("historico_pedido_compra", { pedido: id }),
      supabase.from("notas_fornecedor").select("id, numero, serie, data_emissao, valor_total").eq("pedido_compra_id", id).order("data_emissao"),
      carregarEmpresas(),
      carregarFornecedores(),
      p.categoria_id
        ? supabase.from("plano_contas").select("codigo, nome").eq("id", p.categoria_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
  const itens = (itensData ?? []) as unknown as ItemPedido[];
  const orcamentos = (orcData ?? []) as unknown as Orcamento[];
  const parcelas = (parcData ?? []) as Parcela[];
  const historico = (histData ?? []) as Historico[];
  const notas = (notasData ?? []) as NotaLigada[];
  const categoria = cat as { codigo: string; nome: string } | null;
  const empresa = empresas.find((e) => e.id === p.empresa_id)?.nome;

  const editavel = p.etapa === "criacao" || p.etapa === "orcamento";
  const podeEditar = pode(acesso, TELA, "editar");
  const podeAprovar = pode(acesso, TELA, "aprovar");
  const temEscolhido = orcamentos.some((o) => o.escolhido);
  const nomeFornecedor = (o: Orcamento) => o.fornecedores?.nome_fantasia || o.fornecedores?.nome || "—";

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA}>
        {editavel && podeEditar && (
          <Link href={`/compras/pedidos/editar?id=${id}`} className={estiloBotaoSecundario}>
            <Pencil size={14} /> Editar
          </Link>
        )}
        {(p.etapa === "aprovado" || p.etapa === "recebido") && pode(acesso, "financeiro.notas_fornecedor", "criar") && (
          <Link href={`/financeiro/notas-fornecedor/importar?pedido=${id}`} className={estiloBotaoSecundario}>
            <FileUp size={14} /> Lançar nota deste pedido
          </Link>
        )}
      </CabecalhoTela>

      <Cartao>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-texto-suave">Pedido de compra nº {p.numero}</p>
            <p className="text-lg font-semibold">{p.fornecedor_nome ?? "Fornecedor a definir pelo orçamento"}</p>
            <p className="text-sm text-texto-suave">
              {empresa ?? "Empresa sem acesso"} · pedido em {formatarData(p.data_pedido)}
              {p.data_prevista && ` · entrega prevista ${formatarData(p.data_prevista)}`}
            </p>
          </div>
          <div className="text-right">
            <Etiqueta cor={COR_ETAPA_COMPRA[p.etapa]}>{ETAPAS_COMPRA[p.etapa]}</Etiqueta>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatarMoeda(Number(p.valor_total))}</p>
            <Fonte>
              Itens {formatarMoeda(Number(p.valor_itens))} + IPI {formatarMoeda(Number(p.valor_ipi))} + frete{" "}
              {formatarMoeda(Number(p.valor_frete))} − desconto {formatarMoeda(Number(p.valor_desconto))}
            </Fonte>
          </div>
        </div>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-texto-suave">Condição de pagamento</dt>
            <dd>{p.condicao_pagamento ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Categoria</dt>
            <dd>{categoria ? `${categoria.codigo} · ${categoria.nome}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Frete por conta</dt>
            <dd>
              {p.frete_por_conta ? FRETE_POR_CONTA[p.frete_por_conta as keyof typeof FRETE_POR_CONTA] : "—"}
              {p.transportador && ` · ${p.transportador}`}
            </dd>
          </div>
          <div>
            <dt className="text-texto-suave">Observações</dt>
            <dd>{p.observacoes ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Observações internas</dt>
            <dd>{p.observacoes_internas ?? "—"}</dd>
          </div>
        </dl>
      </Cartao>

      {/* Próximo passo do pedido, conforme a etapa e o perfil. */}
      {p.etapa !== "cancelado" && p.etapa !== "recebido" && (podeEditar || podeAprovar) && (
        <Cartao titulo="Próximo passo">
          <div className="flex flex-wrap items-start gap-2">
            {p.etapa === "criacao" && podeEditar && <BotaoEtapa id={id} destino="orcamento" rotulo="Pedir orçamentos" principal />}
            {editavel && podeEditar && (
              <BotaoEtapa id={id} destino="aprovacao" rotulo="Enviar para aprovação" principal={p.etapa === "orcamento"} />
            )}
            {p.etapa === "orcamento" && podeEditar && <BotaoEtapa id={id} destino="criacao" rotulo="Voltar para criação" />}
            {p.etapa === "aprovacao" && podeAprovar && <BotaoEtapa id={id} destino="aprovado" rotulo="Aprovar pedido" principal />}
            {p.etapa === "aprovacao" && (podeAprovar || podeEditar) && (
              <BotaoEtapa
                id={id}
                destino="orcamento"
                rotulo={podeAprovar ? "Devolver para orçamento" : "Retirar da aprovação"}
                motivo="Motivo (o que precisa mudar)"
              />
            )}
            {p.etapa === "aprovado" && podeAprovar && (
              <BotaoEtapa id={id} destino="orcamento" rotulo="Reabrir (volta para orçamento)" motivo="Motivo da reabertura" />
            )}
            {(p.etapa === "aprovado" ? podeAprovar : podeEditar || podeAprovar) && (
              <BotaoEtapa id={id} destino="cancelado" rotulo="Cancelar pedido" motivo="Motivo do cancelamento" />
            )}
          </div>
          <p className="mt-2 text-xs text-texto-suave">
            {p.etapa === "criacao" && "Monte os produtos e peça orçamentos aos fornecedores."}
            {p.etapa === "orcamento" &&
              (temEscolhido
                ? "Orçamento escolhido: o pedido já pode ir para aprovação."
                : "Registre os orçamentos abaixo e escolha um para poder enviar para aprovação.")}
            {p.etapa === "aprovacao" &&
              (podeAprovar ? "Confira produtos e orçamentos e aprove, ou devolva com o motivo." : "Aguardando quem aprova pedidos de compra.")}
            {p.etapa === "aprovado" && "Aprovado: a nota do fornecedor pode ser lançada ligada a este pedido."}
          </p>
        </Cartao>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Cartao titulo="Produtos">
            <Tabela colunas={["Produto", "Quantidade", "Valor unitário", "IPI", "Total"]} embutida vazio="Nenhum produto ainda.">
              {itens.map((i) => (
                <tr key={i.item_id}>
                  <Celula>
                    <span className="font-medium">{i.itens?.codigo}</span> · {i.itens?.descricao}
                    {i.informacoes_adicionais && <span className="ml-2 text-xs text-texto-suave">{i.informacoes_adicionais}</span>}
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">
                    {formatarNumero(Number(i.quantidade))} {i.itens?.unidade}
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(Number(i.valor_unitario))}</Celula>
                  <Celula className="whitespace-nowrap tabular-nums text-texto-suave">
                    {Number(i.aliquota_ipi) > 0 ? `${formatarNumero(Number(i.aliquota_ipi))}%` : "—"}
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(Number(i.valor_total))}</Celula>
                </tr>
              ))}
            </Tabela>
          </Cartao>

          <Cartao
            titulo={`Orçamentos (${orcamentos.length})`}
            acoes={temEscolhido ? <Etiqueta cor="sucesso">Escolhido</Etiqueta> : <Etiqueta cor="alerta">Nenhum escolhido</Etiqueta>}
          >
            <Tabela
              colunas={["Fornecedor", "Valor", "Prazo", "Condição", "Validade", ""]}
              embutida
              vazio="Nenhum orçamento registrado ainda."
            >
              {orcamentos.map((o) => (
                <tr key={o.id}>
                  <Celula>
                    <span className="font-medium">{nomeFornecedor(o)}</span>
                    {o.escolhido && (
                      <span className="ml-2">
                        <Etiqueta cor="sucesso">Escolhido</Etiqueta>
                      </span>
                    )}
                    {o.observacao && <span className="ml-2 text-xs text-texto-suave">{o.observacao}</span>}
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(Number(o.valor_total))}</Celula>
                  <Celula className="whitespace-nowrap tabular-nums">
                    {o.prazo_entrega_dias != null ? `${o.prazo_entrega_dias} dias` : "—"}
                  </Celula>
                  <Celula>{o.condicao_pagamento ?? "—"}</Celula>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarData(o.validade)}</Celula>
                  <Celula className="whitespace-nowrap text-right">
                    {editavel && podeEditar && (
                      <div className="flex justify-end gap-3">
                        {!o.escolhido && (
                          <FormAcao acao={escolherOrcamento.bind(null, id, o.id)} rotulo={<><Check size={14} className="inline" /> Escolher</>} discreto />
                        )}
                        <FormAcao acao={excluirOrcamento.bind(null, id, o.id)} rotulo="Excluir" discreto confirmar="Excluir este orçamento?" />
                      </div>
                    )}
                  </Celula>
                </tr>
              ))}
            </Tabela>
            {editavel && podeEditar && (
              <FormAcao acao={incluirOrcamento.bind(null, id)} rotulo="Incluir orçamento" limpar secundario className="mt-3 space-y-2">
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Campo rotulo="Fornecedor" className="sm:col-span-2">
                    <select name="fornecedor_id" required defaultValue="" className={estiloCampo}>
                      <option value="" disabled>
                        Escolha...
                      </option>
                      {fornecedores.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo rotulo="Valor total (R$)">
                    <input name="valor_total" required inputMode="decimal" className={estiloCampo} />
                  </Campo>
                  <Campo rotulo="Prazo (dias)">
                    <input name="prazo_entrega_dias" type="number" min={0} className={estiloCampo} />
                  </Campo>
                  <Campo rotulo="Condição">
                    <input name="condicao_pagamento" placeholder="30/60" className={estiloCampo} />
                  </Campo>
                  <Campo rotulo="Validade">
                    <input name="validade" type="date" className={estiloCampo} />
                  </Campo>
                  <Campo rotulo="Observação" className="sm:col-span-3 lg:col-span-6">
                    <input name="observacao" className={estiloCampo} />
                  </Campo>
                </div>
              </FormAcao>
            )}
          </Cartao>
        </div>

        <div className="space-y-3">
          <Cartao titulo="Parcelas">
            {parcelas.length === 0 ? (
              <p className="text-sm text-texto-suave">Sem parcelas. Informe os dias (ex.: 30/60) em Editar.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {parcelas.map((x, k) => (
                  <li key={x.id} className="flex justify-between gap-2">
                    <span>
                      {k + 1}/{parcelas.length} · {formatarData(x.vencimento)}
                      <span className="ml-1 text-xs text-texto-suave">
                        ({x.dias} dias{x.meio_pagamento ? ` · ${MEIOS_PAGAMENTO[x.meio_pagamento as keyof typeof MEIOS_PAGAMENTO] ?? ""}` : ""})
                      </span>
                    </span>
                    <span className="tabular-nums">{formatarMoeda(Number(x.valor))}</span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao titulo="Notas do fornecedor">
            {notas.length === 0 ? (
              <p className="text-sm text-texto-suave">
                {p.etapa === "aprovado" ? "Nenhuma nota lançada ainda." : "A nota só pode ser lançada depois da aprovação."}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {notas.map((n) => (
                  <li key={n.id} className="flex justify-between gap-2">
                    <LinkAcao href={`/financeiro/notas-fornecedor/nota?id=${n.id}`}>
                      NF {n.numero}
                      {n.serie ? `-${n.serie}` : ""}
                    </LinkAcao>
                    <span className="text-texto-suave">{formatarData(n.data_emissao)}</span>
                    <span className="tabular-nums">{formatarMoeda(Number(n.valor_total))}</span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao titulo="Histórico">
            <ol className="space-y-1.5 text-sm">
              {historico.map((h, k) => (
                <li key={k}>
                  <span className="font-medium">{ETAPAS_COMPRA[h.etapa]}</span>
                  <span className="ml-2 text-xs text-texto-suave">
                    {new Date(h.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    {h.usuario && ` · ${h.usuario}`}
                  </span>
                  {h.observacao && <span className="block text-xs text-texto-suave">{h.observacao}</span>}
                </li>
              ))}
            </ol>
          </Cartao>
        </div>
      </div>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaPedidoCompra} />;
}
