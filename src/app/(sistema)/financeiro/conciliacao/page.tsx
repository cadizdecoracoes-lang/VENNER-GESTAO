"use client";

import { FileUp, Link2 } from "lucide-react";
import Link from "next/link";
import { FormAcao } from "@/components/form-acao";
import { CabecalhoTela, Celula, Etiqueta, LinkAcao, SemAcesso, Tabela, estiloBotao, estiloBotaoSecundario } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil } from "@/lib/datas";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { sugerirConciliacao, type TituloCandidato } from "@/lib/extrato";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { conciliar, conciliarSugestoes, desfazer, excluirImportacao } from "./actions";
import {
  carregarCandidatos,
  carregarConferencia,
  carregarContas,
  carregarImportacoes,
  carregarIndicadores,
  carregarLinhas,
  carregarPendentes,
  nomePessoa,
  type LinhaConciliacao,
} from "./dados";
import { PainelResolver } from "./painel-resolver";
import { SeletorConta } from "./seletor-conta";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.conciliacao";
const variacao = (atual: number, antes: number) => `${atual >= antes ? "+" : ""}${Math.round(((atual - antes) / antes) * 100)}%`;
type Filtros = { conta?: string; situacao?: string; mes?: string; linha?: string; importadas?: string; repetidas?: string; automaticas?: string };

const SITUACOES = [
  { valor: "pendente", rotulo: "Pendentes" },
  { valor: "resolvido", rotulo: "Conciliadas" },
  { valor: "todos", rotulo: "Todas" },
];

function Ligacoes({ linha }: { linha: LinhaConciliacao }) {
  if (linha.situacao === "transferencia") return <Etiqueta>Transferência entre contas</Etiqueta>;
  if (linha.situacao === "ignorado")
    return (
      <span className="text-xs text-texto-suave">
        <Etiqueta>Ignorada</Etiqueta> {linha.observacao}
      </span>
    );
  return (
    <span className="text-xs">
      <Etiqueta cor="sucesso">Conciliada</Etiqueta>{" "}
      {linha.extrato_conciliacoes
        .map((c) => {
          const t = c.contas_pagar ?? c.contas_receber;
          const pessoa = c.contas_pagar ? nomePessoa(c.contas_pagar.fornecedores) : c.contas_receber ? nomePessoa(c.contas_receber.clientes) : null;
          return `${pessoa ? pessoa + " · " : ""}${t?.descricao ?? ""}${t?.parcela ? ` (${t.parcela})` : ""}${c.efeito === "criou" ? " (lançado aqui)" : ""}`;
        })
        .join(" + ")}
    </span>
  );
}

async function PaginaConciliacao({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const filtros = await searchParams;
  const podeEditar = pode(acesso, TELA, "editar");

  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const [contas, pendentes] = await Promise.all([carregarContas(selecionada?.id ?? null), carregarPendentes(selecionada?.id ?? null)]);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const conta =
    contas.find((c) => c.id === filtros.conta) ?? contas.find((c) => pendentes.has(c.id)) ?? contas[0] ?? null;
  const situacao = SITUACOES.some((s) => s.valor === filtros.situacao) ? filtros.situacao! : "pendente";
  const mes = /^\d{4}-\d{2}$/.test(filtros.mes ?? "") ? filtros.mes! : null;
  const linhas = conta ? await carregarLinhas(conta.id, situacao, mes) : [];
  const pend = linhas.filter((l) => l.situacao === "pendente");

  // Sugestões para as pendentes (mesmo valor e data próxima).
  let candidatos: TituloCandidato[] = [];
  if (conta && pend.length) {
    candidatos = await carregarCandidatos(conta, pend[0].data, pend[pend.length - 1].data);
  }
  const sugestoes = sugerirConciliacao(pend, candidatos);
  const porId = new Map(candidatos.map((t) => [t.id, t]));
  const conferencia = conta ? await carregarConferencia(conta) : null;
  const podeExcluir = pode(acesso, TELA, "excluir");
  const importacoes = conta ? await carregarImportacoes(conta.id) : [];
  const [indMes, indAnterior] = conta ? await carregarIndicadores(conta.id, mes ?? hojeBrasil().slice(0, 7)) : [null, null];

  // Painel de resolver uma linha: candidatos mais amplos (30 dias).
  const resolvendo = filtros.linha ? pend.find((l) => l.id === filtros.linha) : undefined;
  const amplos = resolvendo && conta && podeEditar ? await carregarCandidatos(conta, resolvendo.data, resolvendo.data, 45, 30) : [];

  const base = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const tudo = { conta: conta?.id, situacao: situacao === "pendente" ? undefined : situacao, mes: mes ?? undefined, ...extra };
    for (const [k, v] of Object.entries(tudo)) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const pilula = (ativo: boolean) =>
    `rounded-full px-2.5 py-0.5 text-sm transition-colors ${ativo ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-superficie hover:text-texto"}`;
  const somaPend = pend.reduce((s, l) => s + Number(l.valor), 0);
  const pares = [...sugestoes.entries()].map(([linha, s]) => ({
    linha,
    tipo: porId.get(s.titulos[0])?.tipo,
    titulos: s.titulos,
  }));
  const hoje = hojeBrasil();
  // Atalho para criar o título que falta, já preenchido; depois de salvar volta para a linha.
  const linkCriar = (l: LinhaConciliacao) => {
    const destino = Number(l.valor) < 0 ? "/financeiro/pagar" : "/financeiro/receber";
    const p = new URLSearchParams({
      novo: "1",
      empresa: conta?.empresa_id ?? "",
      descricao: l.descricao,
      valor: Math.abs(Number(l.valor)).toFixed(2),
      vencimento: l.data,
      volta: `/financeiro/conciliacao${base({ linha: l.id })}`,
    });
    return `${destino}?${p.toString()}`;
  };

  return (
    <div className="space-y-3">
      {/* Cabeçalho numa linha: título, conta e botões. */}
      <CabecalhoTela codigo={TELA} empresa={selecionada}>
        {contas.length > 0 && (
          <SeletorConta
            contas={contas.map((c) => ({
              id: c.id,
              nome: selecionada ? c.nome : `${c.nome} · ${nomeEmpresa.get(c.empresa_id) ?? ""}`,
              pendentes: pendentes.get(c.id) ?? 0,
            }))}
            atual={conta?.id ?? null}
          />
        )}
        <Link href="/financeiro/conciliacao/importar#banco" className={estiloBotaoSecundario}>
          <Link2 size={16} /> Ligar com o banco
        </Link>
        {pode(acesso, TELA, "criar") && (
          <Link href={`/financeiro/conciliacao/importar${conta ? `?conta=${conta.id}` : ""}`} className={estiloBotao}>
            <FileUp size={16} /> Importar extrato
          </Link>
        )}
      </CabecalhoTela>

      {filtros.importadas !== undefined && (
        <p className="rounded-lg bg-sucesso/10 px-3 py-1.5 text-sm text-sucesso">
          Extrato importado: {filtros.importadas} lançamento(s) novo(s)
          {Number(filtros.repetidas) > 0 && `, ${filtros.repetidas} já estavam no sistema e não entraram de novo`}
          {Number(filtros.automaticas) > 0 && `; ${filtros.automaticas} bateram com títulos e já foram conciliadas`}. Abaixo ficam só as divergências.
        </p>
      )}

      {contas.length === 0 ? (
        <p className="rounded-lg bg-superficie px-4 py-3 text-sm text-texto-suave">
          {selecionada ? `${selecionada.nome} ainda não tem conta bancária.` : "Nenhuma conta bancária cadastrada."} Cadastre em{" "}
          <LinkAcao href="/financeiro/contas-bancarias">Contas bancárias</LinkAcao>.
        </p>
      ) : (
        <>
          {/* Faixa fina: situação, mês e conferência de saldo. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-1">
              {SITUACOES.map((s) => (
                <Link key={s.valor} href={base({ situacao: s.valor === "pendente" ? undefined : s.valor })} className={pilula(s.valor === situacao)}>
                  {s.rotulo}
                </Link>
              ))}
            </span>
            <form method="get" className="flex items-center gap-1">
              {conta && <input type="hidden" name="conta" value={conta.id} />}
              {situacao !== "pendente" && <input type="hidden" name="situacao" value={situacao} />}
              <input type="month" name="mes" defaultValue={mes ?? ""} aria-label="Mês" className="rounded-md border border-borda bg-superficie px-2 py-0.5 text-sm" />
              <button type="submit" className="text-sm text-primaria hover:underline">
                Ver mês
              </button>
              {mes && (
                <Link href={base({ mes: undefined })} className="text-xs text-texto-suave hover:underline">
                  limpar
                </Link>
              )}
            </form>
            <span className="text-texto-suave">
              Pendentes: <strong className="tabular-nums text-texto">{conta ? (pendentes.get(conta.id) ?? 0) : 0}</strong>
              {situacao === "pendente" && pend.length > 0 && <span className="tabular-nums"> ({formatarMoeda(somaPend)})</span>}
            </span>
            {conferencia && (
              <span
                className="text-texto-suave"
                title={`Último extrato: ${conferencia.arquivo ?? "leitura do banco"}, importado em ${formatarData(conferencia.importadoEm)}. Sistema = saldo inicial da conta + recebidos − pagos + transferências até a mesma data.`}
              >
                Saldo em {formatarData(conferencia.ate)}: banco{" "}
                <strong className="tabular-nums text-texto">{conferencia.banco === null ? "—" : formatarMoeda(conferencia.banco)}</strong> · sistema{" "}
                <strong className="tabular-nums text-texto">{conferencia.sistema === null ? "—" : formatarMoeda(conferencia.sistema)}</strong>
                {conferencia.banco !== null && conferencia.sistema !== null && (
                  <>
                    {" "}· diferença{" "}
                    <strong className={`tabular-nums ${Math.abs(conferencia.banco - conferencia.sistema) > 0.009 ? "text-perigo" : "text-sucesso"}`}>
                      {formatarMoeda(conferencia.banco - conferencia.sistema)}
                    </strong>
                  </>
                )}
              </span>
            )}
            {indMes && indAnterior && (
              <span
                className="text-xs text-texto-suave"
                title={[
                  `Linhas do extrato desta conta em ${indMes.mes.slice(5)}/${indMes.mes.slice(0, 4)}, pela data do lançamento.`,
                  indAnterior.linhas > 0
                    ? `Mês anterior: ${indAnterior.linhas} linha(s), ${Math.round((indAnterior.resolvidas / indAnterior.linhas) * 100)}% conciliadas.`
                    : "",
                  indAnterior.entradas > 0 ? `Entradas ${variacao(indMes.entradas, indAnterior.entradas)} vs ${formatarMoeda(indAnterior.entradas)} no mês anterior.` : "",
                  indAnterior.saidas > 0 ? `Saídas ${variacao(indMes.saidas, indAnterior.saidas)} vs ${formatarMoeda(indAnterior.saidas)} no mês anterior.` : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {indMes.mes.slice(5)}/{indMes.mes.slice(0, 4)}: <strong className="text-texto">{indMes.linhas}</strong> linha(s),{" "}
                <strong className="text-texto">{indMes.linhas ? Math.round((indMes.resolvidas / indMes.linhas) * 100) : 0}%</strong> conciliadas · entradas{" "}
                <strong className="tabular-nums text-sucesso">{formatarMoeda(indMes.entradas)}</strong> · saídas{" "}
                <strong className="tabular-nums text-perigo">{formatarMoeda(indMes.saidas)}</strong>
              </span>
            )}
            {podeEditar && pares.length > 1 && (
              <FormAcao acao={conciliarSugestoes} rotulo={`Aceitar as ${pares.length} sugestões`} enviando="Conciliando..." secundario className="ml-auto">
                <input type="hidden" name="pares" value={JSON.stringify(pares)} />
              </FormAcao>
            )}
          </div>

          {/* Arquivos importados nesta conta, recolhidos numa linha. */}
          {importacoes.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-texto-suave hover:text-texto">Importações desta conta ({importacoes.length})</summary>
              <ul className="mt-1 divide-y divide-borda/70 rounded-lg bg-superficie px-3">
                {importacoes.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    <span className="font-medium">{i.arquivo ?? i.origem.toUpperCase()}</span>
                    <span className="text-xs text-texto-suave">
                      {i.periodo_de && i.periodo_ate ? `${formatarData(i.periodo_de)} a ${formatarData(i.periodo_ate)} · ` : ""}
                      {i.importadas} linha(s), {i.conciliadas} resolvida(s) · importado em {formatarData(i.criado_em.slice(0, 10))}
                    </span>
                    {podeExcluir && (
                      <FormAcao
                        acao={excluirImportacao.bind(null, i.id)}
                        rotulo="Excluir"
                        enviando="Excluindo..."
                        discreto
                        className="ml-auto"
                        confirmar={`Excluir a importação ${i.arquivo ?? ""} com ${i.importadas} linha(s)?${
                          i.conciliadas ? ` ${i.conciliadas} já foram resolvidas: os títulos baixados pela conciliação voltam a ficar em aberto.` : ""
                        } Não dá para desfazer.`}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {resolvendo && conta && podeEditar && (
            <PainelResolver
              linha={resolvendo}
              candidatos={amplos.filter((t) => t.tipo === (Number(resolvendo.valor) < 0 ? "pagar" : "receber"))}
              linkCriar={linkCriar(resolvendo)}
              voltar={base({})}
            />
          )}

          <Tabela
            colunas={["Data", "Lançamento do extrato", "Valor", "Saldo", "Conciliação", ""]}
            vazio={
              situacao === "pendente"
                ? linhas.length === 0 && !pendentes.get(conta?.id ?? "")
                  ? "Nada pendente nesta conta. Importe o extrato mais recente para continuar."
                  : "Nada pendente."
                : "Nenhum lançamento neste filtro."
            }
          >
            {linhas.map((l) => {
              const s = sugestoes.get(l.id);
              const titulo = s ? porId.get(s.titulos[0]) : undefined;
              const valor = Number(l.valor);
              return (
                <tr key={l.id} className={l.id === resolvendo?.id ? "bg-primaria-suave/50" : ""}>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarData(l.data)}</Celula>
                  <Celula>
                    <span className="font-medium">{l.descricao}</span>
                    {l.documento && <span className="text-xs text-texto-suave"> · doc {l.documento}</span>}
                  </Celula>
                  <Celula className={`whitespace-nowrap text-right tabular-nums font-medium ${valor < 0 ? "text-perigo" : "text-sucesso"}`}>
                    {formatarMoeda(valor)}
                  </Celula>
                  <Celula className="whitespace-nowrap text-right tabular-nums text-texto-suave">{l.saldo === null ? "" : formatarMoeda(Number(l.saldo))}</Celula>
                  <Celula>
                    {l.situacao !== "pendente" ? (
                      <Ligacoes linha={l} />
                    ) : titulo ? (
                      <span className="text-xs" title={s!.motivo}>
                        <Etiqueta cor="primaria">Sugestão</Etiqueta> {titulo.pessoa ? `${titulo.pessoa} · ` : ""}
                        {titulo.descricao} · {titulo.pago ? "pago" : "vence"} {formatarData(titulo.data)}
                      </span>
                    ) : (
                      <span className="text-xs text-texto-suave">{l.data < hoje ? "sem título correspondente" : ""}</span>
                    )}
                  </Celula>
                  <Celula className="whitespace-nowrap text-right">
                    {podeEditar && (
                      <div className="flex items-center justify-end gap-3">
                        {l.situacao === "pendente" ? (
                          <>
                            {titulo && (
                              <FormAcao
                                acao={conciliar.bind(null, l.id, titulo.tipo === "pagar" ? [titulo.id] : [], titulo.tipo === "receber" ? [titulo.id] : [])}
                                rotulo="Conciliar"
                                enviando="..."
                                discreto
                              />
                            )}
                            {!titulo && <LinkAcao href={linkCriar(l)}>Criar título</LinkAcao>}
                            <LinkAcao href={base({ linha: l.id })}>{titulo ? "Outro" : "Escolher"}</LinkAcao>
                          </>
                        ) : (
                          <FormAcao
                            acao={desfazer.bind(null, l.id)}
                            rotulo="Desfazer"
                            enviando="..."
                            discreto
                            confirmar="Desfazer? Títulos baixados pela conciliação voltam para em aberto e os lançados aqui são cancelados."
                          />
                        )}
                      </div>
                    )}
                  </Celula>
                </tr>
              );
            })}
          </Tabela>
        </>
      )}
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaConciliacao} />;
}
