import { Pencil, Printer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { necessidadeMateriais, type DadosPlanejamento } from "@/lib/planejamento";
import { diasDaCondicao } from "@/lib/parcelas";
import { FASES_PEDIDO, PRIORIDADES, type FasePedido, type SituacaoTitulo } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { CAMPOS_ENDERECO, FRETE_POR_CONTA } from "@/lib/cadastros-comercial";
import { CAMPOS_PEDIDO, carregarEtapas, nomeCliente, type PedidoResumo } from "@/lib/vendas";
import { gerarParcelas, mudarEtapa } from "../actions";

const TELA = "vendas.pedidos";

type ItemPedido = {
  item_id: string;
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
  info_adicional: string | null;
  itens: { codigo: string; descricao: string; unidade: string } | null;
};
type Nome = { nome: string } | null;
// Campos que o pedido tem como no Tiny.
type DadosTiny = {
  numero_ordem_compra: string | null;
  frete_por_conta: string | null;
  valor_frete: number;
  valor_desconto: number;
  valor_outras_despesas: number;
  codigo_rastreamento: string | null;
  url_rastreamento: string | null;
  endereco_entrega: Record<string, string> | null;
  observacao_interna: string | null;
  data_envio: string | null;
  data_entregue: string | null;
  nota_fiscal: string | null;
  nota_fiscal_serie: string | null;
  nota_fiscal_chave: string | null;
  data_faturamento: string | null;
  vendedores: Nome;
  listas_preco: Nome;
  naturezas_operacao: Nome;
  formas_pagamento: Nome;
  transportadoras: Nome;
  formas_envio: Nome;
  pedido_parcelas: { numero: number; dias: number | null; vencimento: string | null; valor: number; observacao: string | null }[];
};
const CAMPOS_TINY =
  "numero_ordem_compra, frete_por_conta, valor_frete, valor_desconto, valor_outras_despesas, codigo_rastreamento, url_rastreamento, endereco_entrega, observacao_interna, data_envio, data_entregue, nota_fiscal, nota_fiscal_serie, nota_fiscal_chave, data_faturamento, vendedores(nome), listas_preco(nome), naturezas_operacao(nome), formas_pagamento(nome), transportadoras(nome), formas_envio(nome), pedido_parcelas(numero, dias, vencimento, valor, observacao)";

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-texto-suave">{rotulo}</dt>
      <dd>{children || "—"}</dd>
    </div>
  );
}
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

export default async function PaginaPedido({ params }: { params: Promise<{ id: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const { id } = await params;
  if (!supabaseConfigurado) notFound();
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("pedidos_venda_resumo").select(CAMPOS_PEDIDO).eq("id", id).maybeSingle();
  if (!data) notFound();
  const pedido = data as unknown as PedidoResumo;

  const planeja = pode(acesso, "producao.sequenciamento", "ver") || pode(acesso, "compras.sugestoes", "ver");
  const veReceber = pode(acesso, "financeiro.receber", "ver");
  const [{ data: tinyData }, { data: itensData }, { data: historicoData }, etapas, empresas, plano, { data: titulosData }] = await Promise.all([
    supabase.from("pedidos_venda").select(CAMPOS_TINY).eq("id", id).maybeSingle(),
    supabase
      .from("pedido_venda_itens")
      .select("item_id, quantidade, preco_unitario, valor_total, info_adicional, itens(codigo, descricao, unidade)")
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
  ]);
  const itens = (itensData ?? []) as unknown as ItemPedido[];
  const tiny = tinyData as unknown as DadosTiny | null;
  const totalGeral = tiny
    ? Number(pedido.valor_total) + Number(tiny.valor_frete) + Number(tiny.valor_outras_despesas) - Number(tiny.valor_desconto)
    : Number(pedido.valor_total);
  const parcelasCombinadas = [...(tiny?.pedido_parcelas ?? [])].sort((a, b) => a.numero - b.numero);
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
  const comprados = materiais?.filter((m) => !m.produzido) ?? [];
  const faltando = comprados.filter((m) => m.falta > 0);
  const empresa = empresas.find((e) => e.id === pedido.empresa_id)?.nome;
  const atrasado = pedido.fase !== "encerrado" && pedido.dias_atraso > 0;

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        <Link href={`/impressao/pedido/${pedido.id}`} target="_blank" className={estiloBotaoSecundario}>
          <Printer size={16} /> Imprimir
        </Link>
        {pode(acesso, TELA, "editar") && pedido.fase === "negociacao" && (
          <Link href={`/vendas/pedidos/${pedido.id}/editar`} className={estiloBotaoSecundario}>
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

      {tiny && (
        <Cartao titulo="Dados do pedido">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Dado rotulo="Vendedor">{tiny.vendedores?.nome}</Dado>
            <Dado rotulo="Nº da ordem de compra">{tiny.numero_ordem_compra}</Dado>
            <Dado rotulo="Lista de preço">{tiny.listas_preco?.nome ?? "Padrão"}</Dado>
            <Dado rotulo="Natureza de operação">{tiny.naturezas_operacao?.nome}</Dado>
            <Dado rotulo="Forma de recebimento">{tiny.formas_pagamento?.nome}</Dado>
            <Dado rotulo="Transportadora">{tiny.transportadoras?.nome}</Dado>
            <Dado rotulo="Forma de envio">{tiny.formas_envio?.nome}</Dado>
            <Dado rotulo="Frete por conta">{tiny.frete_por_conta && FRETE_POR_CONTA[tiny.frete_por_conta]}</Dado>
            <Dado rotulo="Rastreio">
              {tiny.url_rastreamento ? (
                <a href={tiny.url_rastreamento} target="_blank" rel="noreferrer" className="text-primaria hover:underline">
                  {tiny.codigo_rastreamento ?? "Abrir"}
                </a>
              ) : (
                tiny.codigo_rastreamento
              )}
            </Dado>
            <Dado rotulo="Nota fiscal">
              {tiny.nota_fiscal &&
                `nº ${tiny.nota_fiscal}${tiny.nota_fiscal_serie ? ` série ${tiny.nota_fiscal_serie}` : ""}${
                  tiny.data_faturamento ? ` · ${formatarData(tiny.data_faturamento)}` : ""
                }`}
            </Dado>
            <Dado rotulo="Enviado em">{tiny.data_envio && formatarData(tiny.data_envio)}</Dado>
            <Dado rotulo="Entregue em">{tiny.data_entregue && formatarData(tiny.data_entregue)}</Dado>
          </dl>
          <dl className="mt-4 grid gap-4 border-t border-borda pt-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <Dado rotulo="Produtos">{formatarMoeda(Number(pedido.valor_total))}</Dado>
            <Dado rotulo="Frete">{formatarMoeda(Number(tiny.valor_frete))}</Dado>
            <Dado rotulo="Outras despesas">{formatarMoeda(Number(tiny.valor_outras_despesas))}</Dado>
            <Dado rotulo="Desconto">{formatarMoeda(Number(tiny.valor_desconto))}</Dado>
            <Dado rotulo="Total do pedido">
              <span className="font-semibold tabular-nums">{formatarMoeda(totalGeral)}</span>
            </Dado>
          </dl>
          {parcelasCombinadas.length > 0 && (
            <div className="mt-4 border-t border-borda pt-4">
              <p className="mb-2 text-sm font-medium">Parcelas combinadas</p>
              <Tabela colunas={["Nº", "Dias", "Vencimento", "Valor", "Observação"]} embutida>
                {parcelasCombinadas.map((p) => (
                  <tr key={p.numero}>
                    <Celula className="tabular-nums">{p.numero}</Celula>
                    <Celula className="tabular-nums">{p.dias ?? "—"}</Celula>
                    <Celula>{formatarData(p.vencimento)}</Celula>
                    <Celula className="tabular-nums">{formatarMoeda(Number(p.valor))}</Celula>
                    <Celula>{p.observacao ?? "—"}</Celula>
                  </tr>
                ))}
              </Tabela>
            </div>
          )}
          {(tiny.endereco_entrega || tiny.observacao_interna) && (
            <dl className="mt-4 grid gap-4 border-t border-borda pt-4 text-sm sm:grid-cols-2">
              {tiny.endereco_entrega && (
                <Dado rotulo="Entregar em">
                  {CAMPOS_ENDERECO.map((c) => tiny.endereco_entrega?.[c.nome])
                    .filter(Boolean)
                    .join(", ")}
                </Dado>
              )}
              {tiny.observacao_interna && <Dado rotulo="Observações internas">{tiny.observacao_interna}</Dado>}
            </dl>
          )}
        </Cartao>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Cartao titulo="Produtos">
            <Tabela colunas={["Produto", "Quantidade", "Preço unitário", "Total"]} embutida>
              {itens.map((i) => (
                <tr key={i.item_id}>
                  <Celula>
                    <span className="font-medium">{i.itens?.codigo}</span> · {i.itens?.descricao}
                    {i.info_adicional && <span className="block text-xs text-texto-suave">{i.info_adicional}</span>}
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
              faltando.length > 0 ? (
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
                  vazio="Os produtos deste pedido ainda não têm ficha técnica ativa."
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
                      defaultValue={(parcelasCombinadas.length && parcelasCombinadas.every((p) => p.dias !== null)
                        ? parcelasCombinadas.map((p) => p.dias)
                        : diasDaCondicao(pedido.condicao_pagamento, pedido.prazo_recebimento_dias)
                      ).join("/")}
                      className={estiloCampo}
                    />
                  </Campo>
                  <Campo rotulo="Contados a partir de" dica="Data da nota ou da entrega.">
                    <input name="base" type="date" defaultValue={hoje} className={estiloCampo} />
                  </Campo>
                  <Campo rotulo="Valor total (R$)">
                    <input name="total" inputMode="decimal" defaultValue={totalGeral} className={estiloCampo} />
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
