"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { CabecalhoTela, Celula, Etiqueta, LinkAcao, SemAcesso, Tabela, estiloBotao } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { CAMPOS_PEDIDO_COMPRA, COR_ETAPA_COMPRA, type PedidoCompraResumo } from "@/lib/compras";
import { diasEntre, hojeBrasil } from "@/lib/datas";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { ETAPAS_COMPRA, type EtapaCompra } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "compras.pedidos";

async function carregar(empresa: string | null): Promise<PedidoCompraResumo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  let consulta = supabase.from("pedidos_compra_resumo").select(CAMPOS_PEDIDO_COMPRA).order("numero", { ascending: false }).limit(3000);
  if (empresa) consulta = consulta.eq("empresa_id", empresa);
  return ((await consulta).data ?? []) as unknown as PedidoCompraResumo[];
}

async function PaginaPedidosCompra({ searchParams }: { searchParams: Promise<{ etapa?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const { etapa } = await searchParams;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const pedidos = await carregar(selecionada?.id ?? null);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const hoje = hojeBrasil();

  const colunas = ["Nº", "Data", ...(selecionada ? [] : ["Empresa"]), "Fornecedor", "Etapa", "Previsto", "Valor", ""];

  return (
    <div className="space-y-3">
      <CabecalhoTela
        codigo={TELA}
        empresa={selecionada}
        ajuda={
          <>
            O pedido passa por Criação → Orçamento → Aguardando aprovação → Aprovado. Pedir aprovação exige os produtos e um orçamento
            escolhido; aprovar exige a permissão &quot;Aprovar&quot; desta tela. A nota do fornecedor só entra ligada a um pedido aprovado (ou
            com a justificativa de por que veio sem pedido) e, ao entrar, o pedido fica Recebido.
          </>
        }
      >
        {pode(acesso, TELA, "criar") && (
          <Link href="/compras/pedidos/novo" className={estiloBotao}>
            <Plus size={16} /> Novo pedido
          </Link>
        )}
      </CabecalhoTela>

      <Filtro
        situacoes={{
          rotulo: "Etapa",
          opcoes: [
            {
              valor: "",
              rotulo: "Todos",
              total: formatarMoeda(pedidos.reduce((s, p) => s + Number(p.valor_total), 0)),
              quantidade: pedidos.length,
              dica: "Todos os pedidos de compra que você vê, de qualquer etapa.",
            },
            ...(Object.keys(ETAPAS_COMPRA) as EtapaCompra[]).map((e) => {
              const lista = pedidos.filter((p) => p.etapa === e);
              return {
                valor: e,
                rotulo: ETAPAS_COMPRA[e],
                total: formatarMoeda(lista.reduce((s, p) => s + Number(p.valor_total), 0)),
                quantidade: lista.length,
                cor: e === "aprovacao" ? ("alerta" as const) : undefined,
                dica: `Pedidos na etapa ${ETAPAS_COMPRA[e]}: soma de itens + IPI + frete − desconto.`,
              };
            }),
          ],
        }}
        iniciais={etapa && etapa in ETAPAS_COMPRA ? { Etapa: etapa } : {}}
        placeholder="Filtrar por número, fornecedor, etapa, valor..."
      >
        <Tabela colunas={colunas} vazio="Nenhum pedido de compra ainda.">
          {pedidos.map((p) => {
            const atrasado = p.etapa === "aprovado" && p.data_prevista && p.data_prevista < hoje;
            return (
              <tr key={p.id} data-tags={p.etapa}>
                <Celula className="tabular-nums">
                  <LinkAcao href={`/compras/pedidos/pedido?id=${p.id}`}>{p.numero}</LinkAcao>
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums text-texto-suave">{formatarData(p.data_pedido)}</Celula>
                {!selecionada && <Celula className="whitespace-nowrap text-texto-suave">{nomeEmpresa.get(p.empresa_id) ?? "—"}</Celula>}
                <Celula>
                  <span className="font-medium">{p.fornecedor_nome ?? "A definir"}</span>
                  <span className="ml-2 text-xs text-texto-suave">
                    {p.quantidade_itens} {p.quantidade_itens === 1 ? "produto" : "produtos"}
                  </span>
                </Celula>
                <Celula className="whitespace-nowrap">
                  <Etiqueta cor={COR_ETAPA_COMPRA[p.etapa]}>{ETAPAS_COMPRA[p.etapa]}</Etiqueta>
                  <span className="ml-2 text-xs text-texto-suave">há {Math.max(0, diasEntre(p.etapa_desde.slice(0, 10), hoje))} dias</span>
                </Celula>
                <Celula className={`whitespace-nowrap tabular-nums ${atrasado ? "font-medium text-perigo" : ""}`}>
                  {formatarData(p.data_prevista)}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(Number(p.valor_total))}</Celula>
                <Celula className="text-right">
                  <LinkAcao href={`/compras/pedidos/pedido?id=${p.id}`}>Abrir</LinkAcao>
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaPedidosCompra} />;
}
