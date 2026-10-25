"use client";

import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { CabecalhoTela, Cartao, Celula, Etiqueta, Fonte, Indicador, LinkAcao, SemAcesso, Tabela } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil, somarDias } from "@/lib/datas";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/formato";
import { necessidadeMateriais, type ItemPlan } from "@/lib/planejamento";
import { carregarPlanejamento } from "@/lib/planejamento-servidor";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "compras.sugestoes";
const COMPRADOS = ["materia_prima", "embalagem"];

type Linha = {
  item: ItemPlan;
  necessidade: number;
  saldo: number;
  falta: number;
  sugestao: number;
  data_limite: string | null;
  pedidos: number[];
  so_minimo: boolean;
};

async function PaginaSugestoes() {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const hoje = hojeBrasil();
  const semana = somarDias(hoje, 7);
  const dados = await carregarPlanejamento();
  const linhasMrp = dados ? necessidadeMateriais(dados, hoje) : [];
  const idPedido = new Map((dados?.pedidos ?? []).map((p) => [p.numero, p.id]));

  const doMrp = new Set(linhasMrp.map((l) => l.item.id));
  const linhas: Linha[] = [
    ...linhasMrp.filter((l) => !l.produzido && l.sugestao > 0).map((l) => ({ ...l, so_minimo: false })),
    // Fora dos pedidos: só a reposição do estoque mínimo.
    ...(dados?.itens ?? [])
      .filter((i) => COMPRADOS.includes(i.tipo) && !doMrp.has(i.id) && Number(i.estoque_minimo) > Number(i.saldo))
      .map((i) => ({
        item: i,
        necessidade: 0,
        saldo: Number(i.saldo),
        falta: 0,
        sugestao: Number(i.estoque_minimo) - Math.max(0, Number(i.saldo)),
        data_limite: null,
        pedidos: [],
        so_minimo: true,
      })),
  ].sort((a, b) => (a.data_limite ?? "9999").localeCompare(b.data_limite ?? "9999") || a.item.codigo.localeCompare(b.item.codigo));
  const produzir = linhasMrp.filter((l) => l.produzido && l.falta > 0);

  const paraPedidos = linhas.filter((l) => l.falta > 0);
  const atrasadas = paraPedidos.filter((l) => l.data_limite && l.data_limite <= hoje);
  const nestaSemana = paraPedidos.filter((l) => l.data_limite && l.data_limite > hoje && l.data_limite <= semana);
  const custo = (l: Linha[]) => l.reduce((s, x) => s + x.sugestao * Number(x.item.custo_medio), 0);
  const pedidosConsiderados = dados?.pedidos.length ?? 0;

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA} />
      {!dados ? (
        <p className="text-texto-suave">Não foi possível ler o planejamento.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador
              rotulo="Comprar já (prazo vencido)"
              valor={atrasadas.length}
              detalhe={formatarMoeda(custo(atrasadas))}
              cor={atrasadas.length ? "text-perigo" : ""}
              fonte="Itens que faltam para os pedidos cuja data limite (prazo do pedido menos o prazo de reposição) já passou."
            />
            <Indicador
              rotulo="Comprar nesta semana"
              valor={nestaSemana.length}
              detalhe={formatarMoeda(custo(nestaSemana))}
              fonte={`Data limite entre ${formatarData(somarDias(hoje, 1))} e ${formatarData(semana)}.`}
            />
            <Indicador
              rotulo="Total sugerido"
              valor={formatarMoeda(custo(linhas))}
              detalhe={`${linhas.length} ${linhas.length === 1 ? "item" : "itens"}`}
              fonte="Sugestão × custo médio atual. Inclui a reposição do estoque mínimo."
            />
            <Indicador
              rotulo="Pedidos considerados"
              valor={pedidosConsiderados}
              href="/vendas/pedidos"
              fonte="Pedidos de venda em etapas da fase Produção (confirmados e ainda não produzidos)."
            />
          </div>

          <Filtro
            atalhos={[
              {
                rotulo: "Mostrar",
                opcoes: [
                  { valor: "pedidos", rotulo: "Falta para pedidos" },
                  { valor: "atrasado", rotulo: "Prazo vencido" },
                  { valor: "minimo", rotulo: "Só reposição do mínimo" },
                ],
              },
            ]}
            placeholder="Filtrar por código, descrição, pedido..."
          >
            <Tabela
              colunas={["Item", "Pedidos precisam", "Estoque", "Falta", "Sugestão de compra", "Comprar até", "Custo estimado", "Pedidos"]}
              vazio="Nada a comprar: o estoque cobre os pedidos em produção e os mínimos."
            >
              {linhas.map((l) => {
                const vencida = !!l.data_limite && l.data_limite <= hoje && l.falta > 0;
                return (
                  <tr
                    key={l.item.id}
                    data-tags={[l.falta > 0 && "pedidos", vencida && "atrasado", l.so_minimo && "minimo"].filter(Boolean).join(" ")}
                  >
                    <Celula>
                      <span className="font-medium">{l.item.codigo}</span> · {l.item.descricao}
                      {l.so_minimo && (
                        <span className="ml-2">
                          <Etiqueta>Reposição do mínimo</Etiqueta>
                        </span>
                      )}
                    </Celula>
                    <Celula className="whitespace-nowrap tabular-nums">
                      {l.necessidade ? `${formatarNumero(l.necessidade)} ${l.item.unidade}` : "—"}
                    </Celula>
                    <Celula className="whitespace-nowrap tabular-nums">
                      <LinkAcao href={`/estoque/movimentos?item=${l.item.id}`}>{formatarNumero(l.saldo)}</LinkAcao>
                    </Celula>
                    <Celula className={`whitespace-nowrap tabular-nums ${l.falta > 0 ? "font-medium text-perigo" : "text-texto-suave"}`}>
                      {l.falta > 0 ? formatarNumero(l.falta) : "—"}
                    </Celula>
                    <Celula className="whitespace-nowrap tabular-nums font-medium">
                      {formatarNumero(Math.ceil(l.sugestao * 100) / 100)} {l.item.unidade}
                      {Number(l.item.estoque_minimo) > 0 && (
                        <span className="block text-xs font-normal text-texto-suave">
                          com mínimo de {formatarNumero(Number(l.item.estoque_minimo))}
                        </span>
                      )}
                    </Celula>
                    <Celula className={`whitespace-nowrap tabular-nums ${vencida ? "font-medium text-perigo" : ""}`}>
                      {formatarData(l.data_limite)}
                      {l.data_limite && (
                        <span className="block text-xs font-normal text-texto-suave">reposição {l.item.prazo_reposicao_dias} dias</span>
                      )}
                    </Celula>
                    <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(l.sugestao * Number(l.item.custo_medio))}</Celula>
                    <Celula className="text-sm">
                      {l.pedidos.map((n, k) => (
                        <span key={n}>
                          {k > 0 && ", "}
                          <LinkAcao href={`/vendas/pedidos/pedido?id=${idPedido.get(n)}`}>{n}</LinkAcao>
                        </span>
                      ))}
                    </Celula>
                  </tr>
                );
              })}
            </Tabela>
          </Filtro>
          <Fonte>
            Cálculo: produtos dos pedidos em produção × ficha técnica ativa (com perda), nível por nível, descontando o estoque de produto
            acabado e subconjuntos antes de abrir os componentes. Estoque = saldo do grupo (todos os locais). Comprar até = menor prazo de
            entrega entre os pedidos que usam o item, menos o prazo de reposição do cadastro. Clique no estoque para ver as movimentações e
            no número do pedido para abri-lo.
          </Fonte>

          {produzir.length > 0 && (
            <Cartao titulo="Subconjuntos e produtos a produzir">
              <Tabela colunas={["Item", "Pedidos precisam", "Estoque", "A produzir", "Pedidos"]} embutida>
                {produzir.map((l) => (
                  <tr key={l.item.id}>
                    <Celula>
                      <span className="font-medium">{l.item.codigo}</span> · {l.item.descricao}
                    </Celula>
                    <Celula className="whitespace-nowrap tabular-nums">
                      {formatarNumero(l.necessidade)} {l.item.unidade}
                    </Celula>
                    <Celula className="whitespace-nowrap tabular-nums">{formatarNumero(l.saldo)}</Celula>
                    <Celula className="whitespace-nowrap tabular-nums font-medium">{formatarNumero(l.falta)}</Celula>
                    <Celula className="text-sm">
                      {l.pedidos.map((n, k) => (
                        <span key={n}>
                          {k > 0 && ", "}
                          <LinkAcao href={`/vendas/pedidos/pedido?id=${idPedido.get(n)}`}>{n}</LinkAcao>
                        </span>
                      ))}
                    </Celula>
                  </tr>
                ))}
              </Tabela>
              <div className="mt-3">
                <Fonte>
                  Itens com ficha técnica: a falta é produzida, e os componentes dela já entram na lista de compra acima. A ordem sugerida
                  está na{" "}
                  <Link href="/producao/sequenciamento" className="text-primaria hover:underline">
                    fila de produção
                  </Link>
                  .
                </Fonte>
              </div>
            </Cartao>
          )}
        </>
      )}
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaSugestoes} />;
}
