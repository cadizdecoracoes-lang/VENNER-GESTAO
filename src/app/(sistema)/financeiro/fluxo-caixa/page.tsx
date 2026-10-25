"use client";

import Link from "next/link";
import { CabecalhoTela, SemAcesso, estiloBotaoSecundario } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil } from "@/lib/datas";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { filtrarPorConta, montarFluxo, somarMeses, ultimoDiaMes, type CategoriaFluxo, type MovimentoFluxo, type SaldoConta } from "@/lib/fluxo-caixa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { TabelaFluxo } from "./tabela-fluxo";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.fluxo_caixa";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const rotuloMes = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const curto = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1].slice(0, 3).toLowerCase()}/${iso.slice(2, 4)}`;

// A função pode devolver mais de 1.000 linhas: lê em páginas.
async function movimentos(de: string, ate: string, empresa: string | null): Promise<MovimentoFluxo[]> {
  const supabase = criarClienteNavegador();
  const lista: MovimentoFluxo[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase.rpc("fluxo_caixa", { de, ate, empresa }).range(i, i + 999);
    if (error) throw new Error(error.message);
    lista.push(...((data ?? []) as MovimentoFluxo[]));
    if (!data || data.length < 1000) break;
  }
  return lista;
}

async function carregar(de: string, ate: string, antDe: string, antAte: string, empresa: string | null, conta: string | null) {
  if (!supabaseConfigurado) return { movimentos: [], anteriores: [], saldos: [], categorias: [], pendentesExtrato: 0 };
  let pendentes = criarClienteNavegador().from("extrato_lancamentos").select("id", { count: "exact", head: true }).eq("situacao", "pendente");
  if (empresa) pendentes = pendentes.eq("empresa_id", empresa);
  if (conta) pendentes = pendentes.eq("conta_bancaria_id", conta);
  const supabase = criarClienteNavegador();
  const [atuais, anteriores, saldos, categorias, pendentesExtrato] = await Promise.all([
    movimentos(de, ate, empresa),
    movimentos(antDe, antAte, empresa),
    supabase.rpc("fluxo_caixa_saldos", { de, empresa }),
    supabase.from("plano_contas").select("id, codigo, nome, pai_id").limit(5000),
    pendentes,
  ]);
  return {
    movimentos: atuais,
    anteriores,
    saldos: (saldos.data ?? []) as SaldoConta[],
    categorias: (categorias.data ?? []) as CategoriaFluxo[],
    pendentesExtrato: pendentesExtrato.count ?? 0,
  };
}

async function PaginaFluxoCaixa({ searchParams }: { searchParams: Promise<{ modo?: string; mes?: string; inicio?: string; conta?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const filtros = await searchParams;
  const selecionada = await empresaSelecionada();
  const hoje = hojeBrasil();
  const mesAtual = hoje.slice(0, 8) + "01";
  const modo = filtros.modo === "mes" ? "mes" : "dia";
  const mes = /^\d{4}-\d{2}$/.test(filtros.mes ?? "") ? `${filtros.mes}-01` : mesAtual;
  // 12 meses: por padrão, 3 meses para trás e 8 para frente.
  const inicio = /^\d{4}-\d{2}$/.test(filtros.inicio ?? "") ? `${filtros.inicio}-01` : somarMeses(mesAtual, -3);
  const de = modo === "dia" ? mes : inicio;
  const ate = modo === "dia" ? ultimoDiaMes(mes) : ultimoDiaMes(somarMeses(inicio, 11));

  let erro: string | null = null;
  // Comparação: mês anterior (diário) ou os 12 meses anteriores.
  const antDe = modo === "dia" ? somarMeses(mes, -1) : somarMeses(inicio, -12);
  const antAte = modo === "dia" ? ultimoDiaMes(antDe) : ultimoDiaMes(somarMeses(inicio, -1));
  const rotuloAnterior = modo === "dia" ? `${rotuloMes(antDe).split(" ")[0]} (mês anterior)` : `12 meses antes (${curto(antDe)} a ${curto(antAte)})`;
  let dados: Awaited<ReturnType<typeof carregar>> = { movimentos: [], anteriores: [], saldos: [], categorias: [], pendentesExtrato: 0 };
  try {
    dados = await carregar(de, ate, antDe, antAte, selecionada?.id ?? null, filtros.conta ?? null);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }
  const empresas = await carregarEmpresas();
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  // Contas da empresa escolhida (ou de todas, no consolidado); uma conta de
  // outra empresa no endereço vira "todas as contas".
  const contas = dados.saldos;
  const conta = contas.find((c) => c.conta_bancaria_id === filtros.conta) ?? null;
  let comPrevisto = true;
  if (conta) {
    const atual = filtrarPorConta(dados.movimentos, dados.saldos, conta.conta_bancaria_id);
    const ant = filtrarPorConta(dados.anteriores, dados.saldos, conta.conta_bancaria_id);
    comPrevisto = atual.comPrevisto;
    dados = { ...dados, movimentos: atual.movimentos, anteriores: ant.movimentos, saldos: atual.saldos };
  }
  const fluxo = montarFluxo({ modo, de, ate, hoje, ...dados });
  const r = fluxo.resumo;

  const link = (p: Record<string, string>) => `?${new URLSearchParams(conta ? { ...p, conta: conta.conta_bancaria_id } : p).toString()}`;
  const periodo: Record<string, string> = modo === "dia" ? { mes: mes.slice(0, 7) } : { modo: "mes", inicio: inicio.slice(0, 7) };
  const linkConta = (id: string | null) => `?${new URLSearchParams(id ? { ...periodo, conta: id } : periodo).toString()}`;
  const aba = (ativo: boolean) =>
    `rounded-md px-2 py-0.5 text-xs font-medium ${ativo ? "bg-texto text-white" : "border border-borda bg-superficie text-texto-suave hover:text-texto"}`;
  const anterior = modo === "dia" ? link({ mes: somarMeses(mes, -1).slice(0, 7) }) : link({ modo: "mes", inicio: somarMeses(inicio, -1).slice(0, 7) });
  const proximo = modo === "dia" ? link({ mes: somarMeses(mes, 1).slice(0, 7) }) : link({ modo: "mes", inicio: somarMeses(inicio, 1).slice(0, 7) });
  const seg = (ativo: boolean) => `px-2.5 py-1 text-sm font-medium ${ativo ? "bg-texto text-white" : "bg-superficie text-texto-suave hover:text-texto"}`;
  const podeDigitar = !!selecionada && !conta && pode(acesso, TELA, "editar") && modo === "dia";
  const item = (rotulo: string, valor: React.ReactNode, dica: string, href?: string, cor = "") => {
    const corpo = (
      <>
        <span className="text-texto-suave">{rotulo}</span> <strong className={`tabular-nums ${cor}`}>{valor}</strong>
      </>
    );
    return href ? (
      <Link href={href} title={dica} className="hover:underline">
        {corpo}
      </Link>
    ) : (
      <span title={dica}>{corpo}</span>
    );
  };

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} empresa={selecionada}>
        <span className="text-xs text-texto-suave">{selecionada ? selecionada.nome : "Grupo (consolidado)"}</span>
      </CabecalhoTela>

      {/* Contas bancárias: todas (da empresa ou do grupo) ou uma só. */}
      {contas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-texto-suave">Conta</span>
          <Link href={linkConta(null)} className={aba(!conta)}>
            Todas · {contas.length}
          </Link>
          {contas.map((c) => (
            <Link key={c.conta_bancaria_id} href={linkConta(c.conta_bancaria_id)} className={aba(conta?.conta_bancaria_id === c.conta_bancaria_id)}>
              {c.nome}
              {!selecionada && <span className="opacity-70"> · {nomeEmpresa.get(c.empresa_id) ?? ""}</span>}
            </Link>
          ))}
        </div>
      )}

      {/* Barra: modo, período e resumo numa linha fina. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="inline-flex overflow-hidden rounded-md border border-borda">
          <Link href={link({ mes: mes.slice(0, 7) })} className={seg(modo === "dia")}>
            Diário
          </Link>
          <Link href={link({ modo: "mes", inicio: inicio.slice(0, 7) })} className={seg(modo === "mes")}>
            12 meses
          </Link>
        </span>
        <span className="flex items-center gap-1">
          <Link href={anterior} className={`${estiloBotaoSecundario} px-2 py-0.5`} aria-label="Anterior">
            ‹
          </Link>
          <span className="min-w-36 text-center font-semibold">{modo === "dia" ? rotuloMes(mes) : `${curto(inicio)} a ${curto(somarMeses(inicio, 11))}`}</span>
          <Link href={proximo} className={`${estiloBotaoSecundario} px-2 py-0.5`} aria-label="Próximo">
            ›
          </Link>
          <Link href={conta ? `?conta=${conta.conta_bancaria_id}` : "?"} className="ml-1 text-xs text-primaria hover:underline">
            hoje
          </Link>
        </span>
        {item(
          `Saldo hoje`,
          r.saldoHoje === null ? "—" : formatarMoeda(r.saldoHoje),
          "Saldo das contas até agora + o que vence hoje e os atrasados (fonte: contas bancárias, pagar e receber)",
          undefined,
          r.saldoHoje !== null && r.saldoHoje < 0 ? "text-perigo" : "",
        )}
        {r.menorSaldo &&
          item(
            "Menor saldo previsto",
            `${formatarMoeda(r.menorSaldo.valor)} em ${formatarData(r.menorSaldo.data).slice(0, 5)}`,
            "Menor saldo do período, de hoje em diante",
            undefined,
            r.menorSaldo.valor < 0 ? "text-perigo" : "",
          )}
        {item("A receber previsto", formatarMoeda(r.entradasPrevistas), "Em aberto, atrasados e previsões digitadas no período", "/financeiro/receber", "text-sucesso")}
        {item("A pagar previsto", formatarMoeda(r.saidasPrevistas), "Em aberto, atrasados e previsões digitadas no período", "/financeiro/pagar")}
        {(r.atrasadoPagar > 0 || r.atrasadoReceber > 0) &&
          item(
            "Atrasados (em hoje)",
            `−${formatarMoeda(r.atrasadoPagar)} / +${formatarMoeda(r.atrasadoReceber)}`,
            "Títulos vencidos e em aberto: o fluxo considera que saem/entram hoje",
            "/financeiro/pagar?situacao=vencido",
            "text-alerta",
          )}
        {dados.pendentesExtrato > 0 &&
          item("Extrato a conciliar", String(dados.pendentesExtrato), "Linhas do extrato ainda sem título: o realizado pode estar incompleto", "/financeiro/conciliacao", "text-alerta")}
      </div>

      {conta && !comPrevisto && (
        <p className="rounded-lg bg-alerta/10 px-3 py-1.5 text-xs text-texto">
          Só o realizado da conta {conta.nome}: os títulos em aberto ainda não têm conta (ela é escolhida na baixa) e{" "}
          {nomeEmpresa.get(conta.empresa_id) ?? "a empresa"} tem mais de uma conta. A projeção completa fica em “Todas”.
        </p>
      )}

      {erro && <p className="rounded-lg bg-perigo/10 px-3 py-1.5 text-sm text-perigo">Não foi possível montar o fluxo: {erro}</p>}

      <TabelaFluxo fluxo={fluxo} modo={modo} hoje={hoje} empresa={selecionada?.id ?? null} podeDigitar={podeDigitar} rotuloAnterior={rotuloAnterior} conta={conta && { id: conta.conta_bancaria_id, empresa: conta.empresa_id, comAbertos: comPrevisto }} />

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-suave">
        <span>
          <i className="mr-1 inline-block h-2.5 w-3 border border-borda bg-[#f3f7fe] align-middle" />
          previsto
        </span>
        <span>
          <i className="mr-1 inline-block h-2.5 w-[3px] bg-alerta align-middle" />
          hoje
        </span>
        <span>
          <i className="mr-1 inline-block h-2.5 w-3 border border-borda bg-[#eceff3] align-middle" />
          fim de semana · ★ feriado
        </span>
        <span>
          Até ontem: pagos e recebidos (realizado). De hoje em diante: em aberto pelo vencimento, no dia útil seguinte; atrasados em hoje. Clique no
          grupo para abrir; num valor para ver os títulos. As duas últimas colunas comparam o total com {rotuloAnterior}.
          {podeDigitar
            ? " Na linha Previsão digitada, clique no dia e digite (Enter grava)."
            : modo === "dia"
              ? conta
                ? " Para digitar previsões, volte para “Todas” as contas."
                : " Para digitar previsões, escolha uma empresa."
              : ""}
        </span>
      </p>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaFluxoCaixa} />;
}
