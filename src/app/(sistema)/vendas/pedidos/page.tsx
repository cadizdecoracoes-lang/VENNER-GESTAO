import { ListOrdered, Plus } from "lucide-react";
import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { FiltroPeriodo, lerPeriodo, type Periodo } from "@/components/periodo";
import {
  CabecalhoTela,
  Celula,
  Etiqueta,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloBotaoSecundario,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { diasEntre, hojeBrasil, somarDias } from "@/lib/datas";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { FASES_PEDIDO, PRIORIDADES } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { CAMPOS_PEDIDO, carregarEtapas, confirmadosNoPeriodo, nomeCliente, type PedidoResumo } from "@/lib/vendas";

const TELA = "vendas.pedidos";
const DATAS_PERIODO = { data_pedido: "Data do pedido", prazo_entrega: "Prazo de entrega" };
const DIAS_ENCERRADOS = 90;

type Filtros = {
  de?: string;
  ate?: string;
  por?: string;
  etapa?: string;
  confirmados_de?: string;
  confirmados_ate?: string;
  atrasados?: string;
};

async function carregar(empresa: string | null, periodo: Periodo, hoje: string): Promise<PedidoResumo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  let consulta = supabase.from("pedidos_venda_resumo").select(CAMPOS_PEDIDO).order("numero", { ascending: false }).limit(3000);
  if (periodo) consulta = consulta.gte(periodo.por, periodo.de).lte(periodo.por, periodo.ate);
  // Sem período: o funil inteiro em aberto e os encerrados recentes.
  else consulta = consulta.or(`fase.neq.encerrado,etapa_desde.gte.${somarDias(hoje, -DIAS_ENCERRADOS)}`);
  if (empresa) consulta = consulta.eq("empresa_id", empresa);
  return ((await consulta).data ?? []) as unknown as PedidoResumo[];
}

export default async function PaginaPedidos({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const hoje = hojeBrasil();
  const periodo = lerPeriodo(filtros, Object.keys(DATAS_PERIODO));
  const [empresas, selecionada, etapas] = await Promise.all([carregarEmpresas(), empresaSelecionada(), carregarEtapas()]);
  const todos = await carregar(selecionada?.id ?? null, periodo, hoje);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const etapaFiltro = etapas.find((e) => e.id === filtros.etapa);
  // Recortes que chegam do painel: confirmados num período e atrasados.
  const data = /^\d{4}-\d{2}-\d{2}$/;
  const confirmados =
    filtros.confirmados_de && filtros.confirmados_ate && data.test(filtros.confirmados_de) && data.test(filtros.confirmados_ate)
      ? {
          de: filtros.confirmados_de,
          ate: filtros.confirmados_ate,
          ...(await confirmadosNoPeriodo(etapas, filtros.confirmados_de, filtros.confirmados_ate)),
        }
      : null;
  const pedidos = todos.filter(
    (p) =>
      (!etapaFiltro || p.etapa_id === etapaFiltro.id) &&
      (!confirmados || confirmados.ids.has(p.id)) &&
      (!filtros.atrasados || (p.fase !== "encerrado" && p.dias_atraso > 0)),
  );

  const manterPeriodo = periodo ? `de=${periodo.de}&ate=${periodo.ate}&por=${periodo.por}` : "";
  const linkEtapa = (id?: string) => "?" + [manterPeriodo, id ? `etapa=${id}` : ""].filter(Boolean).join("&");
  const textoPeriodo = periodo
    ? `${DATAS_PERIODO[periodo.por as keyof typeof DATAS_PERIODO].toLowerCase()} de ${formatarData(periodo.de)} a ${formatarData(periodo.ate)}`
    : `pedidos em aberto, e encerrados nos últimos ${DIAS_ENCERRADOS} dias`;

  // Funil: etapas ativas, mais as inativas que ainda têm pedido parado nelas.
  const funil = etapas
    .filter((e) => e.ativa || todos.some((p) => p.etapa_id === e.id))
    .map((e) => {
      const lista = todos.filter((p) => p.etapa_id === e.id);
      return { etapa: e, quantidade: lista.length, valor: lista.reduce((s, p) => s + Number(p.valor_total), 0) };
    });

  const colunas = ["Nº", "Data", ...(selecionada ? [] : ["Empresa"]), "Cliente", "Etapa", "Prazo", "Valor", ""];

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} empresa={selecionada}>
        {pode(acesso, "producao.sequenciamento", "ver") && (
          <Link href="/producao/sequenciamento" className={estiloBotaoSecundario}>
            <ListOrdered size={16} /> Fila de produção
          </Link>
        )}
        {pode(acesso, TELA, "criar") && (
          <Link href="/vendas/pedidos/novo" className={estiloBotao}>
            <Plus size={16} /> Novo pedido
          </Link>
        )}
      </CabecalhoTela>

      {/* Funil numa faixa fina: cada etapa com quantidade e valor; clicar filtra a lista. */}
      <div
        className="flex overflow-x-auto rounded-xl bg-superficie shadow-[0_1px_3px_rgba(16,24,40,0.06)] [scrollbar-width:thin]"
        title={`Funil: quantidade e valor (soma dos itens) dos pedidos de venda pela etapa atual · ${textoPeriodo}${selecionada ? ` · só ${selecionada.nome}` : " · todas as empresas que você vê"}. Clique numa etapa para ver os pedidos dela.`}
      >
        {funil.map(({ etapa, quantidade, valor }) => {
          const marcado = etapaFiltro?.id === etapa.id;
          return (
            <Link
              key={etapa.id}
              href={marcado ? linkEtapa() : linkEtapa(etapa.id)}
              className={`min-w-28 flex-1 border-b-2 px-3 py-1.5 transition-colors first:rounded-l-xl last:rounded-r-xl ${marcado ? "border-primaria bg-primaria-suave/60" : "border-transparent hover:bg-fundo"}`}
            >
              <span className={`block truncate text-xs ${marcado ? "font-medium text-primaria" : "text-texto-suave"}`} title={etapa.nome}>
                {etapa.nome} <span className="tabular-nums opacity-80">({quantidade})</span>
              </span>
              <span className="block whitespace-nowrap text-sm font-semibold tabular-nums">{formatarMoeda(valor)}</span>
            </Link>
          );
        })}
      </div>

      {etapaFiltro && (
        <p className="text-sm">
          Mostrando só a etapa <strong>{etapaFiltro.nome}</strong>. <LinkAcao href={linkEtapa()}>Ver todas</LinkAcao>
        </p>
      )}
      {confirmados && (
        <p className="text-sm">
          Mostrando os pedidos que entraram em <strong>{confirmados.etapa?.nome ?? "produção"}</strong> entre {formatarData(confirmados.de)}{" "}
          e {formatarData(confirmados.ate)}. <LinkAcao href="/vendas/pedidos">Ver todos</LinkAcao>
        </p>
      )}
      {filtros.atrasados && (
        <p className="text-sm">
          Mostrando os pedidos em aberto com prazo de entrega vencido. <LinkAcao href="/vendas/pedidos">Ver todos</LinkAcao>
        </p>
      )}

      <Filtro
        ferramentas={<FiltroPeriodo periodo={periodo} hoje={hoje} campos={DATAS_PERIODO} semPeriodo="Em aberto e recentes" />}
        atalhos={[
          {
            rotulo: "Fase",
            opcoes: [
              ...Object.entries(FASES_PEDIDO).map(([valor, rotulo]) => ({ valor, rotulo })),
              { valor: "atrasado", rotulo: "Atrasados" },
            ],
          },
        ]}
        placeholder="Filtrar por número, cliente, etapa, valor..."
      >
        <Tabela colunas={colunas} vazio="Nenhum pedido neste filtro.">
          {pedidos.map((p) => {
            const atrasado = p.fase !== "encerrado" && p.dias_atraso > 0;
            return (
              <tr key={p.id} data-tags={[p.fase, atrasado && "atrasado"].filter(Boolean).join(" ")}>
                <Celula className="tabular-nums">
                  <LinkAcao href={`/vendas/pedidos/${p.id}`}>{p.numero}</LinkAcao>
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums text-texto-suave">{formatarData(p.data_pedido)}</Celula>
                {!selecionada && <Celula className="whitespace-nowrap text-texto-suave">{nomeEmpresa.get(p.empresa_id) ?? "—"}</Celula>}
                <Celula>
                  <span className="font-medium">{nomeCliente(p)}</span>
                  {p.prioridade > 0 && (
                    <span className="ml-2">
                      <Etiqueta cor="alerta">{PRIORIDADES[p.prioridade as 1 | 2]}</Etiqueta>
                    </span>
                  )}
                  {p.clientes?.cidade && (
                    <span className="block text-xs text-texto-suave">
                      {p.clientes.cidade}
                      {p.clientes.uf ? `/${p.clientes.uf}` : ""}
                    </span>
                  )}
                </Celula>
                <Celula>
                  <Etiqueta
                    cor={
                      p.fase === "producao"
                        ? "primaria"
                        : p.fase === "expedicao"
                          ? "sucesso"
                          : p.fase === "negociacao"
                            ? "alerta"
                            : "neutra"
                    }
                  >
                    {p.etapa_nome}
                  </Etiqueta>
                  <span className="block text-xs text-texto-suave">há {Math.max(0, diasEntre(p.etapa_desde.slice(0, 10), hoje))} dias</span>
                </Celula>
                <Celula className={`whitespace-nowrap tabular-nums ${atrasado ? "font-medium text-perigo" : ""}`}>
                  {formatarData(p.prazo_entrega)}
                  {atrasado && <span className="block text-xs">{p.dias_atraso} dias de atraso</span>}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums">
                  {formatarMoeda(Number(p.valor_total))}
                  <span className="block text-xs text-texto-suave">
                    {p.quantidade_itens} {p.quantidade_itens === 1 ? "produto" : "produtos"}
                  </span>
                </Celula>
                <Celula className="text-right">
                  <LinkAcao href={`/vendas/pedidos/${p.id}`}>Abrir</LinkAcao>
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
    </div>
  );
}
