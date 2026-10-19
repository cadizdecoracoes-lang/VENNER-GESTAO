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
import { FASES_PEDIDO, PRIORIDADES, type FasePedido } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { CAMPOS_PEDIDO, carregarEtapas, nomeCliente, type PedidoResumo } from "@/lib/vendas";
import { mudarEtapa } from "../actions";

const TELA = "vendas.pedidos";

type ItemPedido = {
  item_id: string;
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
  itens: { codigo: string; descricao: string; unidade: string } | null;
};
type Historico = { etapa: string; fase: FasePedido; em: string; usuario: string | null };

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
  const [{ data: itensData }, { data: historicoData }, etapas, empresas, plano] = await Promise.all([
    supabase
      .from("pedido_venda_itens")
      .select("item_id, quantidade, preco_unitario, valor_total, itens(codigo, descricao, unidade)")
      .eq("pedido_id", id),
    supabase.rpc("historico_pedido", { pedido: id }),
    carregarEtapas(),
    carregarEmpresas(),
    planeja ? supabase.rpc("dados_planejamento") : Promise.resolve({ data: null }),
  ]);
  const itens = (itensData ?? []) as unknown as ItemPedido[];
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

        <Cartao titulo="Etapa do pedido">
          <div className="space-y-5">
            {pode(acesso, TELA, "editar") && (
              <FormAcao key={pedido.etapa_id} acao={mudarEtapa.bind(null, pedido.id)} rotulo="Mudar etapa" secundario className="space-y-3">
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
  );
}
