"use client";

import { Briefcase, Factory, Landmark, ShoppingCart, Users } from "lucide-react";
import Link from "next/link";
import { FaixaEmpresa, Fonte, Indicador } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { diaSemana, hojeBrasil, inicioSemana, somarDias } from "@/lib/datas";
import { empresaSelecionada } from "@/lib/empresa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { comprado, filaProducao, necessidadeMateriais } from "@/lib/planejamento";
import { carregarPlanejamento } from "@/lib/planejamento-servidor";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { CAMPOS_PEDIDO, carregarEtapas, confirmadosNoPeriodo, type PedidoResumo } from "@/lib/vendas";
import { TelaCliente } from "@/components/tela-cliente";

// Painel em blocos por área. Cada número abre os registros que o formam e
// diz de onde vem e qual período usa.

function Bloco({ titulo, icone: Icone, children }: { titulo: string; icone: typeof Briefcase; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl bg-fundo/60 p-3 shadow-[0_0_0_1px_var(--color-borda)]">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icone size={16} className="text-primaria" /> {titulo}
      </h2>
      {children}
    </section>
  );
}

const soma = (l: { valor_total: number }[]) => l.reduce((s, p) => s + Number(p.valor_total), 0);
const qtd = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

type Titulo = { valor: number; vencimento: string };

async function Painel() {
  const acesso = await carregarAcesso();
  const selecionada = await empresaSelecionada();
  const hoje = hojeBrasil();
  const segunda = inicioSemana(hoje);
  const verComercial = pode(acesso, "vendas.pedidos", "ver");
  const verPagar = pode(acesso, "financeiro.pagar", "ver");
  const verReceber = pode(acesso, "financeiro.receber", "ver");
  const verFinanceiro = verPagar || verReceber;
  const verProducao = pode(acesso, "producao.sequenciamento", "ver");
  const verCompras = pode(acesso, "compras.sugestoes", "ver");
  const verRh = ["rh.funcionarios", "rh.ponto", "rh.ferias"].some((t) => pode(acesso, t, "ver"));
  const supabase = supabaseConfigurado ? criarClienteNavegador() : null;

  // Títulos em aberto vencidos ou que vencem até depois de amanhã (a receber pelo líquido).
  const titulosAte = (tabela: "contas_pagar" | "contas_receber", campo: string) => {
    if (!supabase) return Promise.resolve([] as Titulo[]);
    let c = supabase
      .from(tabela)
      .select(`valor:${campo}, vencimento`)
      .eq("situacao", "aberto")
      .lte("vencimento", somarDias(hoje, 2))
      .limit(5000);
    if (selecionada) c = c.eq("empresa_id", selecionada.id);
    return c.then((r) => (r.data ?? []) as unknown as Titulo[]);
  };

  const [pedidos, etapas, titulos, receber, plano] = await Promise.all([
    (verComercial || verProducao) && supabase
      ? (() => {
          let c = supabase.from("pedidos_venda_resumo").select(CAMPOS_PEDIDO).neq("fase", "encerrado").limit(5000);
          if (selecionada) c = c.eq("empresa_id", selecionada.id);
          return c.then((r) => (r.data ?? []) as unknown as PedidoResumo[]);
        })()
      : Promise.resolve([] as PedidoResumo[]),
    verComercial || verProducao ? carregarEtapas() : Promise.resolve([]),
    verPagar ? titulosAte("contas_pagar", "valor") : Promise.resolve([] as Titulo[]),
    verReceber ? titulosAte("contas_receber", "valor_liquido") : Promise.resolve([] as Titulo[]),
    verProducao || verCompras ? carregarPlanejamento() : Promise.resolve(null),
  ]);
  const confirmados = verComercial ? await confirmadosNoPeriodo(etapas, segunda, hoje) : null;

  const periodoSemana = `de ${formatarData(segunda)} (segunda) a ${formatarData(hoje)}`;
  const daEmpresa = selecionada ? `só ${selecionada.nome}` : "todas as empresas que você vê";
  const negociacao = etapas.filter((e) => e.fase === "negociacao" && e.ativa);
  const producao = etapas.filter(
    (e) => (e.fase === "producao" || e.fase === "expedicao") && (e.ativa || pedidos.some((p) => p.etapa_id === e.id)),
  );
  const atrasados = pedidos.filter((p) => p.dias_atraso > 0);
  const aprovados = pedidos.filter((p) => confirmados?.ids.has(p.id));
  // Aprovados que já foram encerrados na semana também contam.
  const aprovadosEncerrados = confirmados ? confirmados.ids.size - aprovados.length : 0;

  const vencidas = titulos.filter((t) => t.vencimento < hoje);
  const vencidasReceber = receber.filter((t) => t.vencimento < hoje);
  const somar = (l: Titulo[]) => l.reduce((s, t) => s + Number(t.valor), 0);
  const dias = [0, 1, 2].map((n) => {
    const dia = somarDias(hoje, n);
    const pagar = titulos.filter((t) => t.vencimento === dia);
    const entrar = receber.filter((t) => t.vencimento === dia);
    return {
      dia,
      rotulo: n === 0 ? "Hoje" : n === 1 ? "Amanhã" : "Depois de amanhã",
      quantidade: pagar.length,
      valor: somar(pagar),
      quantidadeReceber: entrar.length,
      receber: somar(entrar),
    };
  });

  const fila = plano && verProducao ? filaProducao(plano, hoje) : [];
  const compras = plano && verCompras ? necessidadeMateriais(plano, hoje).filter((l) => comprado(l) && l.falta > 0) : [];
  const comprarJa = compras.filter((l) => l.data_limite && l.data_limite <= hoje);
  const comprarSemana = compras.filter((l) => l.data_limite && l.data_limite > hoje && l.data_limite <= somarDias(hoje, 7));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h1 className="text-lg font-semibold leading-tight" title="Clique em qualquer número para ver os registros que o formam.">
          Painel
        </h1>
        <span className="text-xs text-texto-suave">
          {diaSemana(hoje)}, {formatarData(hoje)}
        </span>
        {(verComercial || verFinanceiro) && <FaixaEmpresa empresa={selecionada} />}
      </div>

      {verComercial && (
        <Bloco titulo="Comercial" icone={Briefcase}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {negociacao.map((e) => {
              const lista = pedidos.filter((p) => p.etapa_id === e.id);
              return (
                <Indicador
                  key={e.id}
                  rotulo={e.nome}
                  valor={lista.length}
                  detalhe={formatarMoeda(soma(lista))}
                  cor={lista.length ? "text-alerta" : ""}
                  href={`/vendas/pedidos?etapa=${e.id}`}
                  fonte="Pedidos parados hoje nesta etapa de negociação."
                />
              );
            })}
            <Indicador
              rotulo="Aprovados na semana"
              valor={confirmados?.ids.size ?? 0}
              detalhe={formatarMoeda(soma(aprovados)) + (aprovadosEncerrados > 0 ? ` + ${aprovadosEncerrados} já encerrados` : "")}
              cor="text-sucesso"
              href={`/vendas/pedidos?confirmados_de=${segunda}&confirmados_ate=${hoje}`}
              fonte={`Entraram em "${confirmados?.etapa?.nome ?? "produção"}" ${periodoSemana}.`}
            />
            <Indicador
              rotulo="Entrega atrasada"
              valor={atrasados.length}
              detalhe={formatarMoeda(soma(atrasados))}
              cor={atrasados.length ? "text-perigo" : ""}
              href="/vendas/pedidos?atrasados=1"
              fonte={`Pedidos em aberto com prazo de entrega antes de ${formatarData(hoje)}.`}
            />
          </div>
          <Fonte>Fonte: pedidos de venda (etapa atual e histórico de etapas) · {daEmpresa}.</Fonte>
        </Bloco>
      )}

      {verFinanceiro && (
        <Bloco titulo="Financeiro" icone={Landmark}>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl bg-superficie px-3 py-2 shadow-[0_1px_3px_rgba(16,24,40,0.06)] lg:col-span-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-texto-suave">
                    <th className="pb-1 font-medium">Dia</th>
                    <th className="pb-1 text-right font-medium">A pagar</th>
                    <th className="pb-1 text-right font-medium">A receber</th>
                    <th className="pb-1 text-right font-medium">Saldo do dia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda/70">
                  {dias.map((d) => (
                    <tr key={d.dia}>
                      <td className="py-1.5">
                        {d.rotulo} <span className="text-xs text-texto-suave">{formatarData(d.dia)}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {verPagar ? (
                          <>
                            <Link
                              href={`/financeiro/pagar?de=${d.dia}&ate=${d.dia}&por=vencimento`}
                              className="text-primaria hover:underline"
                            >
                              {formatarMoeda(d.valor)}
                            </Link>
                            <span className="block text-xs text-texto-suave">{qtd(d.quantidade, "conta", "contas")}</span>
                          </>
                        ) : (
                          <span className="text-texto-suave">—</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {verReceber ? (
                          <>
                            <Link
                              href={`/financeiro/receber?de=${d.dia}&ate=${d.dia}&por=vencimento`}
                              className="text-primaria hover:underline"
                            >
                              {formatarMoeda(d.receber)}
                            </Link>
                            <span className="block text-xs text-texto-suave">{qtd(d.quantidadeReceber, "conta", "contas")}</span>
                          </>
                        ) : (
                          <span className="text-texto-suave">—</span>
                        )}
                      </td>
                      <td className={`py-1.5 text-right tabular-nums ${d.receber - d.valor < 0 ? "text-perigo" : ""}`}>
                        {verPagar && verReceber ? formatarMoeda(d.receber - d.valor) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3">
              {verPagar && (
                <Indicador
                  rotulo="Contas a pagar vencidas"
                  valor={formatarMoeda(somar(vencidas))}
                  detalhe={qtd(vencidas.length, "conta em aberto", "contas em aberto")}
                  cor={vencidas.length ? "text-perigo" : ""}
                  href="/financeiro/pagar?situacao=vencido"
                  fonte={`Em aberto com vencimento antes de ${formatarData(hoje)}.`}
                />
              )}
              {verReceber && (
                <Indicador
                  rotulo="Contas a receber vencidas"
                  valor={formatarMoeda(somar(vencidasReceber))}
                  detalhe={qtd(vencidasReceber.length, "conta em aberto", "contas em aberto")}
                  cor={vencidasReceber.length ? "text-alerta" : ""}
                  href="/financeiro/receber?situacao=vencido"
                  fonte={`Em aberto com vencimento antes de ${formatarData(hoje)}, pelo líquido.`}
                />
              )}
            </div>
          </div>
          <Fonte>
            Fonte: contas a pagar e a receber em aberto pelo vencimento · {daEmpresa}. A receber pelo valor líquido (vendas das plataformas
            já sem comissão e frete, na data em que o dinheiro é liberado). Saldo do dia = a receber − a pagar.
          </Fonte>
        </Bloco>
      )}

      {verProducao && (
        <Bloco titulo="Produção" icone={Factory}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {producao.map((e) => {
              const lista = pedidos.filter((p) => p.etapa_id === e.id);
              return (
                <Indicador
                  key={e.id}
                  rotulo={e.nome}
                  valor={lista.length}
                  detalhe={formatarMoeda(soma(lista))}
                  href={`/vendas/pedidos?etapa=${e.id}`}
                  fonte="Pedidos nesta etapa hoje."
                />
              );
            })}
            <Indicador
              rotulo="Parados por falta de material"
              valor={fila.filter((f) => !f.pode_produzir).length}
              detalhe={formatarMoeda(fila.filter((f) => !f.pode_produzir).reduce((s, f) => s + f.valor, 0))}
              cor={fila.some((f) => !f.pode_produzir) ? "text-alerta" : ""}
              href="/producao/sequenciamento"
              fonte="Pela fila de produção: estoque reservado na ordem sugerida."
            />
          </div>
          <Fonte>
            Fonte: pedidos de venda pela etapa atual · {verComercial ? daEmpresa : "todas as empresas"}; fila de produção calculada agora.
          </Fonte>
        </Bloco>
      )}

      {verCompras && (
        <Bloco titulo="Compras" icone={ShoppingCart}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Indicador
              rotulo="Comprar já"
              valor={comprarJa.length}
              detalhe={
                comprarJa
                  .slice(0, 3)
                  .map((l) => l.item.codigo)
                  .join(", ") || "nada vencido"
              }
              cor={comprarJa.length ? "text-perigo" : ""}
              href="/compras/sugestoes"
              fonte="Falta para pedidos em produção e a data limite (prazo do pedido menos reposição) já passou."
            />
            <Indicador
              rotulo="Comprar nesta semana"
              valor={comprarSemana.length}
              detalhe={
                comprarSemana
                  .slice(0, 3)
                  .map((l) => l.item.codigo)
                  .join(", ") || "—"
              }
              href="/compras/sugestoes"
              fonte={`Data limite até ${formatarData(somarDias(hoje, 7))}.`}
            />
          </div>
          <Fonte>Fonte: pedidos em produção × ficha técnica, contra o estoque do grupo, calculado agora.</Fonte>
        </Bloco>
      )}

      {verRh && (
        <Bloco titulo="RH" icone={Users}>
          <p className="text-sm text-texto-suave">
            Alertas de férias, faltas e escala aparecem aqui assim que o cadastro de funcionários e o ponto forem lançados no sistema.
          </p>
        </Bloco>
      )}
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={Painel} />;
}
