import Link from "next/link";
import { X } from "lucide-react";
import { Celula, Tabela } from "@/components/ui";
import { formatarData } from "@/lib/formato";
import { rotuloMes } from "@/lib/indicadores";
import { periodoDaOrigem, totalDaComposicao, type FiltroOrigem, type Origem } from "@/lib/indicadores-origem";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { formatar } from "./pecas";

// Painel "Origem do valor" da tela de Indicadores: a conta, a composição por
// categoria/grupo e mês, e os lançamentos de origem, cada um levando à tela
// onde está o registro.

export type Lancamento = {
  id: string;
  data: string | null;
  titulo: string;
  pessoa: string | null;
  grupo: string | null;
  situacao: string | null;
  valor: number;
  href?: string;
};

export type Lancamentos = { qtd: number; total: number; linhas: Lancamento[]; erro?: string };

const SITUACAO_TITULO: Record<string, string> = { aberto: "em aberto", pago: "baixado", cancelado: "cancelado" };
const SITUACAO_NOTA: Record<number, string> = { 2: "emitida", 6: "autorizada", 7: "autorizada", 8: "autorizada" };

type Linha = Record<string, unknown>;
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v ?? 0) || 0;

function deTitulo(l: Linha): Lancamento {
  const venc = txt(l.vencimento);
  const pagar = l.tipo === "pagar";
  return {
    id: String(l.id),
    data: txt(l.data),
    titulo: [txt(l.descricao), txt(l.parcela)].filter(Boolean).join(" · ") || "(sem descrição)",
    pessoa: txt(l.pessoa),
    grupo: txt(l.categoria) ?? "sem categoria",
    situacao: `${SITUACAO_TITULO[String(l.situacao)] ?? l.situacao}${venc ? ` · vence ${formatarData(venc)}` : ""}`,
    valor: num(l.valor),
    href: venc
      ? `/financeiro/${pagar ? "pagar" : "receber"}?de=${venc}&ate=${venc}&por=vencimento&situacao=${pagar ? `&ver=${l.id}` : ""}`
      : undefined,
  };
}

function dePedido(l: Linha): Lancamento {
  const atraso = num(l.dias_atraso);
  return {
    id: String(l.id),
    data: txt(l.data),
    titulo: `Pedido ${txt(l.numero) ?? ""}${l.numero_externo ? ` (Tiny ${l.numero_externo})` : ""}`,
    pessoa: txt(l.cliente),
    grupo: txt(l.etapa),
    situacao: [l.saiu ? `saiu ${formatarData(String(l.saiu))}` : null, atraso ? `${atraso} d de atraso` : null].filter(Boolean).join(" · ") || null,
    valor: num(l.valor),
    href: `/vendas/pedidos/pedido?id=${l.id}`,
  };
}

function deCompra(l: Linha): Lancamento {
  return {
    id: String(l.id),
    data: txt(l.data),
    titulo: `Ordem de compra ${txt(l.numero) ?? ""}`,
    pessoa: txt(l.pessoa),
    grupo: txt(l.condicao_pagamento),
    situacao: txt(l.etapa),
    valor: num(l.valor),
    href: `/compras/pedidos/pedido?id=${l.id}`,
  };
}

function deNota(l: Linha): Lancamento {
  return {
    id: String(l.id),
    data: txt(l.data),
    titulo: `NF ${txt(l.numero) ?? ""}${l.serie ? `/${l.serie}` : ""}`,
    pessoa: txt(l.pessoa),
    grupo: l.tipo === "E" ? "entrada" : "saída",
    situacao: SITUACAO_NOTA[num(l.situacao)] ?? null,
    valor: num(l.valor),
  };
}

async function viaBanco(de: string, ate: string, empresa: string | null, filtro: Exclude<FiltroOrigem, { fonte: "folha" }>): Promise<Lancamentos> {
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.rpc("indicadores_origem", { de, ate, empresa, filtro });
  if (error) return { qtd: 0, total: 0, linhas: [], erro: error.message };
  const r = data as { qtd: number; total: number; linhas: Linha[] };
  const mapa = filtro.fonte === "titulos" ? deTitulo : filtro.fonte === "pedidos" ? dePedido : filtro.fonte === "compras" ? deCompra : deNota;
  return { qtd: Number(r.qtd), total: Number(r.total), linhas: r.linhas.map(mapa) };
}

// Folha: holerites (mensal: proventos + FGTS), VT/auxílio e ajuda de custo.
async function daFolha(origem: Origem, de: string, ate: string, empresa: string | null, partes: string[]): Promise<Lancamentos> {
  const supabase = criarClienteNavegador();
  const linhas: Lancamento[] = [];
  const erros: string[] = [];
  // Benefícios e ajuda só contam nos meses com holerite (mesma regra da tela).
  const meses = new Set(origem.composicao?.filter((c) => c.sub === "holerites").flatMap((c) => Object.keys(c.porMes)) ?? []);
  if (partes.includes("holerites")) {
    let q = supabase
      .from("holerites")
      .select("id, funcionario_id, competencia, total_proventos, fgts, cargo, funcionarios!inner(nome, setor, empresa_id)")
      .eq("tipo", "mensal")
      .gte("competencia", de)
      .lte("competencia", ate)
      .limit(2000);
    if (empresa) q = q.eq("funcionarios.empresa_id", empresa);
    const { data, error } = await q;
    if (error) erros.push(error.message);
    for (const h of (data ?? []) as unknown as Linha[]) {
      const f = h.funcionarios as { nome: string; setor: string | null };
      linhas.push({
        id: String(h.id),
        data: txt(h.competencia),
        titulo: `Holerite ${rotuloMes(String(h.competencia).slice(0, 7))}`,
        pessoa: f.nome,
        grupo: `Holerite · ${f.setor ?? "sem setor"}`,
        situacao: `proventos ${formatar(num(h.total_proventos), "moeda")} + FGTS ${formatar(num(h.fgts), "moeda")}`,
        valor: num(h.total_proventos) + num(h.fgts),
        href: `/rh/funcionarios/ficha?id=${h.funcionario_id}`,
      });
    }
  }
  const tipos = [partes.includes("vt") ? "vt" : null, partes.includes("va") ? "va" : null].filter(Boolean) as string[];
  if (tipos.length) {
    let q = supabase.from("beneficios_folha").select("id, competencia, tipo, nome, valor, observacao, funcionario_id").gte("competencia", de).lte("competencia", ate).limit(2000);
    if (empresa) q = q.eq("empresa_id", empresa);
    const { data, error } = await q;
    if (error) erros.push(error.message);
    for (const b of (data ?? []) as Linha[]) {
      const ehVt = b.tipo === "vt";
      if (!tipos.includes(ehVt ? "vt" : "va") || !meses.has(String(b.competencia).slice(0, 7))) continue;
      linhas.push({
        id: String(b.id),
        data: txt(b.competencia),
        titulo: `${ehVt ? "Vale-transporte" : "Auxílio-alimentação"} ${rotuloMes(String(b.competencia).slice(0, 7))}`,
        pessoa: txt(b.nome),
        grupo: ehVt ? "Vale-transporte" : "Auxílio-alimentação",
        situacao: txt(b.observacao),
        valor: num(b.valor),
        href: `/rh/funcionarios/beneficios?mes=${String(b.competencia).slice(0, 7)}`,
      });
    }
  }
  if (partes.includes("ajuda")) {
    const r = await viaBanco(de, ate, empresa, { fonte: "titulos", tipo: "pagar", ajuda: true });
    if (r.erro) erros.push(r.erro);
    linhas.push(...r.linhas.filter((l) => meses.has(String(l.data).slice(0, 7))).map((l) => ({ ...l, grupo: "Ajuda de custo" })));
  }
  linhas.sort((a, b) => b.valor - a.valor);
  return { qtd: linhas.length, total: linhas.reduce((s, l) => s + l.valor, 0), linhas, erro: erros.join(" · ") || undefined };
}

export async function carregarLancamentos(origem: Origem, de: string, ate: string, empresa: string | null): Promise<Lancamentos | null> {
  if (!origem.filtro) return null;
  if (!supabaseConfigurado) return { qtd: 0, total: 0, linhas: [] };
  const p = periodoDaOrigem(origem, de, ate);
  if (origem.filtro.fonte === "folha") return daFolha(origem, p.de, p.ate, empresa, origem.filtro.partes);
  return viaBanco(p.de, p.ate, empresa, origem.filtro);
}

export function PainelOrigem({
  origem,
  lancamentos,
  linkOrigem,
  linkSub,
  fechar,
}: {
  origem: Origem;
  lancamentos: Lancamentos | null;
  linkOrigem: (chave: string) => string;
  linkSub: (sub: string | undefined) => string;
  fechar: string;
}) {
  const meses = origem.meses;
  const sub = origem.sub;
  const divisor = origem.divisor || meses.length;
  const comp = origem.composicao?.filter((l) => meses.some((m) => l.porMes[m])) ?? [];
  const totalComp = totalDaComposicao(comp, meses);
  const subEscolhida = comp.find((l) => l.sub === sub);
  const moeda = (v: number | null) => formatar(v, "moeda");
  return (
    <section className="space-y-2 rounded-xl border border-primaria/30 bg-superficie p-3 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm">
            <span className="text-texto-suave">Origem do valor ·</span> <b>{origem.titulo}</b>
          </p>
          <p className="text-xs text-texto-suave">{origem.explicacao}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          {origem.abrirEm && (
            <Link href={origem.abrirEm.href} className="text-primaria hover:underline">
              {origem.abrirEm.rotulo}
            </Link>
          )}
          <Link href={fechar} scroll={false} className="inline-flex items-center gap-1 text-texto-suave hover:text-texto" aria-label="Fechar a origem">
            <X size={14} /> fechar
          </Link>
        </div>
      </div>

      {origem.calculo && (
        <table className="text-sm">
          <tbody>
            {origem.calculo.map((t, i) => (
              <tr key={i} className={t.sinal === "=" ? "font-semibold" : ""}>
                <td className="w-5 pr-2 text-right text-texto-suave">{t.sinal}</td>
                <td className="pr-6">
                  {t.origem ? (
                    <Link href={linkOrigem(t.origem)} className="text-primaria hover:underline">
                      {t.rotulo}
                    </Link>
                  ) : (
                    t.rotulo
                  )}
                </td>
                <td className="text-right tabular-nums">{formatar(t.valor, t.formato ?? "moeda")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {comp.length > 0 && (
        <Tabela
          embutida
          colunas={[
            "Composição",
            ...meses.map((m) => <span key={m} className="block text-right">{rotuloMes(m)}</span>),
            <span key="t" className="block text-right">Total</span>,
            ...(origem.media && meses.length > 1 ? [<span key="m" className="block text-right">Média/mês</span>] : []),
          ]}
        >
          {comp.map((l, i) => {
            const total = meses.reduce((s, m) => s + Number(l.porMes[m] ?? 0), 0);
            const ativa = sub !== undefined && l.sub === sub;
            return (
              <tr key={i} className={ativa ? "bg-primaria-suave" : ""}>
                <Celula className="whitespace-nowrap">
                  {l.sub && origem.filtro ? (
                    <Link href={linkSub(ativa ? undefined : l.sub)} scroll={false} className="hover:text-primaria hover:underline" title="Ver só os lançamentos desta linha">
                      {l.rotulo}
                    </Link>
                  ) : (
                    l.rotulo
                  )}{" "}
                  {l.grupo && <span className="text-xs text-texto-suave">{l.grupo}</span>}
                </Celula>
                {meses.map((m) => (
                  <Celula key={m} className="text-right tabular-nums">
                    {l.porMes[m] ? moeda(l.porMes[m]) : "—"}
                  </Celula>
                ))}
                <Celula className="text-right font-medium tabular-nums">{moeda(total)}</Celula>
                {origem.media && meses.length > 1 && <Celula className="text-right tabular-nums">{moeda(total / divisor)}</Celula>}
              </tr>
            );
          })}
          <tr className="font-semibold">
            <Celula>Total</Celula>
            {meses.map((m) => (
              <Celula key={m} className="text-right tabular-nums">
                {moeda(comp.reduce((s, l) => s + Number(l.porMes[m] ?? 0), 0))}
              </Celula>
            ))}
            <Celula className="text-right tabular-nums">{moeda(totalComp)}</Celula>
            {origem.media && meses.length > 1 && <Celula className="text-right tabular-nums">{moeda(totalComp / divisor)}</Celula>}
          </tr>
        </Tabela>
      )}

      {lancamentos && (
        <div className="space-y-1">
          <p className="text-xs text-texto-suave">
            <b className="text-texto">
              {lancamentos.qtd.toLocaleString("pt-BR")} lançamento(s) · {moeda(lancamentos.total)}
            </b>
            {subEscolhida && (
              <>
                {" "}
                só de <b>{subEscolhida.rotulo}</b> ·{" "}
                <Link href={linkSub(undefined)} scroll={false} className="text-primaria hover:underline">
                  ver todos
                </Link>
              </>
            )}
            {lancamentos.qtd > lancamentos.linhas.length && ` · mostrando os ${lancamentos.linhas.length.toLocaleString("pt-BR")} maiores`}
            {" · "}clique num lançamento para abrir o registro.
          </p>
          {lancamentos.erro && <p className="text-xs text-perigo">Não foi possível ler os lançamentos: {lancamentos.erro}</p>}
          <div className="max-h-[28rem] overflow-y-auto">
            <Tabela embutida colunas={["Data", "Lançamento", "Cliente / fornecedor / pessoa", "Grupo", "Situação", <span key="v" className="block text-right">Valor</span>]} vazio="Nenhum lançamento.">
              {lancamentos.linhas.map((l) => (
                <tr key={`${l.grupo}-${l.id}`}>
                  <Celula className="whitespace-nowrap tabular-nums">{l.data ? formatarData(l.data) : "—"}</Celula>
                  <Celula>
                    {l.href ? (
                      <Link href={l.href} className="hover:text-primaria hover:underline">
                        {l.titulo}
                      </Link>
                    ) : (
                      l.titulo
                    )}
                  </Celula>
                  <Celula className="text-texto-suave">{l.pessoa ?? "—"}</Celula>
                  <Celula className="text-xs text-texto-suave">{l.grupo ?? ""}</Celula>
                  <Celula className="text-xs text-texto-suave">{l.situacao ?? ""}</Celula>
                  <Celula className="text-right tabular-nums">{moeda(l.valor)}</Celula>
                </tr>
              ))}
            </Tabela>
          </div>
        </div>
      )}
    </section>
  );
}
