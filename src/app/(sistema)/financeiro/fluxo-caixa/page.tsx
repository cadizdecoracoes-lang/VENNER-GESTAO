"use client";

import Link from "next/link";
import { CabecalhoTela, Indicador, SemAcesso, estiloBotaoSecundario } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil } from "@/lib/datas";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { filtrarPorConta, montarFluxo, somarMeses, ultimoDiaMes, type CategoriaFluxo, type MovimentoFluxo, type SaldoConta } from "@/lib/fluxo-caixa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { SeletorConta } from "./seletor-conta";
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
  const anterior = modo === "dia" ? link({ mes: somarMeses(mes, -1).slice(0, 7) }) : link({ modo: "mes", inicio: somarMeses(inicio, -1).slice(0, 7) });
  const proximo = modo === "dia" ? link({ mes: somarMeses(mes, 1).slice(0, 7) }) : link({ modo: "mes", inicio: somarMeses(inicio, 1).slice(0, 7) });
  const seg = (ativo: boolean) => `px-2.5 py-1 text-sm font-medium ${ativo ? "bg-texto text-white" : "bg-superficie text-texto-suave hover:text-texto"}`;
  const podeDigitar = !!selecionada && !conta && pode(acesso, TELA, "editar") && modo === "dia";
  const ajuda = (
    <>
      Até ontem: pagos e recebidos (realizado). De hoje em diante: em aberto pelo vencimento, no dia útil seguinte; atrasados em hoje. Clique no grupo
      para abrir; num valor para ver os títulos. As duas últimas colunas comparam o total com {rotuloAnterior}.
      {podeDigitar
        ? " Na linha Previsão digitada, clique no dia e digite (Enter grava)."
        : modo === "dia"
          ? conta
            ? " Para digitar previsões, volte para “Todas” as contas."
            : " Para digitar previsões, escolha uma empresa."
          : ""}
    </>
  );

  return (
    <div className="space-y-3">
      {/* Cabeçalho numa linha: título à esquerda; conta, modo e período à direita. */}
      <CabecalhoTela codigo={TELA} empresa={selecionada} ajuda={ajuda}>
        {contas.length > 0 && (
          <SeletorConta
            contas={contas.map((c) => ({
              id: c.conta_bancaria_id,
              nome: selecionada ? c.nome : `${c.nome} · ${nomeEmpresa.get(c.empresa_id) ?? ""}`,
            }))}
            atual={conta?.conta_bancaria_id ?? null}
            periodo={periodo}
          />
        )}
        <span className="inline-flex overflow-hidden rounded-md border border-borda">
          <Link href={link({ mes: mes.slice(0, 7) })} className={seg(modo === "dia")}>
            Diário
          </Link>
          <Link href={link({ modo: "mes", inicio: inicio.slice(0, 7) })} className={seg(modo === "mes")}>
            12 meses
          </Link>
        </span>
        <span className="flex items-center gap-1 text-sm">
          <Link href={anterior} className={`${estiloBotaoSecundario} px-2 py-0.5`} aria-label="Anterior">
            ‹
          </Link>
          <span className="min-w-32 text-center font-semibold">{modo === "dia" ? rotuloMes(mes) : `${curto(inicio)} a ${curto(somarMeses(inicio, 11))}`}</span>
          <Link href={proximo} className={`${estiloBotaoSecundario} px-2 py-0.5`} aria-label="Próximo">
            ›
          </Link>
          <Link href={conta ? `?conta=${conta.conta_bancaria_id}` : "?"} className="ml-1 text-xs text-primaria hover:underline">
            hoje
          </Link>
        </span>
      </CabecalhoTela>

      {/* Resumo: cartões compactos numa faixa só. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Indicador
          rotulo="Saldo hoje"
          valor={r.saldoHoje === null ? "—" : formatarMoeda(r.saldoHoje)}
          cor={r.saldoHoje !== null && r.saldoHoje < 0 ? "text-perigo" : ""}
          fonte="Saldo das contas até agora + o que vence hoje e os atrasados (fonte: contas bancárias, pagar e receber)"
        />
        <Indicador
          rotulo="Menor saldo previsto"
          valor={r.menorSaldo ? formatarMoeda(r.menorSaldo.valor) : "—"}
          detalhe={r.menorSaldo ? `em ${formatarData(r.menorSaldo.data).slice(0, 5)}` : undefined}
          cor={r.menorSaldo && r.menorSaldo.valor < 0 ? "text-perigo" : ""}
          fonte="Menor saldo do período, de hoje em diante"
        />
        <Indicador
          rotulo="A receber previsto"
          valor={formatarMoeda(r.entradasPrevistas)}
          cor="text-sucesso"
          href="/financeiro/receber"
          fonte="Em aberto, atrasados e previsões digitadas no período"
        />
        <Indicador
          rotulo="A pagar previsto"
          valor={formatarMoeda(r.saidasPrevistas)}
          href="/financeiro/pagar"
          fonte="Em aberto, atrasados e previsões digitadas no período"
        />
        <Indicador
          rotulo="Atrasados (contam em hoje)"
          valor={r.atrasadoPagar > 0 || r.atrasadoReceber > 0 ? `−${formatarMoeda(r.atrasadoPagar)}` : "—"}
          detalhe={r.atrasadoReceber > 0 ? `+${formatarMoeda(r.atrasadoReceber)} a receber` : undefined}
          cor={r.atrasadoPagar > 0 ? "text-alerta" : ""}
          href="/financeiro/pagar?situacao=vencido"
          fonte="Títulos vencidos e em aberto: o fluxo considera que saem/entram hoje"
        />
        <Indicador
          rotulo="Extrato a conciliar"
          valor={String(dados.pendentesExtrato)}
          cor={dados.pendentesExtrato > 0 ? "text-alerta" : ""}
          href="/financeiro/conciliacao"
          fonte="Linhas do extrato ainda sem título: o realizado pode estar incompleto"
        />
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
      </p>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaFluxoCaixa} />;
}
