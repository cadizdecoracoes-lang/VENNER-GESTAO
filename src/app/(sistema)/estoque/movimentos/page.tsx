"use client";

import { Filtro } from "@/components/filtro";
import { FiltroPeriodo, lerPeriodo, type Periodo } from "@/components/periodo";
import { CabecalhoTela, Celula, Etiqueta, Fonte, LinkAcao, SemAcesso, Tabela } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil, somarDias } from "@/lib/datas";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "estoque.movimentos";
const DATAS_PERIODO = { data: "Data do movimento" };
const TIPOS = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste" } as const;
const ORIGENS: Record<string, string> = {
  nota_fornecedor: "Nota de fornecedor",
  inventario: "Inventário",
  pedido_venda: "Pedido de venda",
};

type Movimento = {
  id: string;
  data: string;
  tipo: keyof typeof TIPOS;
  quantidade: number;
  custo_unitario: number | null;
  origem_tipo: string;
  origem_id: string | null;
  observacao: string | null;
  itens: { id: string; codigo: string; descricao: string; unidade: string } | null;
  locais_estoque: { nome: string } | null;
};
type Filtros = { item?: string; de?: string; ate?: string; por?: string };

async function carregar(item: string | undefined, periodo: Periodo, hoje: string): Promise<Movimento[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  let consulta = supabase
    .from("movimentos_estoque")
    .select(
      "id, data, tipo, quantidade, custo_unitario, origem_tipo, origem_id, observacao, itens(id, codigo, descricao, unidade), locais_estoque(nome)",
    )
    .order("data", { ascending: false })
    .limit(3000);
  if (item) consulta = consulta.eq("item_id", item);
  // Com item escolhido, mostra o histórico todo (é o que forma o saldo).
  if (periodo) consulta = consulta.gte("data", periodo.de).lt("data", somarDias(periodo.ate, 1));
  else if (!item) consulta = consulta.gte("data", somarDias(hoje, -60));
  return ((await consulta).data ?? []) as unknown as Movimento[];
}

function linkOrigem(m: Movimento) {
  if (m.origem_tipo === "nota_fornecedor" && m.origem_id) return `/financeiro/notas-fornecedor/nota?id=${m.origem_id}`;
  if (m.origem_tipo === "pedido_venda" && m.origem_id) return `/vendas/pedidos/pedido?id=${m.origem_id}`;
  return null;
}

async function PaginaMovimentos({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver") && !pode(acesso, "estoque.saldos", "ver")) return <SemAcesso codigo={TELA} />;
  const filtros = await searchParams;
  const hoje = hojeBrasil();
  const periodo = lerPeriodo(filtros, Object.keys(DATAS_PERIODO));
  const movimentos = await carregar(filtros.item, periodo, hoje);
  const item = filtros.item ? movimentos[0]?.itens : null;
  const total = movimentos.reduce((s, m) => s + Number(m.quantidade), 0);

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} />
      {filtros.item && (
        <div className="rounded-xl bg-primaria-suave px-4 py-3 text-sm text-primaria">
          {item ? (
            <>
              Movimentações de{" "}
              <strong>
                {item.codigo} · {item.descricao}
              </strong>
              {periodo ? " no período" : ", desde o início"}: soma{" "}
              <strong>
                {formatarNumero(total)} {item.unidade}
              </strong>
              {periodo ? "" : " (é o saldo atual do grupo)"}.{" "}
            </>
          ) : (
            "Nenhuma movimentação deste item ainda. "
          )}
          <LinkAcao href="/estoque/movimentos">Ver todos os itens</LinkAcao>
        </div>
      )}
      <Filtro
        ferramentas={
          <FiltroPeriodo
            periodo={periodo}
            hoje={hoje}
            campos={DATAS_PERIODO}
            semPeriodo={filtros.item ? "Desde o início" : "Últimos 60 dias"}
          />
        }
        periodo={false}
        atalhos={[{ rotulo: "Tipo", opcoes: Object.entries(TIPOS).map(([valor, rotulo]) => ({ valor, rotulo })) }]}
        placeholder="Filtrar por item, local, origem..."
      >
        <Tabela
          colunas={["Data", "Item", "Local", "Tipo", "Quantidade", "Custo unit.", "Origem"]}
          vazio="Nenhuma movimentação neste período."
        >
          {movimentos.map((m) => {
            const origem = linkOrigem(m);
            return (
              <tr key={m.id} data-tags={m.tipo}>
                <Celula className="whitespace-nowrap tabular-nums text-texto-suave">{formatarData(m.data)}</Celula>
                <Celula>
                  <LinkAcao href={`/estoque/movimentos?item=${m.itens?.id}`}>{m.itens?.codigo}</LinkAcao> · {m.itens?.descricao}
                </Celula>
                <Celula className="text-texto-suave">{m.locais_estoque?.nome}</Celula>
                <Celula>
                  <Etiqueta cor={m.tipo === "entrada" ? "sucesso" : m.tipo === "saida" ? "alerta" : "neutra"}>{TIPOS[m.tipo]}</Etiqueta>
                </Celula>
                <Celula className={`whitespace-nowrap tabular-nums ${Number(m.quantidade) < 0 ? "text-perigo" : ""}`}>
                  {Number(m.quantidade) > 0 ? "+" : ""}
                  {formatarNumero(Number(m.quantidade))} {m.itens?.unidade}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums text-texto-suave">
                  {m.custo_unitario === null ? "—" : formatarMoeda(Number(m.custo_unitario))}
                </Celula>
                <Celula className="text-sm">
                  {origem ? <LinkAcao href={origem}>{ORIGENS[m.origem_tipo]}</LinkAcao> : (ORIGENS[m.origem_tipo] ?? m.origem_tipo)}
                  {m.observacao && <span className="block text-xs text-texto-suave">{m.observacao}</span>}
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
      <Fonte>
        Cada linha é um registro de origem: entrada de nota de fornecedor, ajuste de inventário ou saída por venda. Movimento não se apaga
        nem se edita; corrige-se com outro ajuste.
      </Fonte>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaMovimentos} />;
}
