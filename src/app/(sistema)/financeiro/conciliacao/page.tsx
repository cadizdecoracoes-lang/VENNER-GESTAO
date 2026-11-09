"use client";

import { FileUp, Link2 } from "lucide-react";
import Link from "next/link";
import { FormAcao } from "@/components/form-acao";
import { CabecalhoTela, Celula, Etiqueta, LinkAcao, SemAcesso, Tabela, estiloBotao, estiloBotaoSecundario } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil, somarDias } from "@/lib/datas";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { diferencaDoDia, marcasDoGrupo, naturezaSemTitulo, possiveisRepetidas, sugerirAntecipacao, sugerirConciliacao, type ItemDiferenca } from "@/lib/extrato";
import { formatarData, formatarMoeda } from "@/lib/formato";
import {
  conciliar,
  conciliarSugestoes,
  desfazer,
  excluirImportacao,
  marcarRepetida,
  marcarRepetidas,
  marcarTransferencia,
  marcarTransferencias,
} from "./actions";
import {
  carregarCandidatos,
  carregarConferencia,
  carregarContas,
  carregarImportacoes,
  carregarLinhas,
  carregarMovimentoDoDia,
  carregarPendentes,
  carregarSaldoBanco,
  carregarSaldoSistema,
  carregarVizinhas,
  contarPendentesAntes,
  nomePessoa,
  type LinhaConciliacao,
} from "./dados";
import { PainelResolver } from "./painel-resolver";
import { SeletorConta } from "./seletor-conta";
import { SeletorPeriodo } from "./seletor-periodo";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.conciliacao";
type Filtros = {
  conta?: string;
  situacao?: string;
  dia?: string;
  de?: string;
  ate?: string;
  tudo?: string;
  // Item da diferença do dia a destacar (veio de "ir para" de outro dia).
  destaque?: string;
  linha?: string;
  importadas?: string;
  repetidas?: string;
  automaticas?: string;
};

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

// O que é cada item e o que fazer com ele (vira dica ao passar o mouse).
const ROTULO_ITEM: Record<ItemDiferenca["tipo"], { rotulo: (i: ItemDiferenca) => string; dica: string }> = {
  pendente: {
    rotulo: () => "Está no banco e falta no sistema",
    dica: "Linha do extrato sem título. Resolva na lista abaixo: conciliar, criar o título ou escolher outro.",
  },
  linha_outro_dia: {
    rotulo: (i) => `Conciliada com título baixado em ${i.outraData ? formatarData(i.outraData) : "outro dia"}`,
    dica: "A linha deste dia foi ligada a um título baixado noutra data: o banco tem o valor neste dia e o sistema no outro. Se o título é de outro mês, desfaça e concilie com o título certo; se é o mesmo lançamento, acerte a data da baixa no título.",
  },
  linha_outra_conta: {
    rotulo: (i) => (i.outraConta ? `Conciliada com título baixado em outra conta (${i.outraConta})` : "Conciliada com título que não está baixado"),
    dica: "A linha deste dia foi ligada a um título baixado noutra conta bancária: o banco tem o valor aqui e o sistema na outra conta. Desfaça e concilie de novo (a baixa passa para esta conta), ou corrija a conta no título.",
  },
  valor_diferente: {
    rotulo: () => "Conciliada com valor diferente do título",
    dica: "O título baixado tem valor diferente da linha do banco (juros, multa ou desconto lançados a mais ou a menos). Confira o valor pago no título.",
  },
  titulo_sem_extrato: {
    rotulo: () => "Baixado no sistema, não está no extrato",
    dica: "O sistema tem esta baixa nesta conta e neste dia, mas o banco não. Confira se a conta ou a data da baixa estão certas, ou se falta importar o extrato.",
  },
  titulo_outro_dia: {
    rotulo: (i) => `Baixado neste dia, mas a linha do extrato é de ${i.outraData ? formatarData(i.outraData) : "outro dia"}`,
    dica: "Este título foi ligado a uma linha do extrato de outra data. Se a linha é de outro mês, desfaça e concilie com a linha certa deste dia.",
  },
};

// O que fez a diferença (banco − sistema) mudar no dia, item por item. A
// diferença que já vinha do dia anterior é de outro dia (link para ele).
function DiferencaDoDia({
  dia,
  banco,
  sistema,
  bancoAntes,
  sistemaAntes,
  itens,
  linkDia,
  destaque,
  podeEditar,
}: {
  dia: string;
  banco: number | null;
  sistema: number | null;
  bancoAntes: number | null;
  sistemaAntes: number | null;
  itens: ItemDiferenca[];
  linkDia: (d: string, destaque?: string) => string;
  destaque: string | null;
  podeEditar: boolean;
}) {
  const cor = (v: number) => (Math.abs(v) < 0.005 ? "text-sucesso" : "text-perigo");
  const fmt = (v: number) => (Math.abs(v) < 0.005 ? "ok" : formatarMoeda(v));
  const diferenca = banco !== null && sistema !== null ? Math.round((banco - sistema) * 100) / 100 : null;
  const antes = bancoAntes !== null && sistemaAntes !== null ? Math.round((bancoAntes - sistemaAntes) * 100) / 100 : null;
  const variacao = diferenca !== null && antes !== null ? Math.round((diferenca - antes) * 100) / 100 : null;
  const somaItens = Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100;
  const resto = variacao !== null ? Math.round((variacao - somaItens) * 100) / 100 : 0;
  // Abre o título na tela dele, já filtrada no dia da baixa.
  const linkTitulo = (i: ItemDiferenca) =>
    i.tituloTipo === "pagar"
      ? `/financeiro/pagar?${new URLSearchParams({ de: i.tituloData ?? dia, ate: i.tituloData ?? dia, por: "data_pagamento", ver: i.tituloId! })}`
      : `/financeiro/receber?${new URLSearchParams({ de: i.tituloData ?? dia, ate: i.tituloData ?? dia, por: "data_recebimento" })}`;
  return (
    <section className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <strong>{formatarData(dia)}</strong>
        {diferenca === null ? (
          <span className="text-xs text-texto-suave">O extrato importado não tem saldo do banco neste dia.</span>
        ) : (
          <>
            <span>
              Banco <strong className="tabular-nums">{formatarMoeda(banco!)}</strong>
            </span>
            <span>
              Sistema <strong className="tabular-nums">{formatarMoeda(sistema!)}</strong>
            </span>
            <span>
              Diferença <strong className={`tabular-nums ${cor(diferenca)}`}>{fmt(diferenca)}</strong>
            </span>
            {antes !== null && Math.abs(antes) >= 0.005 && (
              <span className="text-xs text-texto-suave">
                {formatarMoeda(antes)} já vinha de antes · <LinkAcao href={linkDia(somarDias(dia, -1))}>ver dia anterior</LinkAcao>
              </span>
            )}
          </>
        )}
      </p>
      {itens.length === 0 && Math.abs(resto) < 0.005 ? (
        <p className="mt-1 text-xs text-texto-suave">Neste dia banco e sistema andaram juntos: nada a resolver aqui.</p>
      ) : (
        <>
          <p className="mt-1.5 text-xs text-texto-suave">
            O que mudou a diferença neste dia
            {variacao !== null ? (
              <>
                {" "}
                (<strong className={`tabular-nums ${cor(variacao)}`}>{formatarMoeda(variacao)}</strong>)
              </>
            ) : (
              ""
            )}
            . Passe o mouse no item para ver o que fazer.
          </p>
          <ul className="divide-y divide-borda/70">
            {itens.map((i) => {
              const r = ROTULO_ITEM[i.tipo];
              const marcado = !!destaque && (destaque === i.linhaId || destaque === i.tituloId);
              return (
                <li
                  key={`${i.tipo}${i.linhaId ?? ""}${i.tituloId ?? ""}`}
                  title={r.dica}
                  className={`flex items-center gap-3 py-1 text-xs ${marcado ? "rounded bg-alerta/15 font-medium" : ""}`}
                >
                  <span className="w-80 shrink-0 truncate text-texto-suave">{r.rotulo(i)}</span>
                  <span className="min-w-0 flex-1 truncate">{i.descricao}</span>
                  <span className="flex shrink-0 items-center gap-3">
                    {i.outraData && (
                      <LinkAcao href={linkDia(i.outraData, i.tipo === "titulo_outro_dia" ? (i.linhaId ?? undefined) : (i.tituloId ?? undefined))}>
                        ir para {formatarData(i.outraData)}
                      </LinkAcao>
                    )}
                    {i.tituloId && <LinkAcao href={linkTitulo(i)}>ver título</LinkAcao>}
                    {podeEditar && i.linhaId && i.tipo !== "pendente" && i.tipo !== "titulo_sem_extrato" && (
                      <FormAcao
                        acao={desfazer.bind(null, i.linhaId)}
                        rotulo="Desfazer conciliação"
                        enviando="..."
                        discreto
                        confirmar="Desfazer esta conciliação? A linha do extrato volta para a lista do que falta conciliar e você concilia com o título certo. Título baixado pela própria conciliação volta para em aberto."
                      />
                    )}
                  </span>
                  <span className={`w-24 shrink-0 text-right tabular-nums font-medium ${i.valor < 0 ? "text-perigo" : "text-sucesso"}`}>{formatarMoeda(i.valor)}</span>
                </li>
              );
            })}
            {Math.abs(resto) >= 0.005 && (
              <li className="flex items-center gap-3 py-1 text-xs" title="Saldo inicial da conta lançado nesta data ou linha do extrato marcada como ignorada.">
                <span className="w-80 shrink-0 text-texto-suave">Saldo inicial da conta ou linha ignorada</span>
                <span className="flex-1" />
                <span className="w-24 shrink-0 text-right tabular-nums font-medium">{formatarMoeda(resto)}</span>
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

async function PaginaConciliacao({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const filtros = await searchParams;
  const podeEditar = pode(acesso, TELA, "editar");
  const hoje = hojeBrasil();

  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const [contas, pendentes] = await Promise.all([carregarContas(selecionada?.id ?? null), carregarPendentes(selecionada?.id ?? null)]);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const conta =
    contas.find((c) => c.id === filtros.conta) ?? contas.find((c) => pendentes.has(c.id)) ?? contas[0] ?? null;

  // Período: um dia (?dia=, vem da diferença do fluxo de caixa), um período
  // (?de=&ate=) ou tudo (?tudo=1). Sem nada, do 1º dia do mês passado até hoje:
  // a tela abre no que é recente, não no extrato antigo.
  const data = (v?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v! : null);
  const diaEscolhido = data(filtros.dia) ?? (data(filtros.ate) && !filtros.de ? data(filtros.ate) : null);
  const modo: "dia" | "periodo" | "tudo" = diaEscolhido ? "dia" : filtros.tudo ? "tudo" : "periodo";
  const padraoDe = `${somarDias(`${hoje.slice(0, 8)}01`, -1).slice(0, 8)}01`;
  const periodoDe = data(filtros.de) ?? padraoDe;
  const periodoAte = data(filtros.ate) ?? hoje;
  const [de, ate] = modo === "dia" ? [diaEscolhido!, diaEscolhido!] : modo === "periodo" ? [periodoDe, periodoAte] : [null, null];
  // O padrão é o que falta conciliar; as conciliadas ficam como consulta.
  const situacao = filtros.situacao === "resolvido" ? "resolvido" : "pendente";

  const [linhas, conferencia, importacoes, pendAntes, movimento, saldoBancoFn, sistemaDia, sistemaAntes] = conta
    ? await Promise.all([
        carregarLinhas(conta.id, situacao, de, ate),
        carregarConferencia(conta),
        carregarImportacoes(conta.id),
        modo === "periodo" && situacao === "pendente" ? contarPendentesAntes(conta.id, periodoDe) : Promise.resolve(0),
        modo === "dia" ? carregarMovimentoDoDia(conta.id, diaEscolhido!) : Promise.resolve(null),
        modo === "dia" ? carregarSaldoBanco(conta.id, somarDias(diaEscolhido!, -1), diaEscolhido!) : Promise.resolve(null),
        modo === "dia" ? carregarSaldoSistema(conta, diaEscolhido!) : Promise.resolve(null),
        modo === "dia" ? carregarSaldoSistema(conta, somarDias(diaEscolhido!, -1)) : Promise.resolve(null),
      ])
    : [[], null, [], 0, null, null, null, null];
  const pend = linhas.filter((l) => l.situacao === "pendente");
  const doDia = movimento && conta ? diferencaDoDia(diaEscolhido!, conta.id, movimento.linhas, movimento.titulos) : null;
  const podeExcluir = pode(acesso, TELA, "excluir");

  // Títulos candidatos (mesmo valor e data próxima), as linhas vizinhas (para
  // achar repetidas) e, no painel de resolver uma linha, candidatos mais amplos.
  const resolvendo = filtros.linha ? pend.find((l) => l.id === filtros.linha) : undefined;
  const [candidatos, vizinhas, amplos] =
    conta && pend.length
      ? await Promise.all([
          carregarCandidatos(conta, pend[0].data, pend[pend.length - 1].data),
          carregarVizinhas(conta.id, pend[0].data, pend[pend.length - 1].data),
          resolvendo && podeEditar ? carregarCandidatos(conta, resolvendo.data, resolvendo.data, 45, 30) : Promise.resolve([]),
        ])
      : [[], [], []];
  // Mesmo lançamento trazido por outra importação com a data trocada: a tela
  // aponta antes de sugerir título (conciliar as duas cópias baixaria em dobro).
  const repetidas = possiveisRepetidas(vizinhas, importacoes);
  const sugestoes = sugerirConciliacao(
    pend.filter((l) => !repetidas.has(l.id)),
    candidatos,
  );
  const porId = new Map(candidatos.map((t) => [t.id, t]));
  // Entrada sem título de mesmo valor: pode ser antecipação (a receber − juros a pagar).
  const antecipacoes = sugerirAntecipacao(
    pend.filter((l) => !repetidas.has(l.id) && !sugestoes.has(l.id)),
    candidatos,
    new Set([...sugestoes.values()].flatMap((x) => x.titulos)),
  );

  // Endereço com os filtros atuais (conta, situação e período) mais `extra`.
  const filtroPeriodo: Record<string, string | undefined> =
    modo === "dia" ? { dia: diaEscolhido! } : modo === "tudo" ? { tudo: "1" } : filtros.de || filtros.ate ? { de: periodoDe, ate: periodoAte } : {};
  const base = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const tudo = { conta: conta?.id, situacao: situacao === "pendente" ? undefined : situacao, ...filtroPeriodo, ...extra };
    for (const [k, v] of Object.entries(tudo)) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const linkDia = (d: string, destaque?: string) =>
    `?${new URLSearchParams({ ...(conta ? { conta: conta.id } : {}), dia: d, ...(destaque ? { destaque } : {}) }).toString()}`;
  const somaPend = pend.reduce((s, l) => s + Number(l.valor), 0);
  const pares = [...sugestoes.entries()].map(([linha, s]) => ({
    linha,
    tipo: porId.get(s.titulos[0])?.tipo,
    titulos: s.titulos,
  }));
  // Linha sem título: transferência do grupo, tarifa, rendimento ou cobrança.
  const marcas = marcasDoGrupo(empresas.map((e) => e.nome));
  const natureza = new Map(
    pend.filter((l) => !sugestoes.has(l.id) && !repetidas.has(l.id) && !antecipacoes.has(l.id)).flatMap((l) => {
      const n = naturezaSemTitulo(l.descricao, Number(l.valor), marcas);
      return n ? [[l.id, n] as const] : [];
    }),
  );
  const listaRepetidas = pend.filter((l) => repetidas.has(l.id)).map((l) => l.id);
  const transferencias = [...natureza].filter(([, n]) => n.tipo === "transferencia").map(([id]) => id);
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
  const totalPendConta = conta ? (pendentes.get(conta.id) ?? 0) : 0;

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
            parametros={Object.fromEntries(
              Object.entries({ situacao: situacao === "pendente" ? undefined : situacao, ...filtroPeriodo }).filter(
                (x): x is [string, string] => !!x[1],
              ),
            )}
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
          {/* Filtros numa linha: período e o que mostrar; ações em lote à direita. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <SeletorPeriodo
              modo={modo}
              dia={diaEscolhido ?? hoje}
              de={periodoDe}
              ate={periodoAte}
              parametros={Object.fromEntries(
                Object.entries({ conta: conta?.id, situacao: situacao === "pendente" ? undefined : situacao }).filter((x): x is [string, string] => !!x[1]),
              )}
            />
            <span className="text-xs text-texto-suave">
              {situacao === "pendente" ? (
                <>
                  <strong className="text-texto">{pend.length}</strong> a conciliar
                  {pend.length > 0 && <span className="tabular-nums"> ({formatarMoeda(somaPend)})</span>}
                  {modo !== "tudo" && totalPendConta > pend.length && (
                    <>
                      {" "}de {totalPendConta} na conta
                      {pendAntes > 0 && (
                        <>
                          {" "}· {pendAntes} antes de {formatarData(periodoDe)} <LinkAcao href={base({ tudo: "1", dia: undefined, de: undefined, ate: undefined })}>ver tudo</LinkAcao>
                        </>
                      )}
                    </>
                  )}
                  {" · "}
                  <LinkAcao href={base({ situacao: "resolvido" })}>ver as já conciliadas</LinkAcao>
                </>
              ) : (
                <>
                  <strong className="text-texto">{linhas.length}</strong> já conciliada(s) ou resolvida(s) no período ·{" "}
                  <LinkAcao href={base({ situacao: undefined })}>voltar para o que falta conciliar</LinkAcao>
                </>
              )}
            </span>
            {conferencia && conferencia.banco !== null && conferencia.sistema !== null && (
              <span
                className="text-xs text-texto-suave"
                title={`Último extrato: ${conferencia.arquivo ?? "leitura do banco"}, importado em ${formatarData(conferencia.importadoEm)}. Sistema = saldo inicial da conta + recebidos − pagos + transferências até a mesma data.`}
              >
                Fim do último extrato ({formatarData(conferencia.ate)}): diferença{" "}
                <strong className={`tabular-nums ${Math.abs(conferencia.banco - conferencia.sistema) > 0.009 ? "text-perigo" : "text-sucesso"}`}>
                  {Math.abs(conferencia.banco - conferencia.sistema) > 0.009 ? formatarMoeda(conferencia.banco - conferencia.sistema) : "ok"}
                </strong>
              </span>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-2">
            {podeEditar && listaRepetidas.length > 1 && (
              <FormAcao
                acao={marcarRepetidas}
                rotulo={`Tirar ${listaRepetidas.length} repetidas`}
                enviando="Marcando..."
                secundario
                confirmar={`Marcar ${listaRepetidas.length} linha(s) como repetidas de outra importação? Elas saem da lista de pendentes (dá para desfazer em "ver as já conciliadas").`}
              >
                <input type="hidden" name="linhas" value={JSON.stringify(listaRepetidas)} />
              </FormAcao>
            )}
            {podeEditar && transferencias.length > 1 && (
              <FormAcao
                acao={marcarTransferencias}
                rotulo={`Marcar ${transferencias.length} transferências do grupo`}
                enviando="Marcando..."
                secundario
                confirmar={`Marcar ${transferencias.length} linha(s) como transferência entre empresas do grupo? Elas saem da lista de pendentes.`}
              >
                <input type="hidden" name="linhas" value={JSON.stringify(transferencias)} />
              </FormAcao>
            )}
            {podeEditar && pares.length > 1 && (
              <FormAcao acao={conciliarSugestoes} rotulo={`Aceitar as ${pares.length} sugestões`} enviando="Conciliando..." secundario>
                <input type="hidden" name="pares" value={JSON.stringify(pares)} />
              </FormAcao>
            )}
            </span>
          </div>

          {modo === "dia" && doDia && (
            <DiferencaDoDia
              dia={diaEscolhido!}
              banco={saldoBancoFn ? saldoBancoFn(diaEscolhido!) : null}
              sistema={sistemaDia}
              bancoAntes={saldoBancoFn ? saldoBancoFn(somarDias(diaEscolhido!, -1)) : null}
              sistemaAntes={sistemaAntes}
              itens={doDia.itens}
              linkDia={linkDia}
              destaque={filtros.destaque ?? null}
              podeEditar={podeEditar}
            />
          )}

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
              candidatos={amplos}
              linkCriar={linkCriar(resolvendo)}
              voltar={base({})}
            />
          )}

          <Tabela
            colunas={["Data", "Lançamento do extrato", "Valor", "Saldo", "Conciliação", ""]}
            vazio={
              situacao === "pendente"
                ? !totalPendConta
                  ? "Nada a conciliar nesta conta. Importe o extrato mais recente para continuar."
                  : modo === "dia"
                    ? "Nada a conciliar neste dia."
                    : "Nada a conciliar neste período."
                : "Nada conciliado neste período."
            }
          >
            {linhas.map((l) => {
              const repetida = l.situacao === "pendente" ? repetidas.get(l.id) : undefined;
              const s = sugestoes.get(l.id);
              const titulo = s ? porId.get(s.titulos[0]) : undefined;
              const ant = l.situacao === "pendente" ? antecipacoes.get(l.id) : undefined;
              const [antR, antP] = ant ? [porId.get(ant.titulos[0])!, porId.get(ant.titulos[1])!] : [];
              const valor = Number(l.valor);
              return (
                <tr key={l.id} className={l.id === resolvendo?.id ? "bg-primaria-suave/50" : l.id === filtros.destaque ? "bg-alerta/15" : ""}>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarData(l.data)}</Celula>
                  <Celula className="max-w-md">
                    <span className="block truncate" title={`${l.descricao}${l.documento ? ` · doc ${l.documento}` : ""}`}>
                      <span className="font-medium">{l.descricao}</span>
                      {l.documento && <span className="text-xs text-texto-suave"> · doc {l.documento}</span>}
                    </span>
                  </Celula>
                  <Celula className={`whitespace-nowrap text-right tabular-nums font-medium ${valor < 0 ? "text-perigo" : "text-sucesso"}`}>
                    {formatarMoeda(valor)}
                  </Celula>
                  <Celula className="whitespace-nowrap text-right tabular-nums text-texto-suave">{l.saldo === null ? "" : formatarMoeda(Number(l.saldo))}</Celula>
                  <Celula>
                    {l.situacao !== "pendente" ? (
                      <Ligacoes linha={l} />
                    ) : repetida ? (
                      <span
                        className="text-xs text-alerta"
                        title="Outra importação desta conta tem o mesmo valor num dia vizinho e não tem este dia: costuma ser o mesmo lançamento com a data trocada (data da operação x data do lançamento). Confira antes de marcar."
                      >
                        Parece repetida: mesmo valor em {formatarData(repetida.data)} noutra importação{repetida.resolvida ? " (já resolvida)" : ""}
                      </span>
                    ) : antR && antP ? (
                      <span className="text-xs" title={ant!.motivo}>
                        <Etiqueta cor="primaria">Antecipação</Etiqueta> {antR.pessoa ? `${antR.pessoa} · ` : ""}
                        {antR.descricao} {formatarMoeda(antR.valor)} − {antP.pessoa ? `${antP.pessoa} · ` : ""}
                        {antP.descricao} {formatarMoeda(antP.valor)}
                      </span>
                    ) : titulo ? (
                      <span className="text-xs" title={s!.motivo}>
                        <Etiqueta cor="primaria">Sugestão</Etiqueta> {titulo.pessoa ? `${titulo.pessoa} · ` : ""}
                        {titulo.descricao} · {titulo.pago ? "pago" : "vence"} {formatarData(titulo.data)}
                      </span>
                    ) : natureza.get(l.id) ? (
                      <span className="text-xs text-alerta">{natureza.get(l.id)!.dica}</span>
                    ) : (
                      <span className="text-xs text-texto-suave" title="Nenhum título em aberto ou pago nesta conta com o mesmo valor perto desta data">
                        {l.data < hoje ? "nenhum título com este valor" : ""}
                      </span>
                    )}
                  </Celula>
                  <Celula className="whitespace-nowrap text-right">
                    {podeEditar && (
                      <div className="flex items-center justify-end gap-3">
                        {l.situacao === "pendente" ? (
                          <>
                            {repetida && (
                              <FormAcao acao={marcarRepetida.bind(null, l.id)} rotulo="É repetida" enviando="..." discreto />
                            )}
                            {antR && antP && (
                              <FormAcao acao={conciliar.bind(null, l.id, [antP.id], [antR.id])} rotulo="Conciliar" enviando="..." discreto />
                            )}
                            {titulo && (
                              <FormAcao
                                acao={conciliar.bind(null, l.id, titulo.tipo === "pagar" ? [titulo.id] : [], titulo.tipo === "receber" ? [titulo.id] : [])}
                                rotulo="Conciliar"
                                enviando="..."
                                discreto
                              />
                            )}
                            {!titulo && natureza.get(l.id)?.tipo === "transferencia" && (
                              <FormAcao acao={marcarTransferencia.bind(null, l.id)} rotulo="É transferência" enviando="..." discreto />
                            )}
                            {!titulo && !repetida && !ant && !["transferencia", "aplicacao"].includes(natureza.get(l.id)?.tipo ?? "") && (
                              <LinkAcao href={linkCriar(l)}>Criar título</LinkAcao>
                            )}
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
