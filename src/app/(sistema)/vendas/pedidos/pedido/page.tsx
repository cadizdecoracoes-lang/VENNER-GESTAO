"use client";

import { Pencil, Printer } from "lucide-react";
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
import { hojeBrasil } from "@/lib/datas";
import { carregarEmpresas } from "@/lib/empresa";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/formato";
import { comprado, necessidadeMateriais, type DadosPlanejamento } from "@/lib/planejamento";
import { diasDaCondicao } from "@/lib/parcelas";
import { FASES_PEDIDO, PRIORIDADES, type FasePedido, type SituacaoTitulo } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { CAMPOS_PEDIDO, carregarEtapas, nomeCliente, type PedidoResumo } from "@/lib/vendas";
import { gerarParcelas, mudarEtapa } from "../actions";
import { TelaCliente } from "@/components/tela-cliente";
import { CartaoNotaFiscal, type ArquivosNota, type NotaVenda } from "./nota-fiscal";

const TELA = "vendas.pedidos";

type ItemPedido = {
  item_id: string;
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
  itens: { codigo: string; descricao: string; unidade: string } | null;
};
type Historico = { etapa: string; fase: FasePedido; em: string; usuario: string | null };
type TituloPedido = {
  id: string;
  parcela: string | null;
  valor: number;
  tarifas: number;
  valor_liquido: number;
  vencimento: string;
  situacao: SituacaoTitulo;
  data_recebimento: string | null;
};

async function PaginaPedido({ params }: { params: Promise<{ id: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const { id } = await params;
  if (!supabaseConfigurado) notFound();
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("pedidos_venda_resumo").select(CAMPOS_PEDIDO).eq("id", id).maybeSingle();
  if (!data) notFound();
  const pedido = data as unknown as PedidoResumo;

  const planeja = pode(acesso, "producao.sequenciamento", "ver") || pode(acesso, "compras.sugestoes", "ver");
  const veReceber = pode(acesso, "financeiro.receber", "ver");
  const [{ data: itensData }, { data: historicoData }, etapas, empresas, plano, { data: titulosData }, { data: tinyData }, { data: notasData }] =
    await Promise.all([
    supabase
      .from("pedido_venda_itens")
      .select("item_id, quantidade, preco_unitario, valor_total, itens(codigo, descricao, unidade)")
      .eq("pedido_id", id),
    supabase.rpc("historico_pedido", { pedido: id }),
    carregarEtapas(),
    carregarEmpresas(),
    planeja ? supabase.rpc("dados_planejamento") : Promise.resolve({ data: null }),
    veReceber
      ? supabase
          .from("contas_receber")
          .select("id, parcela, valor, tarifas, valor_liquido, vencimento, situacao, data_recebimento")
          .eq("pedido_id", id)
          .order("vencimento")
      : Promise.resolve({ data: null }),
    supabase.from("pedidos_venda").select("tiny_id, nota_fiscal").eq("id", id).maybeSingle(),
    supabase
      .from("notas_venda")
      .select(
        "id, numero, serie, chave_acesso, situacao, mensagem, valor, emitida_em, link, contas_lancadas, justificativa_cancelamento, atualizada_em, danfe_arquivo, xml_arquivo, xml_cancelamento_arquivo",
      )
      .eq("pedido_id", id)
      .order("criada_em", { ascending: false }),
  ]);
  const itens = (itensData ?? []) as unknown as ItemPedido[];
  // Nota valendo primeiro; sem ela, a última cancelada ou denegada.
  type LinhaNota = NotaVenda & { danfe_arquivo: string | null; xml_arquivo: string | null; xml_cancelamento_arquivo: string | null };
  const notas = (notasData ?? []) as LinhaNota[];
  const nota = notas.find((n) => n.situacao !== "cancelada" && n.situacao !== "denegada") ?? notas[0] ?? null;
  const assinar = async (caminho: string | null) =>
    caminho ? ((await supabase.storage.from("notas-venda").createSignedUrl(caminho, 3600)).data?.signedUrl ?? null) : null;
  const arquivos: ArquivosNota = {
    danfe: await assinar(nota?.danfe_arquivo ?? null),
    xml: await assinar(nota?.xml_arquivo ?? null),
    xmlCancelamento: await assinar(nota?.xml_cancelamento_arquivo ?? null),
  };
  const noTiny = (tinyData as { tiny_id: number | null } | null)?.tiny_id != null;
  const notaDoTiny = (tinyData as { nota_fiscal: string | null } | null)?.nota_fiscal ?? null;
  const titulos = ((titulosData ?? []) as TituloPedido[]).filter((t) => t.situacao !== "cancelado");
  const { data: custosData } = itens.length ? await supabase.rpc("custos_padrao", { itens: itens.map((i) => i.item_id) }) : { data: [] };
  const custoUnitario = new Map(((custosData ?? []) as { item_id: string; custo: number }[]).map((c) => [c.item_id, Number(c.custo)]));
  const custoTotal = itens.reduce((s, i) => s + Number(i.quantidade) * (custoUnitario.get(i.item_id) ?? 0), 0);
  const tarifas = titulos.reduce((s, t) => s + Number(t.tarifas), 0);
  const receitaLiquida = Number(pedido.valor_total) - tarifas;
  const margem = receitaLiquida - custoTotal;
  const historico = (historicoData ?? []) as Historico[];
  const hoje = hojeBrasil();

  // Materiais só deste pedido, pela ficha técnica ativa, contra o estoque total.
  const materiais = plano.data
    ? necessidadeMateriais(
        {
          ...(plano.data as DadosPlanejamento),
          pedidos: [
            {
              id: pedido.id,
              numero: pedido.numero,
              empresa_id: pedido.empresa_id,
              cliente: nomeCliente(pedido),
              data_pedido: pedido.data_pedido,
              prazo_entrega: pedido.prazo_entrega,
              prazo_recebimento_dias: pedido.prazo_recebimento_dias,
              prioridade: pedido.prioridade,
              etapa: pedido.etapa_nome,
              etapa_ordem: pedido.etapa_ordem,
              itens: itens.map((i) => ({ item_id: i.item_id, quantidade: Number(i.quantidade), valor_total: Number(i.valor_total) })),
            },
          ],
        },
        hoje,
      )
    : null;
  const comprados = materiais?.filter(comprado) ?? [];
  const semFicha = materiais?.filter((m) => m.sem_ficha) ?? [];
  const faltando = comprados.filter((m) => m.falta > 0);
  const empresa = empresas.find((e) => e.id === pedido.empresa_id)?.nome;
  const atrasado = pedido.fase !== "encerrado" && pedido.dias_atraso > 0;

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        <Link href={`/impressao/pedido?id=${pedido.id}`} target="_blank" className={estiloBotaoSecundario}>
          <Printer size={16} /> Imprimir
        </Link>
        {pode(acesso, TELA, "editar") && pedido.fase === "negociacao" && (
          <Link href={`/vendas/pedidos/editar?id=${pedido.id}`} className={estiloBotaoSecundario}>
            <Pencil size={16} /> Editar
          </Link>
        )}
      </CabecalhoTela>

      <Cartao>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-texto-suave">Pedido nº {pedido.numero}</p>
            <p className="text-xl font-semibold">{nomeCliente(pedido)}</p>
            <p className="text-sm text-texto-suave">
              {empresa ?? "Empresa sem acesso"} · lançado em {formatarData(pedido.data_pedido)}
            </p>
          </div>
          <div className="text-right">
            <Etiqueta
              cor={
                pedido.fase === "producao"
                  ? "primaria"
                  : pedido.fase === "expedicao"
                    ? "sucesso"
                    : pedido.fase === "negociacao"
                      ? "alerta"
                      : "neutra"
              }
            >
              {pedido.etapa_nome}
            </Etiqueta>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatarMoeda(Number(pedido.valor_total))}</p>
            <Fonte>Soma dos {itens.length} produtos abaixo</Fonte>
          </div>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-texto-suave">Prazo de entrega</dt>
            <dd className={atrasado ? "font-medium text-perigo" : ""}>
              {formatarData(pedido.prazo_entrega)}
              {atrasado && ` · ${pedido.dias_atraso} dias de atraso`}
            </dd>
          </div>
          <div>
            <dt className="text-texto-suave">Condição de pagamento</dt>
            <dd>{pedido.condicao_pagamento ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Recebimento</dt>
            <dd>{pedido.prazo_recebimento_dias === 0 ? "À vista" : `${pedido.prazo_recebimento_dias} dias após a entrega`}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Prioridade</dt>
            <dd>{PRIORIDADES[pedido.prioridade as 0 | 1 | 2]}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Observação</dt>
            <dd>{pedido.observacao ?? "—"}</dd>
          </div>
        </dl>
      </Cartao>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Cartao titulo="Produtos">
            <Tabela colunas={["Produto", "Quantidade", "Preço unitário", "Total"]} embutida>
              {itens.map((i) => (
                <tr key={i.item_id}>
                  <Celula>
                    <span className="font-medium">{i.itens?.codigo}</span> · {i.itens?.descricao}
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">
                    {formatarNumero(Number(i.quantidade))} {i.itens?.unidade}
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(Number(i.preco_unitario))}</Celula>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(Number(i.valor_total))}</Celula>
                </tr>
              ))}
            </Tabela>
          </Cartao>

          <Cartao
            titulo="Matéria-prima para este pedido"
            acoes={
              semFicha.length > 0 ? (
                <Etiqueta cor="alerta">
                  {semFicha.length} sem ficha técnica
                </Etiqueta>
              ) : faltando.length > 0 ? (
                <Etiqueta cor="alerta">
                  Falta {faltando.length} {faltando.length === 1 ? "item" : "itens"}
                </Etiqueta>
              ) : materiais ? (
                <Etiqueta cor="sucesso">Estoque cobre</Etiqueta>
              ) : null
            }
          >
            {!materiais ? (
              <p className="text-sm text-texto-suave">Seu perfil não consulta o planejamento da produção.</p>
            ) : (
              <div className="space-y-3">
                <Tabela
                  colunas={["Item", "Necessário", "Em estoque (grupo)", "Falta"]}
                  embutida
                  vazio={semFicha.length ? "Sem matéria-prima calculada: falta a ficha técnica dos produtos abaixo." : "Nenhuma matéria-prima nas fichas técnicas."}
                >
                  {comprados.map((m) => (
                    <tr key={m.item.id}>
                      <Celula>
                        <span className="font-medium">{m.item.codigo}</span> · {m.item.descricao}
                      </Celula>
                      <Celula className="whitespace-nowrap tabular-nums">
                        {formatarNumero(m.necessidade)} {m.item.unidade}
                      </Celula>
                      <Celula className="whitespace-nowrap tabular-nums">
                        <LinkAcao href={`/estoque/movimentos?item=${m.item.id}`}>{formatarNumero(m.saldo)}</LinkAcao>
                      </Celula>
                      <Celula className={`whitespace-nowrap tabular-nums ${m.falta > 0 ? "font-medium text-perigo" : "text-texto-suave"}`}>
                        {m.falta > 0 ? `${formatarNumero(m.falta)} ${m.item.unidade}` : "—"}
                      </Celula>
                    </tr>
                  ))}
                </Tabela>
                {semFicha.length > 0 && (
                  <div className="rounded-xl bg-alerta/10 px-4 py-2.5 text-sm">
                    <p className="font-medium">
                      {semFicha.length} {semFicha.length === 1 ? "produto sem ficha técnica" : "produtos sem ficha técnica"}: a matéria-prima
                      deles não entra na conta.
                    </p>
                    <p className="mt-1">
                      {semFicha.map((m, k) => (
                        <span key={m.item.id}>
                          {k > 0 && ", "}
                          <LinkAcao href={`/producao/ficha-tecnica?item=${m.item.id}`}>{m.item.codigo}</LinkAcao>
                        </span>
                      ))}
                    </p>
                  </div>
                )}
                <Fonte>
                  Quantidades dos produtos × ficha técnica ativa de cada um (com a perda, em todos os níveis), descontando o produto acabado
                  e os subconjuntos já em estoque. Estoque = soma das movimentações de todos os locais. Considera só este pedido: a divisão
                  do estoque entre os pedidos está na{" "}
                  <Link href="/producao/sequenciamento" className="text-primaria hover:underline">
                    fila de produção
                  </Link>
                  .
                </Fonte>
              </div>
            )}
          </Cartao>
        </div>

        <div className="space-y-6">
          <Cartao titulo="Margem do pedido">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-texto-suave">Valor dos produtos</dt>
                <dd className="tabular-nums">{formatarMoeda(Number(pedido.valor_total))}</dd>
              </div>
              {tarifas > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-texto-suave">Tarifas e frete da plataforma</dt>
                  <dd className="tabular-nums">− {formatarMoeda(tarifas)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-texto-suave">Custo padrão dos produtos</dt>
                <dd className="tabular-nums">− {formatarMoeda(custoTotal)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-borda pt-1.5 font-medium">
                <dt>Margem</dt>
                <dd className={`tabular-nums ${margem < 0 ? "text-perigo" : "text-sucesso"}`}>
                  {formatarMoeda(margem)}
                  {receitaLiquida > 0 && ` · ${formatarNumero(Math.round((margem / receitaLiquida) * 1000) / 10)}%`}
                </dd>
              </div>
            </dl>
            <div className="mt-3">
              <Fonte>
                Custo padrão de cada produto pela{" "}
                <Link href="/producao/ficha-tecnica" className="text-primaria hover:underline">
                  ficha técnica ativa
                </Link>{" "}
                (materiais com perda, pelo custo médio, mais as operações pelo custo hora do posto) ×{" "}
                {itens
                  .map(
                    (i) =>
                      `${formatarNumero(Number(i.quantidade))} ${i.itens?.codigo} a ${formatarMoeda(custoUnitario.get(i.item_id) ?? 0)}`,
                  )
                  .join(", ")}
                . Margem % sobre o valor líquido. Não inclui impostos.
              </Fonte>
            </div>
          </Cartao>

          <CartaoNotaFiscal
            pedidoId={pedido.id}
            noTiny={noTiny}
            notaDoTiny={notaDoTiny}
            nota={nota}
            arquivos={arquivos}
            podeEmitir={pode(acesso, TELA, "aprovar")}
          />

          {veReceber && (
            <Cartao
              titulo="Contas a receber"
              acoes={titulos.length > 0 ? <LinkAcao href={`/financeiro/receber?pedido=${pedido.id}`}>Abrir no financeiro</LinkAcao> : null}
            >
              {titulos.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {titulos.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-3">
                      <span>
                        {t.parcela ?? "Parcela única"} · vence {formatarData(t.vencimento)}
                        {t.situacao === "pago" && (
                          <span className="block text-xs text-sucesso">recebido em {formatarData(t.data_recebimento)}</span>
                        )}
                        {t.situacao === "aberto" && t.vencimento < hoje && <span className="block text-xs text-perigo">vencido</span>}
                      </span>
                      <span className="tabular-nums">{formatarMoeda(Number(t.valor_liquido))}</span>
                    </li>
                  ))}
                </ul>
              ) : pode(acesso, "financeiro.receber", "criar") ? (
                <FormAcao acao={gerarParcelas.bind(null, pedido.id)} rotulo="Gerar parcelas" secundario className="space-y-3">
                  <Campo
                    rotulo="Prazos em dias"
                    dica={`Pela condição "${pedido.condicao_pagamento ?? "não informada"}". Ex.: 30/60/90; 0 = à vista.`}
                  >
                    <input
                      name="dias"
                      defaultValue={diasDaCondicao(pedido.condicao_pagamento, pedido.prazo_recebimento_dias).join("/")}
                      className={estiloCampo}
                    />
                  </Campo>
                  <Campo rotulo="Contados a partir de" dica="Data da nota ou da entrega.">
                    <input name="base" type="date" defaultValue={hoje} className={estiloCampo} />
                  </Campo>
                  <Campo rotulo="Valor total (R$)">
                    <input name="total" inputMode="decimal" defaultValue={Number(pedido.valor_total)} className={estiloCampo} />
                  </Campo>
                </FormAcao>
              ) : (
                <p className="text-sm text-texto-suave">Nenhuma parcela gerada ainda.</p>
              )}
            </Cartao>
          )}

          <Cartao titulo="Etapa do pedido">
            <div className="space-y-5">
              {pode(acesso, TELA, "editar") && (
                <FormAcao
                  key={pedido.etapa_id}
                  acao={mudarEtapa.bind(null, pedido.id)}
                  rotulo="Mudar etapa"
                  secundario
                  className="space-y-3"
                >
                  <Campo rotulo="Nova etapa">
                    <select name="etapa_id" defaultValue={pedido.etapa_id} className={estiloCampo}>
                      {etapas
                        .filter((e) => e.ativa || e.id === pedido.etapa_id)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.nome} ({FASES_PEDIDO[e.fase]})
                          </option>
                        ))}
                    </select>
                  </Campo>
                </FormAcao>
              )}
              <ol className="space-y-3 border-l border-borda pl-4 text-sm">
                {historico.map((h, k) => (
                  <li key={k} className="relative">
                    <span
                      className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${k === historico.length - 1 ? "bg-primaria" : "bg-borda"}`}
                    />
                    <p className="font-medium">{h.etapa}</p>
                    <p className="text-xs text-texto-suave">
                      {new Date(h.em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                      {h.usuario ? ` · ${h.usuario}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </Cartao>
        </div>
      </div>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaPedido} />;
}
