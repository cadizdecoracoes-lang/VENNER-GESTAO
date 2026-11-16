"use client";

import Link from "next/link";
import { CabecalhoTela, Celula, Fonte, Indicador, SemAcesso, Tabela } from "@/components/ui";
import { TelaCliente } from "@/components/tela-cliente";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil } from "@/lib/datas";
import { empresaSelecionada } from "@/lib/empresa";
import { somarMeses, ultimoDiaMes } from "@/lib/fluxo-caixa";
import { formatarData } from "@/lib/formato";
import {
  calcularPrazos,
  classificarCategorias,
  condicaoDaPessoa,
  diagnosticar,
  FAIXAS,
  media,
  mesesDaMedia,
  montarMeses,
  NOME_CLASSE,
  ondeEstaOProblema,
  pontoEquilibrio,
  porCanal,
  rotuloMes,
  vazio,
  type Categoria,
  type Classe,
  type DadosIndicadores,
  type AjudaCusto,
  type BeneficioMes,
  type FolhaMes,
  type LinhaMes,
  type TipoTitulo,
} from "@/lib/indicadores";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Barra, EtiquetaGravidade, formatar, SemDados, Secao, TabelaMeses } from "./pecas";
import { SimuladorFolha } from "./simulador";

const TELA = "estrategico.indicadores";
const FOLHA_META = 15000;

const ABAS = [
  { id: "diagnostico", nome: "Onde está o problema" },
  { id: "equilibrio", nome: "Ponto de equilíbrio" },
  { id: "financeiro", nome: "Financeiro" },
  { id: "vendas", nome: "Vendas" },
  { id: "producao", nome: "Produção" },
  { id: "compras", nome: "Compras" },
  { id: "folha", nome: "Folha × produtividade" },
  { id: "prazos", nome: "Prazos" },
  { id: "pessoas", nome: "Clientes e fornecedores" },
  { id: "ecommerce", nome: "E-commerce" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

const PERIODOS = [
  { id: "3", nome: "3 meses" },
  { id: "6", nome: "6 meses" },
  { id: "12", nome: "12 meses" },
  { id: "ano", nome: "Este ano" },
];

const AJUDA = (
  <>
    <p>
      Indicadores de todos os setores, montados só com o que o sistema recebe do Tiny (contas a pagar e a receber, pedidos de venda e a
      situação de cada um, ordens de compra, notas fiscais) e com os holerites importados no RH. Cada número diz de onde vem; os que
      abrem registros levam à tela de origem.
    </p>
    <p className="mt-2">
      <b>Previsto</b> é pelo vencimento do título; <b>realizado</b> é pela data da baixa. As médias usam só os meses já fechados do
      período. As categorias do Tiny são agrupadas pelo nome (a lista está na aba Financeiro).
    </p>
    <p className="mt-2">
      <b>Saída da fábrica</b>: pedidos pela data de faturamento do Tiny (ou, sem ela, o dia em que o pedido passou para expedição aqui).
      A tela se atualiza sozinha a cada mudança vinda do Tiny ou dos outros usuários.
    </p>
  </>
);

type Filtros = { aba?: string; periodo?: string; folha?: string };

function lerPeriodo(periodo: string | undefined, hoje: string) {
  const mesAtual = hoje.slice(0, 8) + "01";
  if (periodo === "ano") return { id: "ano", de: `${hoje.slice(0, 4)}-01-01`, ate: `${hoje.slice(0, 4)}-12-31` };
  const n = periodo === "3" || periodo === "12" ? Number(periodo) : 6;
  return { id: String(n), de: somarMeses(mesAtual, -(n - 1)), ate: ultimoDiaMes(mesAtual) };
}

async function carregar(de: string, ate: string, empresa: string | null, hoje: string) {
  if (!supabaseConfigurado)
    return { dados: vazio(hoje, de, ate), categorias: [] as Categoria[], folha: null, beneficios: [] as BeneficioMes[], ajuda: [] as AjudaCusto[] };
  const supabase = criarClienteNavegador();
  let folhaConsulta = supabase
    .from("folha_custo_mensal")
    .select("empresa_id, competencia, setor, funcionarios, custo")
    .gte("competencia", de)
    .lte("competencia", ate)
    .limit(5000);
  if (empresa) folhaConsulta = folhaConsulta.eq("empresa_id", empresa);
  let beneficiosConsulta = supabase
    .from("folha_beneficios_mensal")
    .select("empresa_id, competencia, tipo, setor, pessoas, valor")
    .gte("competencia", de)
    .lte("competencia", ate)
    .limit(5000);
  if (empresa) beneficiosConsulta = beneficiosConsulta.eq("empresa_id", empresa);
  const [dados, categorias, folha, beneficios, ajuda] = await Promise.all([
    supabase.rpc("indicadores_gestao", { de, ate, empresa }),
    supabase.from("plano_contas").select("id, codigo, nome, tipo, pai_id").limit(5000),
    folhaConsulta,
    beneficiosConsulta,
    supabase.rpc("indicadores_ajuda_custo", { de, ate, empresa }),
  ]);
  if (dados.error) throw new Error(dados.error.message);
  return {
    dados: dados.data as DadosIndicadores,
    categorias: (categorias.data ?? []) as Categoria[],
    // Sem a folha (pacote do RH ainda não publicado ou sem holerites): estrutura vazia.
    folha: folha.error ? null : ((folha.data ?? []) as FolhaMes[]).map((f) => ({ ...f, custo: Number(f.custo), funcionarios: Number(f.funcionarios) })),
    beneficios: ((beneficios.data ?? []) as BeneficioMes[]).map((b) => ({ ...b, valor: Number(b.valor), pessoas: Number(b.pessoas) })),
    ajuda: ((ajuda.data ?? []) as AjudaCusto[]).map((a) => ({ ...a, valor: Number(a.valor) })),
  };
}

async function PaginaIndicadores({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const filtros = await searchParams;
  const selecionada = await empresaSelecionada();
  const hoje = hojeBrasil();
  const periodo = lerPeriodo(filtros.periodo, hoje);
  const aba: Aba = ABAS.some((a) => a.id === filtros.aba) ? (filtros.aba as Aba) : "diagnostico";
  const folhaAlvo = /^\d+$/.test(filtros.folha ?? "") ? Number(filtros.folha) : FOLHA_META;

  const { dados, categorias, folha, beneficios, ajuda } = await carregar(periodo.de, periodo.ate, selecionada?.id ?? null, hoje);
  const classes = classificarCategorias(categorias);
  const linhas = montarMeses(dados, classes, folha && folha.length ? folha : null, { beneficios, ajuda });
  const mesesMedia = mesesDaMedia(
    linhas.map((l) => l.mes),
    hoje,
  );
  const pe = pontoEquilibrio(linhas, hoje, folhaAlvo);
  const prazos = calcularPrazos(dados);
  const diagnostico = diagnosticar({ dados, linhas, pe, prazos });
  const problema = ondeEstaOProblema(diagnostico);

  const link = (mudar: Partial<Filtros>) => {
    const q = new URLSearchParams();
    const tudo = { aba, periodo: periodo.id, folha: filtros.folha, ...mudar };
    for (const [k, v] of Object.entries(tudo)) if (v && !(k === "aba" && v === "diagnostico") && !(k === "periodo" && v === "6")) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : "?";
  };
  const textoPeriodo = `${formatarData(periodo.de)} a ${formatarData(periodo.ate)}`;
  const daEmpresa = selecionada ? `só ${selecionada.nome}` : "todas as empresas que você vê";
  const ctx = { dados, linhas, mesesMedia, pe, prazos, folha, beneficios, ajuda, classes, categorias, folhaAlvo, textoPeriodo, daEmpresa, periodo };

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} empresa={selecionada} ajuda={AJUDA}>
        <div className="flex items-center gap-1 text-[13px]">
          <span className="text-texto-suave">Período:</span>
          {PERIODOS.map((p) => (
            <Link
              key={p.id}
              href={link({ periodo: p.id })}
              scroll={false}
              className={`rounded-full px-2 py-0.5 ${periodo.id === p.id ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-superficie"}`}
            >
              {p.nome}
            </Link>
          ))}
        </div>
      </CabecalhoTela>

      <nav className="flex flex-wrap gap-1 border-b border-borda/70 pb-1 text-sm">
        {ABAS.map((a) => (
          <Link
            key={a.id}
            href={link({ aba: a.id })}
            scroll={false}
            className={`rounded-lg px-2.5 py-1 ${aba === a.id ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-superficie hover:text-texto"}`}
          >
            {a.nome}
          </Link>
        ))}
      </nav>

      {aba === "diagnostico" && <Diagnostico {...ctx} diagnostico={diagnostico} problema={problema} link={link} />}
      {aba === "equilibrio" && <Equilibrio {...ctx} />}
      {aba === "financeiro" && <Financeiro {...ctx} />}
      {aba === "vendas" && <Vendas {...ctx} />}
      {aba === "producao" && <Producao {...ctx} />}
      {aba === "compras" && <Compras {...ctx} />}
      {aba === "folha" && <Folha {...ctx} />}
      {aba === "prazos" && <Prazos {...ctx} />}
      {aba === "pessoas" && <Pessoas {...ctx} />}
      {aba === "ecommerce" && <Ecommerce {...ctx} />}
    </div>
  );
}

type Ctx = {
  dados: DadosIndicadores;
  linhas: LinhaMes[];
  mesesMedia: string[];
  pe: ReturnType<typeof pontoEquilibrio>;
  prazos: ReturnType<typeof calcularPrazos>;
  folha: FolhaMes[] | null;
  beneficios: BeneficioMes[];
  ajuda: AjudaCusto[];
  classes: Map<string, Classe>;
  categorias: Categoria[];
  folhaAlvo: number;
  textoPeriodo: string;
  daEmpresa: string;
  periodo: { id: string; de: string; ate: string };
};

const m$ = (v: number | null | undefined) => formatar(v ?? null, "moeda");
const baseMedia = (c: Ctx) => c.linhas.filter((l) => c.mesesMedia.includes(l.mes));
const mediaDe = (c: Ctx, f: (l: LinhaMes) => number | null) => media(baseMedia(c), f);
const somaQtd = <T,>(l: T[], f: (x: T) => number) => l.reduce((s, x) => s + Number(f(x) || 0), 0);

// ---------------------------------------------------------------------------
// Onde está o problema
// ---------------------------------------------------------------------------
function Diagnostico(
  c: Ctx & { diagnostico: ReturnType<typeof diagnosticar>; problema: ReturnType<typeof ondeEstaOProblema>; link: (m: Partial<Filtros>) => string },
) {
  const { pe } = c;
  const naFabrica = c.dados.pedidos_etapa.filter((e) => e.fase === "producao");
  const entrada = mediaDe(c, (l) => l.entradaPedidos);
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-superficie px-3 py-2 text-sm shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        {c.problema.area ? (
          <>
            <b>Onde está o problema: {c.problema.area}.</b>{" "}
            <span className="text-texto-suave">
              {c.problema.criticos} ponto(s) crítico(s) no período ({c.textoPeriodo}), do mais grave para o menos grave abaixo.
            </span>
          </>
        ) : (
          <span className="text-texto-suave">Nenhum ponto crítico com os dados do período ({c.textoPeriodo}).</span>
        )}
      </p>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Indicador
          rotulo="Receita média/mês"
          valor={m$(pe.receita)}
          detalhe={pe.baseReceita === "notas" ? "pelas NFs" : undefined}
          href={c.link({ aba: "financeiro" })}
          fonte={`Contas a receber (categorias de receita) pelo vencimento, média de ${pe.meses} mês(es) fechado(s) · ${c.daEmpresa}.`}
        />
        <Indicador
          rotulo="Resultado médio/mês"
          valor={m$(mediaDe(c, (l) => l.resultado))}
          cor={(mediaDe(c, (l) => l.resultado) ?? 0) < 0 ? "text-perigo" : "text-sucesso"}
          href={c.link({ aba: "financeiro" })}
          fonte="Receita − custos variáveis − despesas fixas (sem investimentos e transferências), pelo vencimento."
        />
        <Indicador
          rotulo={`Ponto de equilíbrio (folha ${m$(c.folhaAlvo)})`}
          valor={pe.pontoAlvo !== null ? m$(pe.pontoAlvo) : "—"}
          detalhe={pe.falta ? `faltam ${m$(pe.falta)}/mês` : pe.pontoAlvo !== null ? "receita atual já cobre" : "sem margem"}
          cor={pe.falta ? "text-perigo" : ""}
          href={c.link({ aba: "equilibrio" })}
          fonte="Despesas fixas com a folha da meta ÷ margem de contribuição."
        />
        <Indicador
          rotulo="Saída da fábrica × entrada"
          valor={pe.saidaAtual && entrada ? formatar(pe.saidaAtual / entrada, "pct") : "—"}
          detalhe={`${m$(pe.saidaAtual)} de ${m$(entrada)}/mês`}
          cor={pe.saidaAtual && entrada && pe.saidaAtual / entrada < 0.95 ? "text-perigo" : ""}
          href={c.link({ aba: "producao" })}
          fonte="Pedidos que saíram da fábrica (faturados) ÷ pedidos que entraram, média mensal."
        />
        <Indicador
          rotulo="Fila na fábrica"
          valor={m$(somaQtd(naFabrica, (e) => e.valor))}
          detalhe={`${somaQtd(naFabrica, (e) => e.qtd)} pedidos`}
          href="/vendas/pedidos"
          fonte="Pedidos aprovados no Tiny que ainda não foram faturados (fase produção), hoje."
        />
      </div>

      <Tabela colunas={["", "Área", "O que os números mostram", ""]} vazio="Sem dados no período.">
        {c.diagnostico.map((p, i) => (
          <tr key={i}>
            <Celula className="w-0">
              <EtiquetaGravidade gravidade={p.gravidade} />
            </Celula>
            <Celula className="w-0 whitespace-nowrap text-texto-suave">{p.area}</Celula>
            <Celula>
              <span className="font-medium">{p.titulo}.</span> <span className="text-texto-suave">{p.texto}</span>
            </Celula>
            <Celula className="w-0 whitespace-nowrap">
              <Link href={c.link({ aba: p.aba })} scroll={false} className="text-xs text-primaria hover:underline">
                detalhes
              </Link>
            </Celula>
          </tr>
        ))}
      </Tabela>
      <Fonte>
        Fonte: contas a pagar e a receber, pedidos de venda (situação do Tiny), ordens de compra, notas fiscais do Tiny e holerites · {c.daEmpresa} ·{" "}
        {c.textoPeriodo}. Médias pelos meses fechados.
      </Fonte>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ponto de equilíbrio
// ---------------------------------------------------------------------------
function Equilibrio(c: Ctx) {
  const { pe } = c;
  const linha = (rotulo: string, atual: React.ReactNode, alvo: React.ReactNode, dica?: string, total?: boolean) => (
    <tr className={total ? "font-semibold" : ""}>
      <Celula>
        <span title={dica}>{rotulo}</span>
      </Celula>
      <Celula className="text-right tabular-nums">{atual}</Celula>
      <Celula className="text-right tabular-nums">{alvo}</Celula>
    </tr>
  );
  const pct = (v: number | null) => formatar(v, "pct");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SimuladorFolha valor={c.folhaAlvo} />
        <span className="text-xs text-texto-suave">Média de {pe.meses} mês(es) fechado(s) · {c.daEmpresa}</span>
      </div>
      {pe.receita === 0 && <SemDados>Sem receitas no período: o ponto de equilíbrio precisa de contas a receber ou notas de saída.</SemDados>}
      {pe.origemFolha !== "holerites" && (
        <SemDados>
          Folha atual tirada do contas a pagar (categorias de salários e encargos). Com os holerites importados em RH › Funcionários, ela passa a
          vir dos holerites.
        </SemDados>
      )}
      <Tabela colunas={["Por mês", "Hoje", `Com folha de ${m$(c.folhaAlvo)}`]}>
        {linha("Receita média", m$(pe.receita), m$(pe.receita), pe.baseReceita === "notas" ? "Pelas notas de saída do Tiny." : "Contas a receber pelo vencimento.")}
        {linha("(−) Custos variáveis", m$(pe.variaveis), m$(pe.variaveis), "Impostos sobre venda, matéria-prima e embalagens, comissões e fretes.")}
        {linha("Margem de contribuição", pct(pe.margem), pct(pe.margem), "(Receita − variáveis) ÷ receita: quanto sobra de cada R$ 1 vendido para pagar os fixos.", true)}
        {linha("Despesas fixas sem folha", m$(pe.fixasSemFolha), m$(pe.fixasSemFolha), "Aluguel, energia, administrativo, serviços, juros e tarifas.")}
        {linha("Folha", m$(pe.folhaAtual), m$(pe.folhaAlvo), pe.origemFolha === "holerites" ? "Holerites (proventos + FGTS)." : "Contas a pagar de salários e encargos.")}
        {linha("Total de fixos", m$(pe.fixasSemFolha + pe.folhaAtual), m$(pe.fixasSemFolha + pe.folhaAlvo), undefined, true)}
        {linha(
          "Ponto de equilíbrio (faturamento mínimo)",
          pe.pontoAtual !== null ? m$(pe.pontoAtual) : "sem margem",
          pe.pontoAlvo !== null ? m$(pe.pontoAlvo) : "sem margem",
          "Fixos ÷ margem de contribuição.",
          true,
        )}
        {linha(
          "Falta faturar por mês",
          pe.pontoAtual !== null ? m$(Math.max(0, pe.pontoAtual - pe.receita)) : "—",
          pe.falta !== null ? m$(pe.falta) : "—",
        )}
        {linha(
          "Pedidos por mês necessários",
          pe.pontoAtual !== null && pe.ticketMedio ? formatar(pe.pontoAtual / pe.ticketMedio, "numero") : "—",
          pe.pedidosNecessarios !== null ? formatar(pe.pedidosNecessarios, "numero") : "—",
          `Pelo pedido médio do período (${m$(pe.ticketMedio)}).`,
        )}
        {linha(
          "Produção necessária × saída atual",
          pe.pontoAtual !== null && pe.saidaAtual ? pct(pe.pontoAtual / pe.saidaAtual) : "—",
          pe.pontoAlvo !== null && pe.saidaAtual ? pct(pe.pontoAlvo / pe.saidaAtual) : "—",
          `A fábrica entrega hoje ${m$(pe.saidaAtual)} por mês. Acima de 100% = precisa produzir mais do que produz.`,
          true,
        )}
      </Tabela>
      <Fonte>
        Ponto de equilíbrio = despesas fixas ÷ margem de contribuição. Reduzir a folha baixa o ponto, mas a produção só chega lá se a
        fábrica entregar o volume da última linha: confira na aba Folha × produtividade quanto cada funcionário de produção entrega hoje.
      </Fonte>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Financeiro: despesas + custos × receita
// ---------------------------------------------------------------------------
function Financeiro(c: Ctx) {
  const cl = (k: Classe) => (l: LinhaMes) => l.porClasse[k];
  const usadas = new Set(c.dados.titulos_mes.map((t) => t.categoria_id).filter(Boolean));
  const semCategoria = somaQtd(c.linhas, (l) => l.semCategoria);
  const porClasse = new Map<Classe, Categoria[]>();
  for (const cat of c.categorias.filter((x) => usadas.has(x.id))) {
    const k = c.classes.get(cat.id) ?? "fixa";
    porClasse.set(k, [...(porClasse.get(k) ?? []), cat]);
  }
  const pagar = (m: LinhaMes) => `/financeiro/pagar?de=${m.mes}-01&ate=${ultimoDiaMes(m.mes + "-01")}&por=vencimento&situacao=`;
  const receber = (m: LinhaMes) => `/financeiro/receber?de=${m.mes}-01&ate=${ultimoDiaMes(m.mes + "-01")}&por=vencimento&situacao=`;
  return (
    <div className="space-y-3">
      <Secao titulo="Despesas + custos × receita (pelo vencimento)">
        <TabelaMeses
          meses={c.linhas}
          mesesMedia={c.mesesMedia}
          linhas={[
            { rotulo: "Receita", valor: (l) => l.receita, estilo: "total", href: receber },
            { rotulo: "(−) Impostos e deduções", valor: cl("deducao"), estilo: "sub" },
            { rotulo: "(−) Matéria-prima e embalagens", valor: cl("materia_prima"), estilo: "sub" },
            { rotulo: "(−) Comissões e fretes", valor: cl("variavel"), estilo: "sub" },
            { rotulo: "= Margem de contribuição", valor: (l) => l.receita - l.variaveis, estilo: "total", negativoRuim: true },
            { rotulo: "Margem %", valor: (l) => (l.receita ? (l.receita - l.variaveis) / l.receita : null), formato: "pct", estilo: "sub" },
            { rotulo: "(−) Folha", valor: cl("folha"), estilo: "sub", dica: "Salários, encargos e benefícios lançados no contas a pagar." },
            { rotulo: "(−) Despesas fixas", valor: cl("fixa"), estilo: "sub", dica: "Inclui contas a pagar sem categoria." },
            { rotulo: "(−) Juros e tarifas", valor: cl("financeiro"), estilo: "sub" },
            { rotulo: "= Resultado", valor: (l) => l.resultado, estilo: "total", negativoRuim: true },
            { rotulo: "Despesas + custos ÷ receita", valor: (l) => (l.receita ? (l.variaveis + l.fixas) / l.receita : null), formato: "pct" },
            { rotulo: "Investimentos (fora do resultado)", valor: cl("investimento"), estilo: "sub" },
            { rotulo: "Total a pagar", valor: (l) => l.variaveis + l.fixas + l.porClasse.investimento, estilo: "sub", href: pagar },
            "separador",
            { rotulo: "Recebido (caixa)", valor: (l) => l.recebido },
            { rotulo: "Pago (caixa)", valor: (l) => l.pago },
            { rotulo: "Saldo do caixa no mês", valor: (l) => l.recebido - l.pago, estilo: "total", negativoRuim: true },
          ]}
        />
        {semCategoria > 0 && <SemDados>{m$(semCategoria)} do contas a pagar no período estão sem categoria no Tiny e entram como despesa fixa.</SemDados>}
      </Secao>

      <Secao titulo="Em aberto hoje, por vencimento">
        <Tabela colunas={["", "A receber", "A pagar", "Diferença"]}>
          {FAIXAS.map((f) => {
            const v = (t: TipoTitulo) => c.dados.aberto.find((a) => a.tipo === t && a.faixa === f.faixa);
            const r = Number(v("receber")?.valor ?? 0);
            const p = Number(v("pagar")?.valor ?? 0);
            return (
              <tr key={f.faixa}>
                <Celula className={f.vencido ? "text-perigo" : ""}>{f.rotulo}</Celula>
                <Celula className="text-right tabular-nums">
                  {m$(r)} <span className="text-xs text-texto-suave">{v("receber")?.qtd ?? 0}</span>
                </Celula>
                <Celula className="text-right tabular-nums">
                  {m$(p)} <span className="text-xs text-texto-suave">{v("pagar")?.qtd ?? 0}</span>
                </Celula>
                <Celula className={`text-right tabular-nums ${r - p < 0 ? "text-perigo" : ""}`}>{m$(r - p)}</Celula>
              </tr>
            );
          })}
        </Tabela>
      </Secao>

      <details className="rounded-xl bg-superficie px-3 py-2 text-sm shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <summary className="cursor-pointer text-texto-suave">Como as categorias do Tiny foram agrupadas ({usadas.size} usadas no período)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...porClasse.entries()].map(([k, lista]) => (
            <div key={k}>
              <p className="text-xs font-medium">{NOME_CLASSE[k]}</p>
              <p className="text-xs text-texto-suave">{lista.map((x) => x.nome).join(", ")}</p>
            </div>
          ))}
        </div>
      </details>
      <Fonte>
        Fonte: contas a pagar e a receber (vindas do Tiny), sem cancelados · {c.daEmpresa} · {c.textoPeriodo}. Previsto pelo vencimento; caixa
        pela data da baixa.
      </Fonte>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------------
function Vendas(c: Ctx) {
  const canais = porCanal(c.dados);
  return (
    <div className="space-y-3">
      <TabelaMeses
        meses={c.linhas}
        mesesMedia={c.mesesMedia}
        linhas={[
          { rotulo: "Pedidos novos (R$)", valor: (l) => l.entradaPedidos, estilo: "total" },
          { rotulo: "Pedidos novos (quantidade)", valor: (l) => l.entradaPedidosQtd, formato: "numero", estilo: "sub" },
          { rotulo: "Pedido médio", valor: (l) => (l.entradaPedidosQtd ? l.entradaPedidos / l.entradaPedidosQtd : null), estilo: "sub" },
          { rotulo: "Faturado (NF de saída do Tiny)", valor: (l) => l.faturado },
          { rotulo: "Receita no contas a receber", valor: (l) => l.receita },
          { rotulo: "Recebido (caixa)", valor: (l) => l.recebido },
          {
            rotulo: "Crescimento dos pedidos sobre o mês anterior",
            valor: (l) => {
              const i = c.linhas.indexOf(l);
              const ant = i > 0 ? c.linhas[i - 1].entradaPedidos : 0;
              return ant ? l.entradaPedidos / ant - 1 : null;
            },
            formato: "pct",
            negativoRuim: true,
          },
        ]}
      />
      <Secao titulo="Por canal">
        <Tabela colunas={["Canal", "Pedidos", "Vendido", "Pedido médio", "% do total"]}>
          {canais
            .filter((x) => x.temDados || x.canal === "venda_direta")
            .map((x) => {
              const total = somaQtd(canais, (k) => k.vendido);
              return (
                <tr key={x.canal}>
                  <Celula>{x.nome}</Celula>
                  <Celula className="text-right tabular-nums">{formatar(x.pedidos, "numero")}</Celula>
                  <Celula className="text-right tabular-nums">{m$(x.vendido)}</Celula>
                  <Celula className="text-right tabular-nums">{m$(x.ticket)}</Celula>
                  <Celula className="text-right tabular-nums">{total ? formatar(x.vendido / total, "pct") : "—"}</Celula>
                </tr>
              );
            })}
        </Tabela>
        {!canais.some((x) => x.canal !== "venda_direta" && x.temDados) && (
          <SemDados>Vendas do e-commerce ainda não chegam ao sistema: veja a estrutura pronta na aba E-commerce.</SemDados>
        )}
      </Secao>
      <Fonte>
        Fonte: pedidos de venda do Tiny pela data do pedido (sem cancelados), notas fiscais de saída do Tiny pela emissão e contas a receber ·{" "}
        {c.daEmpresa} · {c.textoPeriodo}.
      </Fonte>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Produção (situação dos pedidos no Tiny)
// ---------------------------------------------------------------------------
function Producao(c: Ctx) {
  const etapas = c.dados.pedidos_etapa;
  const maior = Math.max(1, ...etapas.map((e) => Number(e.valor)));
  let fila = 0;
  return (
    <div className="space-y-3">
      <Secao titulo="Pedidos em andamento hoje, por situação do Tiny">
        <Tabela colunas={["Situação", "Pedidos", "Valor", "", "Dias nesta situação", "Idade média", "Mais antigo", "Atrasados", "Valor atrasado"]} vazio="Nenhum pedido em andamento.">
          {etapas.map((e) => (
            <tr key={e.etapa_id}>
              <Celula>
                <Link href={`/vendas/pedidos?etapa=${e.etapa_id}`} className="hover:text-primaria hover:underline">
                  {e.nome}
                </Link>{" "}
                <span className="text-xs text-texto-suave">{e.fase === "negociacao" ? "negociação" : e.fase === "producao" ? "fábrica" : "expedição"}</span>
              </Celula>
              <Celula className="text-right tabular-nums">{e.qtd}</Celula>
              <Celula className="text-right tabular-nums">{m$(e.valor)}</Celula>
              <Celula>
                <Barra fracao={Number(e.valor) / maior} cor={e.fase === "producao" ? "bg-alerta" : "bg-primaria"} />
              </Celula>
              <Celula className="text-right tabular-nums">{formatar(e.dias_na_etapa, "dias")}</Celula>
              <Celula className="text-right tabular-nums">{formatar(e.idade_media, "dias")}</Celula>
              <Celula className="text-right tabular-nums">{formatar(e.idade_maxima, "dias")}</Celula>
              <Celula className={`text-right tabular-nums ${e.atrasados ? "text-perigo" : ""}`}>{e.atrasados}</Celula>
              <Celula className="text-right tabular-nums">{m$(e.valor_atrasado)}</Celula>
            </tr>
          ))}
        </Tabela>
      </Secao>
      <Secao titulo="Entrada × saída da fábrica por mês">
        <TabelaMeses
          meses={c.linhas}
          mesesMedia={c.mesesMedia}
          linhas={[
            { rotulo: "Entraram (pedidos novos)", valor: (l) => l.entradaPedidos },
            { rotulo: "Saíram da fábrica (faturados)", valor: (l) => l.saidaPedidos, estilo: "total" },
            { rotulo: "Saíram (quantidade)", valor: (l) => l.saidaPedidosQtd, formato: "numero", estilo: "sub" },
            { rotulo: "Saída ÷ entrada", valor: (l) => (l.entradaPedidos ? l.saidaPedidos / l.entradaPedidos : null), formato: "pct" },
            { rotulo: "Fila acumulada no período", valor: (l) => (fila += l.entradaPedidos - l.saidaPedidos), negativoRuim: false, dica: "Entradas − saídas desde o início do período." },
            {
              rotulo: "Tempo médio do pedido até sair",
              valor: (l) => {
                const lista = c.dados.pedidos_mes.filter((p) => p.mes === l.mes);
                const q = somaQtd(lista, (p) => p.saida_qtd);
                return q ? somaQtd(lista, (p) => p.ciclo_dias) / q : null;
              },
              formato: "dias",
            },
            { rotulo: "NF de saída do Tiny", valor: (l) => l.faturado, estilo: "sub" },
          ]}
        />
      </Secao>
      <Fonte>
        Situação = situação do pedido no Tiny (Aprovado = fila da fábrica; Preparando envio = embalagem; Faturado/Pronto = expedição). Saída da
        fábrica pela data de faturamento do Tiny ou, sem ela, o dia em que o pedido passou para expedição aqui · {c.daEmpresa} · {c.textoPeriodo}.
      </Fonte>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compras × receita
// ---------------------------------------------------------------------------
function Compras(c: Ctx) {
  return (
    <div className="space-y-3">
      <TabelaMeses
        meses={c.linhas}
        mesesMedia={c.mesesMedia}
        linhas={[
          { rotulo: "Ordens de compra (Tiny)", valor: (l) => l.comprasPedidos },
          { rotulo: "NF de entrada (Tiny)", valor: (l) => l.comprasNf },
          { rotulo: "Matéria-prima no contas a pagar", valor: (l) => l.porClasse.materia_prima },
          { rotulo: "Receita", valor: (l) => l.receita, estilo: "total" },
          { rotulo: "Compras ÷ receita", valor: (l) => (l.receita ? Math.max(l.comprasPedidos, l.comprasNf, l.porClasse.materia_prima) / l.receita : null), formato: "pct", estilo: "total", dica: "Maior entre ordens de compra, NF de entrada e matéria-prima no contas a pagar." },
          { rotulo: "Compras ÷ saída da fábrica", valor: (l) => (l.saidaPedidos ? Math.max(l.comprasPedidos, l.comprasNf, l.porClasse.materia_prima) / l.saidaPedidos : null), formato: "pct" },
        ]}
      />
      <Fonte>
        Fonte: ordens de compra do Tiny pela data (sem canceladas), notas de entrada do Tiny pela emissão e contas a pagar de matéria-prima pelo
        vencimento · {c.daEmpresa} · {c.textoPeriodo}. Compras acima do que a fábrica entrega viram estoque parado.
      </Fonte>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folha × produtividade (holerites + VT + auxílio + ajuda de custo)
// ---------------------------------------------------------------------------
const SETORES_FOLHA: [string, string][] = [
  ["producao", "Produção"],
  ["logistica", "Logística"],
  ["comercial", "Comercial"],
  ["administrativo", "Administrativo"],
  ["sem_setor", "Sem setor"],
];

function Folha(c: Ctx) {
  const temFolha = c.linhas.some((l) => l.folhaHolerite !== null);
  const saida = (l: LinhaMes) => (l.saidaPedidos > 0 ? l.saidaPedidos : l.faturado);
  const custo = (l: LinhaMes) => l.folhaTotal;
  // Último mês com holerite: base do quadro por setor e do simulador.
  const ultimo = [...c.linhas].reverse().find((l) => l.folhaHolerite !== null);
  const doMes = (lista: { competencia: string }[]) => lista.filter((x) => ultimo && x.competencia.slice(0, 7) === ultimo.mes);
  const folhaMes = c.folha ? (doMes(c.folha) as FolhaMes[]) : [];
  const benMes = doMes(c.beneficios) as BeneficioMes[];
  const setores = SETORES_FOLHA.map(([id, nome]) => {
    const h = folhaMes.filter((f) => f.setor === id);
    const b = benMes.filter((x) => x.setor === id);
    const pessoas = somaQtd(h, (x) => x.funcionarios);
    const valor = somaQtd(h, (x) => x.custo) + somaQtd(b, (x) => x.valor);
    return { id, nome, pessoas, valor, porPessoa: pessoas ? valor / pessoas : null };
  }).filter((x) => x.valor > 0 || x.pessoas > 0);
  const ajudaMes = ultimo ? c.ajuda.filter((a) => a.mes === ultimo.mes) : [];
  const totalSetores = somaQtd(setores, (x) => x.valor) + somaQtd(ajudaMes, (a) => a.valor);
  const pessoasTotal = somaQtd(setores, (x) => x.pessoas);
  const custoMedio = pessoasTotal ? totalSetores / pessoasTotal : null;
  const corte = totalSetores - c.folhaAlvo;
  const cabem = custoMedio ? Math.floor(c.folhaAlvo / custoMedio) : null;
  const producao = setores.find((x) => x.id === "producao");
  const saidaMedia = c.pe.saidaAtual;
  // Mantendo a proporção de produção, quantas pessoas de produção cabem na meta.
  const pessoasProducaoMeta = producao && producao.porPessoa && totalSetores ? Math.floor((c.folhaAlvo * (producao.valor / totalSetores)) / producao.porPessoa) : null;
  const ajudaPessoas = [...new Set(c.ajuda.map((a) => a.pessoa))];
  return (
    <div className="space-y-3">
      {!temFolha && (
        <SemDados>
          Nenhum holerite no período (RH › Funcionários › Importar holerites). Enquanto isso, a folha vem do contas a pagar, na linha própria.
        </SemDados>
      )}
      <TabelaMeses
        meses={c.linhas}
        mesesMedia={c.mesesMedia}
        linhas={[
          { rotulo: "Holerites (proventos + FGTS)", valor: (l) => l.folhaHolerite, estilo: "sub" },
          { rotulo: "Vale-transporte (fora do holerite)", valor: (l) => l.vt, estilo: "sub", href: (l) => `/rh/funcionarios/beneficios?mes=${l.mes}` },
          { rotulo: "Auxílio-alimentação", valor: (l) => l.va, estilo: "sub", href: (l) => `/rh/funcionarios/beneficios?mes=${l.mes}` },
          { rotulo: "Ajuda de custo (contas a pagar)", valor: (l) => l.ajudaCusto || null, estilo: "sub" },
          { rotulo: "= Custo total da folha", valor: custo, estilo: "total", dica: "Holerites + VT + auxílio + ajuda de custo. Sem holerite no mês: a folha lançada no contas a pagar." },
          { rotulo: "Folha da produção", valor: (l) => l.folhaProducao, estilo: "sub", dica: "Holerites e benefícios de quem está no setor Produção." },
          { rotulo: "Folha no contas a pagar (conferência)", valor: (l) => l.porClasse.folha, estilo: "sub" },
          { rotulo: "Funcionários", valor: (l) => l.funcionarios, formato: "numero" },
          { rotulo: "Funcionários da produção", valor: (l) => l.funcionariosProducao, formato: "numero", estilo: "sub" },
          { rotulo: "Custo médio por funcionário", valor: (l) => (l.funcionarios && l.folhaTotal ? l.folhaTotal / l.funcionarios : null) },
          "separador",
          { rotulo: "Saída da fábrica (R$)", valor: saida },
          { rotulo: "Saída por funcionário da produção", valor: (l) => (l.funcionariosProducao ? saida(l) / l.funcionariosProducao : null), estilo: "total" },
          { rotulo: "Saída por funcionário (todos)", valor: (l) => (l.funcionarios ? saida(l) / l.funcionarios : null) },
          { rotulo: "R$ produzido por R$ 1 de folha", valor: (l) => (l.folhaTotal ? saida(l) / l.folhaTotal : null), formato: "vezes", estilo: "total" },
          { rotulo: "Folha ÷ receita", valor: (l) => (l.folhaTotal && l.receita ? l.folhaTotal / l.receita : null), formato: "pct" },
        ]}
      />

      {ultimo && setores.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Secao titulo={`Por setor em ${rotuloMes(ultimo.mes)}`}>
            <Tabela colunas={["Setor", "Pessoas", "Custo", "Por pessoa", "% da folha"]}>
              {setores.map((x) => (
                <tr key={x.id}>
                  <Celula>{x.nome}</Celula>
                  <Celula className="text-right tabular-nums">{x.pessoas || "—"}</Celula>
                  <Celula className="text-right tabular-nums">{m$(x.valor)}</Celula>
                  <Celula className="text-right tabular-nums">{m$(x.porPessoa)}</Celula>
                  <Celula className="text-right tabular-nums">
                    <Barra fracao={totalSetores ? x.valor / totalSetores : 0} /> {totalSetores ? formatar(x.valor / totalSetores, "pct") : ""}
                  </Celula>
                </tr>
              ))}
              {ajudaMes.length > 0 && (
                <tr>
                  <Celula>Ajuda de custo</Celula>
                  <Celula className="text-right tabular-nums">{new Set(ajudaMes.map((a) => a.pessoa)).size}</Celula>
                  <Celula className="text-right tabular-nums">{m$(somaQtd(ajudaMes, (a) => a.valor))}</Celula>
                  <Celula />
                  <Celula className="text-right tabular-nums">{totalSetores ? formatar(somaQtd(ajudaMes, (a) => a.valor) / totalSetores, "pct") : ""}</Celula>
                </tr>
              )}
            </Tabela>
          </Secao>
          <Secao titulo="Simulador de redução da folha">
            <div className="space-y-2 rounded-xl bg-superficie p-3 text-sm shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
              <SimuladorFolha valor={c.folhaAlvo} />
              <table className="w-full">
                <tbody className="divide-y divide-borda/70">
                  <tr>
                    <td className="py-1">Folha completa em {rotuloMes(ultimo.mes)}</td>
                    <td className="py-1 text-right tabular-nums">{m$(totalSetores)}</td>
                  </tr>
                  <tr>
                    <td className="py-1">Corte necessário por mês</td>
                    <td className={`py-1 text-right font-semibold tabular-nums ${corte > 0 ? "text-perigo" : ""}`}>
                      {corte > 0 ? `${m$(corte)} (${formatar(corte / totalSetores, "pct")})` : "já dentro da meta"}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Pessoas que cabem na meta, ao custo médio de {m$(custoMedio)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {cabem ?? "—"} de {pessoasTotal}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Delas na produção, mantendo a proporção de hoje</td>
                    <td className="py-1 text-right tabular-nums">
                      {pessoasProducaoMeta ?? "—"} de {producao?.pessoas ?? 0}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Saída por pessoa da produção para manter a fábrica de hoje</td>
                    <td className="py-1 text-right tabular-nums">
                      {saidaMedia && pessoasProducaoMeta ? m$(saidaMedia / pessoasProducaoMeta) : "—"}
                      {saidaMedia && producao?.pessoas ? <span className="text-xs text-texto-suave"> (hoje {m$(saidaMedia / producao.pessoas)})</span> : null}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Para chegar ao ponto de equilíbrio com essa folha</td>
                    <td className="py-1 text-right tabular-nums">
                      {c.pe.pontoAlvo !== null && pessoasProducaoMeta ? `${m$(c.pe.pontoAlvo / pessoasProducaoMeta)} por pessoa` : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-texto-suave">
                Simulação simples: custo médio de hoje por pessoa e a mesma divisão entre setores. Mostra quanto cada pessoa da produção precisaria
                entregar com a equipe reduzida.
              </p>
            </div>
          </Secao>
        </div>
      )}

      {ajudaPessoas.length > 0 && (
        <Secao titulo={`Ajuda de custo no contas a pagar (${ajudaPessoas.length} ${ajudaPessoas.length === 1 ? "pessoa" : "pessoas"})`}>
          <Tabela colunas={["Pessoa", "Categoria no Tiny", ...c.linhas.map((l) => rotuloMes(l.mes))]}>
            {ajudaPessoas.map((p) => (
              <tr key={p}>
                <Celula>{p}</Celula>
                <Celula className="text-xs text-texto-suave">{c.ajuda.find((a) => a.pessoa === p)?.categoria ?? "sem categoria"}</Celula>
                {c.linhas.map((l) => {
                  const v = somaQtd(
                    c.ajuda.filter((a) => a.pessoa === p && a.mes === l.mes),
                    (a) => a.valor,
                  );
                  return (
                    <Celula key={l.mes} className="text-right tabular-nums">
                      {v ? m$(v) : "—"}
                    </Celula>
                  );
                })}
              </tr>
            ))}
          </Tabela>
        </Secao>
      )}
      <Fonte>
        Fonte: holerites importados, VT e auxílio-alimentação (RH › Funcionários › VT e alimentação), contas a pagar com &quot;ajuda de custo&quot; na
        descrição ou na categoria, e pedidos que saíram da fábrica (ou NF de saída) · {c.daEmpresa} · {c.textoPeriodo}. Sem INSS da empresa. Com
        um CNPJ escolhido no topo, só a folha desse CNPJ entra; a empregadora dos holerites é a ASHI, por isso compare no consolidado.
      </Fonte>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prazos
// ---------------------------------------------------------------------------
function Prazos(c: Ctx) {
  const { receber, pagar, ciclo } = c.prazos;
  const linha = (rotulo: string, r: React.ReactNode, p: React.ReactNode, dica: string) => (
    <tr>
      <Celula>
        <span title={dica}>{rotulo}</span>
      </Celula>
      <Celula className="text-right tabular-nums">{r}</Celula>
      <Celula className="text-right tabular-nums">{p}</Celula>
    </tr>
  );
  const d = (v: number | null) => formatar(v, "dias");
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Indicador rotulo="Prazo médio de recebimento" valor={d(receber.condicao ?? receber.pelaMedia)} fonte="Condições de pagamento dos pedidos de venda do período (média ponderada pelo valor); sem condição, saldo a receber ÷ recebimentos por dia." />
        <Indicador rotulo="Prazo médio de pagamento" valor={d(pagar.condicao ?? pagar.pelaMedia)} fonte="Parcelas/condição das ordens de compra do período (média ponderada pelo valor); sem condição, saldo a pagar ÷ pagamentos por dia." />
        <Indicador
          rotulo="Diferença (ciclo)"
          valor={d(ciclo)}
          detalhe={ciclo === null ? undefined : ciclo > 0 ? "a Venner banca os clientes" : "fornecedores bancam a Venner"}
          cor={ciclo !== null && ciclo > 0 ? "text-perigo" : "text-sucesso"}
          fonte="Prazo de recebimento − prazo de pagamento. Positivo: paga antes de receber e precisa de capital de giro."
        />
      </div>
      <Tabela colunas={["", "Recebimento", "Pagamento"]}>
        {linha("Prazo pelas condições dos pedidos", d(receber.condicao), d(pagar.condicao), "Condição de pagamento dos pedidos de venda e das ordens de compra do período, ponderada pelo valor.")}
        {linha("Prazo pelo saldo em aberto", d(receber.pelaMedia), d(pagar.pelaMedia), "Saldo em aberto hoje ÷ média diária das baixas dos últimos 90 dias.")}
        {linha("Dias até vencer o que está em aberto", d(receber.aVencer), d(pagar.aVencer), "Média ponderada dos dias até o vencimento dos títulos a vencer.")}
        {linha("Baixas feitas até o vencimento", formatar(receber.emDia, "pct"), formatar(pagar.emDia, "pct"), "Títulos baixados no período sem atraso.")}
        {linha("Atraso médio quando atrasa", d(receber.atrasoMedio), d(pagar.atrasoMedio), "Dias entre vencimento e baixa dos títulos atrasados, ponderado pelo valor.")}
        {linha("Em aberto hoje", m$(receber.aberto), m$(pagar.aberto), "Todos os títulos em aberto.")}
        {linha("Vencido hoje", m$(receber.vencido), m$(pagar.vencido), "Em aberto com vencimento antes de hoje.")}
      </Tabela>
      <Fonte>
        Fonte: condição de pagamento dos pedidos de venda e ordens de compra do Tiny ({c.textoPeriodo}), contas a pagar e a receber em aberto hoje e
        baixas · {c.daEmpresa}.
      </Fonte>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Principais clientes e fornecedores
// ---------------------------------------------------------------------------
function Pessoas(c: Ctx) {
  const tabela = (tipo: TipoTitulo) => {
    const lista = c.dados.pessoas.filter((p) => p.tipo === tipo);
    const total = somaQtd(lista, (p) => p.total);
    const href = `/financeiro/${tipo}?de=${c.periodo.de}&ate=${c.periodo.ate}&por=vencimento&situacao=`;
    return (
      <Secao titulo={tipo === "receber" ? "Principais clientes" : "Principais fornecedores"}>
        <Tabela
          colunas={["", tipo === "receber" ? "Cliente" : "Fornecedor", "Volume", "% dos 20", "Títulos", "Condição principal", "Prazo", "Em aberto", "Vencido", "Em dia", "Atraso médio"]}
          vazio="Sem títulos no período."
        >
          {lista.map((p, i) => {
            const cond = condicaoDaPessoa(c.dados, tipo, p.pessoa_id);
            return (
              <tr key={p.pessoa_id ?? "sem"}>
                <Celula className="w-0 text-xs text-texto-suave">{i + 1}</Celula>
                <Celula>
                  <Link href={href} className="hover:text-primaria hover:underline">
                    {p.nome}
                  </Link>
                </Celula>
                <Celula className="text-right tabular-nums">{m$(p.total)}</Celula>
                <Celula className="text-right tabular-nums">
                  <Barra fracao={total ? Number(p.total) / total : 0} /> {total ? formatar(Number(p.total) / total, "pct") : ""}
                </Celula>
                <Celula className="text-right tabular-nums">{p.qtd}</Celula>
                <Celula className="text-xs">{cond.condicao ?? p.condicao_cadastro ?? <span className="text-texto-suave">—</span>}</Celula>
                <Celula className="text-right tabular-nums">{formatar(cond.dias, "dias")}</Celula>
                <Celula className="text-right tabular-nums">{m$(Number(p.aberto ?? 0))}</Celula>
                <Celula className={`text-right tabular-nums ${Number(p.vencido ?? 0) > 0 ? "text-perigo" : ""}`}>{m$(Number(p.vencido ?? 0))}</Celula>
                <Celula className="text-right tabular-nums">{p.baixados ? formatar(p.em_dia / p.baixados, "pct") : "—"}</Celula>
                <Celula className="text-right tabular-nums">{formatar(p.atraso_medio === null ? null : Number(p.atraso_medio), "dias")}</Celula>
              </tr>
            );
          })}
        </Tabela>
      </Secao>
    );
  };
  return (
    <div className="space-y-3">
      {tabela("receber")}
      {tabela("pagar")}
      <Fonte>
        Fonte: contas a receber e a pagar com vencimento em {c.textoPeriodo} (os 20 maiores), condição de pagamento dos pedidos de venda e ordens
        de compra do período (ou do cadastro do fornecedor) · {c.daEmpresa}. Atraso médio: dias entre vencimento e baixa.
      </Fonte>
    </div>
  );
}

// ---------------------------------------------------------------------------
// E-commerce: estrutura das saídas pelos canais
// ---------------------------------------------------------------------------
function Ecommerce(c: Ctx) {
  const canais = porCanal(c.dados);
  const eco = canais.filter((x) => x.canal !== "venda_direta");
  const semDados = !eco.some((x) => x.temDados);
  const meses = c.linhas.map((l) => l.mes);
  return (
    <div className="space-y-3">
      {semDados && (
        <SemDados>
          Vendas do e-commerce (Upseller, Mercado Livre, Shopee) ainda não chegam ao sistema. A estrutura abaixo já está pronta e se preenche
          sozinha, por canal e por CNPJ, quando a integração for ligada. O B2B do Tiny fica na primeira linha para comparação.
        </SemDados>
      )}
      <Tabela colunas={["Canal", "Origem dos dados", "Pedidos", "Vendido", "Pedido médio", "A receber (bruto)", "Comissões e fretes", "%", "Líquido"]}>
        {canais.map((x) => (
          <tr key={x.canal} className={x.temDados ? "" : "text-texto-suave"}>
            <Celula>{x.nome}</Celula>
            <Celula className="text-xs text-texto-suave">{x.fonte}</Celula>
            <Celula className="text-right tabular-nums">{x.temDados ? formatar(x.pedidos, "numero") : "—"}</Celula>
            <Celula className="text-right tabular-nums">{x.temDados ? m$(x.vendido) : "—"}</Celula>
            <Celula className="text-right tabular-nums">{x.temDados ? m$(x.ticket) : "—"}</Celula>
            <Celula className="text-right tabular-nums">{x.temDados ? m$(x.recebivel) : "—"}</Celula>
            <Celula className="text-right tabular-nums">{x.temDados ? m$(x.tarifas) : "—"}</Celula>
            <Celula className="text-right tabular-nums">{x.temDados ? formatar(x.tarifaPct, "pct") : "—"}</Celula>
            <Celula className="text-right tabular-nums">{x.temDados ? m$(x.liquido) : "—"}</Celula>
          </tr>
        ))}
      </Tabela>
      <Secao titulo="Saídas por canal e mês">
        <Tabela colunas={["Canal", ...meses.map(rotuloMes)]}>
          {canais.map((x) => (
            <tr key={x.canal} className={x.temDados ? "" : "text-texto-suave"}>
              <Celula>{x.nome}</Celula>
              {meses.map((m) => {
                const v = somaQtd(
                  c.dados.pedidos_mes.filter((p) => p.canal === x.canal && p.mes === m),
                  (p) => p.entrada_valor,
                );
                return (
                  <Celula key={m} className="text-right tabular-nums">
                    {v ? m$(v) : "—"}
                  </Celula>
                );
              })}
            </tr>
          ))}
        </Tabela>
      </Secao>
      <Fonte>
        Fonte: pedidos de venda por canal (data do pedido) e contas a receber por canal (vencimento, bruto, comissões/fretes e líquido) ·{" "}
        {c.daEmpresa} · {c.textoPeriodo}. Margem por canal entra quando o custo dos produtos vier do Tiny.
      </Fonte>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaIndicadores} />;
}
