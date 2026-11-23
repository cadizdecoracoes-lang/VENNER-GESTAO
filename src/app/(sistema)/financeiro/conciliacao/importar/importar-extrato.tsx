"use client";

import { ArrowLeftRight, ChevronDown, ChevronRight, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Campo, Cartao, estiloBotao, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import {
  acharCabecalhoExtrato,
  CAMPOS_EXTRATO,
  lerOfx,
  lerPlanilhaExtrato,
  mapearColunasExtrato,
  type CampoExtrato,
  type ExtratoLido,
  type LinhaExtrato,
  type MapaExtrato,
} from "@/lib/extrato";
import {
  contaDoArquivo,
  contarRepetidas,
  escolherConta,
  guardarConta,
  mesmoNumero,
  nomeDoBanco,
  type ContaCadastrada,
  type ContaDoArquivo,
} from "@/lib/extrato-identificar";
import { lerExtratoPdf, textoLinha } from "@/lib/extrato-pdf";
import { formatarData, formatarMoeda } from "@/lib/formato";
import type { Celula } from "@/lib/plataformas/planilha";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { gravarExtrato, terminarImportacao } from "../actions";
import { linhasDoPdf } from "./ler-pdf";

type Conta = ContaCadastrada & { empresa: string };
type Origem = "ofx" | "planilha" | "pdf";

// Um arquivo escolhido: o que foi lido, a conta e os ajustes da conferência.
type Arquivo = {
  id: number;
  nome: string;
  origem: Origem | null;
  lendo: boolean;
  progresso: string | null;
  erro: string | null;
  lido: ExtratoLido | null;
  planilha: Celula[][] | null;
  cabecalho: number;
  mapa: MapaExtrato;
  identificado: ContaDoArquivo | null;
  // Conta escolhida pela pessoa (null = a que o sistema achou).
  manual: string | null;
  // Linhas retiradas e sinais invertidos na conferência.
  fora: Set<number>;
  invertidas: Set<number>;
};

// CSV com ";" ou ",", aspas e quebras de linha dentro das aspas.
function lerCsv(texto: string): Celula[][] {
  const primeira = texto.slice(0, texto.indexOf("\n") + 1 || undefined);
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        celula += '"';
        i++;
      } else if (c === '"') aspas = false;
      else celula += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(celula);
      celula = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(celula);
      linhas.push(linha);
      linha = [];
      celula = "";
    } else celula += c;
  }
  if (celula || linha.length) linhas.push([...linha, celula]);
  return linhas;
}

// OFX e CSV de banco costumam vir em Windows-1252 (acentos).
async function lerTexto(f: File): Promise<string> {
  const bytes = await f.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Lê um arquivo (OFX, PDF, Excel ou CSV) e acha banco, agência, conta e CNPJ.
async function lerArquivo(f: File, progresso: (t: string) => void): Promise<Partial<Arquivo>> {
  if (/\.ofx$/i.test(f.name)) {
    const texto = await lerTexto(f);
    const lido = lerOfx(texto);
    return { origem: "ofx", lido, identificado: contaDoArquivo(f.name, texto.slice(0, 3000), lido) };
  }
  if (/\.pdf$/i.test(f.name)) {
    const { linhas, ocr } = await linhasDoPdf(f, progresso);
    const lido = lerExtratoPdf(linhas, { ocr });
    return { origem: "pdf", lido, identificado: contaDoArquivo(f.name, linhas.slice(0, 40).map(textoLinha).join("\n"), lido) };
  }
  if (/\.(xlsx|csv|txt)$/i.test(f.name)) {
    let dados: Celula[][];
    if (/\.xlsx$/i.test(f.name)) {
      const { default: lerXlsx } = await import("read-excel-file");
      dados = (await lerXlsx(f)) as Celula[][];
    } else dados = lerCsv(await lerTexto(f));
    const cab = Math.max(0, acharCabecalhoExtrato(dados));
    const topo = dados
      .slice(0, Math.max(cab, 1) + 2)
      .map((l) => l.map((c) => String(c ?? "")).join(" | "))
      .join("\n");
    return { origem: "planilha", planilha: dados, cabecalho: cab, mapa: mapearColunasExtrato(dados[cab] ?? []), identificado: contaDoArquivo(f.name, topo, null) };
  }
  if (/\.xls$/i.test(f.name)) throw new Error("Arquivo .xls antigo: abra no Excel e salve como .xlsx, ou baixe o extrato em OFX.");
  throw new Error("Use o extrato em OFX, Excel (.xlsx), CSV ou PDF.");
}

function leituraDe(a: Arquivo): ExtratoLido | null {
  return a.origem === "planilha" && a.planilha ? lerPlanilhaExtrato(a.planilha, a.cabecalho + 1, a.mapa) : a.lido;
}

// Linhas com os ajustes da conferência (sinal invertido) e as que valem (fora as retiradas).
function linhasDe(a: Arquivo) {
  const todas: (LinhaExtrato & { i: number })[] = (leituraDe(a)?.linhas ?? []).map((l, i) => ({ ...l, i, valor: a.invertidas.has(i) ? -l.valor : l.valor }));
  return { todas, valendo: todas.filter((l) => !a.fora.has(l.i)) };
}

const somar = (ls: { valor: number }[], sinal: 1 | -1) => ls.filter((l) => l.valor * sinal > 0).reduce((s, l) => s + l.valor, 0);

type Existente = { data: string; valor: number; importacao: string };

// Linhas que a conta já tem no período (para mostrar o que já está no sistema).
async function carregarExistentes(conta: string, de: string, ate: string): Promise<Existente[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const saida: Existente[] = [];
  for (let pagina = 0; pagina < 20; pagina++) {
    const { data, error } = await supabase
      .from("extrato_lancamentos")
      .select("data, valor, importacao_id")
      .eq("conta_bancaria_id", conta)
      .gte("data", de)
      .lte("data", ate)
      .order("id")
      .range(pagina * 1000, pagina * 1000 + 999);
    if (error) throw error;
    saida.push(...(data ?? []).map((l) => ({ data: l.data as string, valor: Number(l.valor), importacao: String(l.importacao_id) })));
    if ((data ?? []).length < 1000) break;
  }
  return saida;
}

export function ImportarExtrato({
  contas,
  empresas,
  contaInicial,
  versao,
}: {
  contas: Conta[];
  empresas: { id: string; cnpj: string | null }[];
  contaInicial: string;
  // Muda a cada atualização da tela (ao vivo): busca de novo o que já está no sistema.
  versao: number;
}) {
  const [arquivos, setArquivos] = useState<Arquivo[]>([]);
  const [aberto, setAberto] = useState<number | null>(null);
  const [existentes, setExistentes] = useState<Map<string, Existente[]>>(new Map());
  const [gravando, setGravando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const proximo = useRef(1);
  const entrada = useRef<HTMLInputElement>(null);

  const mudar = (id: number, m: Partial<Arquivo>) => setArquivos((as) => as.map((a) => (a.id === id ? { ...a, ...m } : a)));

  // Lê um arquivo de cada vez (o PDF por imagem é pesado).
  async function escolher(lista: FileList | null) {
    if (!lista?.length) return;
    setErro(null);
    const novos: [Arquivo, File][] = [...lista].map((f) => [
      {
        id: proximo.current++,
        nome: f.name,
        origem: null,
        lendo: true,
        progresso: null,
        erro: null,
        lido: null,
        planilha: null,
        cabecalho: 0,
        mapa: {},
        identificado: null,
        manual: null,
        fora: new Set(),
        invertidas: new Set(),
      },
      f,
    ]);
    setArquivos((as) => [...as, ...novos.map(([a]) => a)]);
    if (entrada.current) entrada.current.value = "";
    for (const [a, f] of novos) {
      try {
        mudar(a.id, { ...(await lerArquivo(f, (t) => mudar(a.id, { progresso: t }))), lendo: false, progresso: null });
      } catch (e) {
        mudar(a.id, { erro: e instanceof Error ? e.message : typeof e === "string" ? e : "Não foi possível ler o arquivo.", lendo: false, progresso: null });
      }
    }
  }

  const porId = useMemo(() => new Map(contas.map((c) => [c.id, c])), [contas]);

  // Conta de cada arquivo (a escolhida pela pessoa ou a achada) e o resumo.
  const itens = arquivos.map((a) => {
    const escolha = a.identificado ? escolherConta(a.identificado, contas, empresas) : null;
    const desempate = escolha && !escolha.conta && escolha.possiveis.includes(contaInicial) ? contaInicial : null;
    // Escolhida a conta de um arquivo, os outros com o mesmo número de conta vão junto.
    const irmao =
      !a.manual && !escolha?.conta && a.identificado?.numero
        ? arquivos.find((x) => x.manual && x.identificado?.banco === a.identificado!.banco && mesmoNumero(x.identificado?.numero, a.identificado!.numero))
        : undefined;
    const conta = a.manual ?? escolha?.conta ?? irmao?.manual ?? desempate ?? "";
    const { todas, valendo } = linhasDe(a);
    const datas = valendo.map((l) => l.data).sort();
    return { a, escolha, irmao: irmao?.nome ?? null, conta, todas, valendo, de: datas[0] ?? null, ate: datas[datas.length - 1] ?? null, leitura: leituraDe(a) };
  });

  // Período de cada conta (todos os arquivos dela) para buscar o que já está no sistema.
  const periodos = new Map<string, { de: string; ate: string }>();
  for (const i of itens) {
    if (!i.conta || !i.de || !i.ate) continue;
    const p = periodos.get(i.conta);
    periodos.set(i.conta, { de: !p || i.de < p.de ? i.de : p.de, ate: !p || i.ate > p.ate ? i.ate : p.ate });
  }
  const chavePeriodos = [...periodos].map(([c, p]) => `${c}:${p.de}:${p.ate}`).join(",");

  useEffect(() => {
    let vale = true;
    const pedidos = chavePeriodos ? chavePeriodos.split(",") : [];
    Promise.all(
      pedidos.map(async (p) => {
        const [conta, de, ate] = p.split(":");
        return [conta, await carregarExistentes(conta, de, ate).catch(() => [])] as const;
      }),
    ).then((r) => vale && setExistentes(new Map(r)));
    return () => {
      vale = false;
    };
  }, [chavePeriodos, versao]);

  // Já no sistema: o que a conta tem mais os arquivos anteriores desta lista na mesma conta.
  const repetidas = new Map<number, number>();
  const daLista = new Map<string, Existente[]>();
  for (const i of itens) {
    if (!i.conta) continue;
    const antes = daLista.get(i.conta) ?? [];
    repetidas.set(i.a.id, contarRepetidas(i.valendo, [...(existentes.get(i.conta) ?? []), ...antes]));
    daLista.set(i.conta, [...antes, ...i.valendo.map((l) => ({ data: l.data, valor: l.valor, importacao: `lista-${i.a.id}` }))]);
  }

  const lendo = itens.some((i) => i.a.lendo);
  const prontos = itens.filter((i) => !i.a.erro && !i.a.lendo && i.valendo.length > 0);
  const semConta = prontos.filter((i) => !i.conta);
  const totalLinhas = prontos.reduce((s, i) => s + i.valendo.length, 0);
  const totalNovas = prontos.reduce((s, i) => s + i.valendo.length - (repetidas.get(i.a.id) ?? 0), 0);

  async function importar() {
    setErro(null);
    let importadas = 0;
    let repet = 0;
    const feitas: string[] = [];
    let n = 0;
    for (const i of prontos) {
      setGravando(`Importando ${++n} de ${prontos.length}: ${i.a.nome}...`);
      const r = await gravarExtrato({
        conta: i.conta,
        origem: i.a.origem!,
        arquivo: i.a.nome,
        saldoFinal: i.leitura?.saldoFinal ?? null,
        contaNoArquivo: i.a.identificado ? guardarConta(i.a.identificado) : null,
        linhas: i.valendo,
      });
      if ("erro" in r) {
        setGravando(null);
        setErro(`${n - 1} de ${prontos.length} arquivo(s) importado(s). Parou em ${i.a.nome}: ${r.erro}`);
        return;
      }
      importadas += r.importadas;
      repet += r.repetidas;
      if (!feitas.includes(i.conta)) feitas.push(i.conta);
      // Já gravado: sai da lista (importar de novo não repete, mas não precisa).
      setArquivos((as) => as.filter((a) => a.id !== i.a.id));
    }
    setGravando("Conciliando o que bate com os títulos...");
    await terminarImportacao(feitas, prontos.length, importadas, repet);
  }

  const detalhe = itens.find((i) => i.a.id === aberto) ?? null;

  return (
    <div className="space-y-3">
      <Cartao>
        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="Arquivos do banco" dica="Pode escolher vários de uma vez (bancos, contas e meses diferentes). OFX é o mais exato; aceita também Excel (.xlsx), CSV e PDF.">
            <input
              ref={entrada}
              type="file"
              multiple
              accept=".ofx,.xlsx,.xls,.csv,.txt,.pdf"
              onChange={(e) => escolher(e.target.files)}
              className={`${estiloCampo} sm:w-96`}
            />
          </Campo>
          {arquivos.length > 0 && (
            <p className="pb-1.5 text-sm text-texto-suave">
              {arquivos.length} arquivo(s) · {totalLinhas} lançamento(s) · <span className="text-texto">{totalNovas} novo(s)</span>
              {totalLinhas - totalNovas > 0 && `, ${totalLinhas - totalNovas} já no sistema`}
            </p>
          )}
        </div>
        {arquivos.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-texto-suave">
                  <th className="px-2 py-1.5 font-medium">Arquivo</th>
                  <th className="px-2 py-1.5 font-medium">Conta no sistema</th>
                  <th className="px-2 py-1.5 font-medium">Período</th>
                  <th className="px-2 py-1.5 text-right font-medium">Lançamentos</th>
                  <th className="px-2 py-1.5 text-right font-medium">Entradas</th>
                  <th className="px-2 py-1.5 text-right font-medium">Saídas</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borda/70">
                {itens.map((i) => {
                  const { a, escolha } = i;
                  const escolhida = porId.get(i.conta);
                  const lida = a.identificado;
                  // Número lido no arquivo diferente do que se sabe da conta escolhida.
                  const conhecidos = escolhida ? [escolhida.conta, ...escolhida.vistos].filter((n): n is string => !!n) : [];
                  const outraConta = !!lida?.numero && conhecidos.length > 0 && !conhecidos.some((n) => mesmoNumero(n, lida.numero));
                  const amarelo = !a.lendo && !a.erro && (!i.conta || outraConta);
                  const rep = repetidas.get(a.id) ?? 0;
                  return (
                    <tr key={a.id} className={a.erro ? "bg-perigo/5" : amarelo ? "bg-alerta/10" : ""}>
                      <td className="max-w-[18rem] px-2 py-1">
                        <button
                          type="button"
                          onClick={() => setAberto(aberto === a.id ? null : a.id)}
                          disabled={a.lendo || !!a.erro}
                          className="flex items-center gap-1 text-left hover:text-primaria disabled:hover:text-texto"
                          title="Conferir as linhas deste arquivo"
                        >
                          {aberto === a.id ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                          <span className="truncate">{a.nome}</span>
                        </button>
                        {lida && (lida.banco || lida.numero) && (
                          <span className="ml-5 text-xs text-texto-suave">
                            {[lida.banco ? nomeDoBanco(lida.banco) : null, lida.agencia ? `ag ${lida.agencia}` : null, lida.numero ? `conta ${lida.numero}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </td>
                      {a.lendo || a.erro ? (
                        <td colSpan={5} className={`px-2 py-1 ${a.erro ? "text-perigo" : "text-texto-suave"}`}>
                          {a.erro ?? a.progresso ?? "Lendo o arquivo..."}
                        </td>
                      ) : (
                        <>
                          <td className="px-2 py-1">
                            <select
                              value={i.conta}
                              onChange={(e) => mudar(a.id, { manual: e.target.value || null })}
                              className={`${estiloCampo} min-w-[12rem] py-1`}
                              title={escolha?.motivo}
                            >
                              <option value="">Escolha a conta...</option>
                              {[...(escolha?.possiveis ?? []).map((id) => porId.get(id)!), ...contas.filter((c) => !escolha?.possiveis.includes(c.id))].map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nome} · {c.empresa}
                                </option>
                              ))}
                            </select>
                            <span className={`block text-xs ${amarelo ? "text-alerta" : "text-texto-suave"}`}>
                              {outraConta
                                ? `o arquivo é da conta ${lida?.numero} e esta é ${conhecidos.join(" / ")}: confira`
                                : a.manual
                                  ? "escolhida por você"
                                  : i.irmao && !escolha?.conta
                                    ? `mesma conta do arquivo ${i.irmao}`
                                  : escolha?.conta
                                    ? `achada ${escolha.motivo}`
                                    : (escolha?.motivo ?? "escolha a conta")}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums">{i.de ? `${formatarData(i.de)} a ${formatarData(i.ate!)}` : "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                            {i.valendo.length}
                            {i.conta && rep > 0 && (
                              <span className="text-xs text-texto-suave" title="Mesma data e valor já importados nesta conta: não entram de novo">
                                {" "}
                                · {rep === i.valendo.length ? "todos já no sistema" : `${rep} já no sistema`}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-sucesso">{formatarMoeda(somar(i.valendo, 1))}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-perigo">{formatarMoeda(somar(i.valendo, -1))}</td>
                        </>
                      )}
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          title="Tirar este arquivo"
                          onClick={() => {
                            setArquivos((as) => as.filter((x) => x.id !== a.id));
                            if (aberto === a.id) setAberto(null);
                          }}
                          className="p-1 text-texto-suave hover:text-perigo"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {arquivos.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={importar} disabled={lendo || !!gravando || !prontos.length || semConta.length > 0} className={estiloBotao}>
              {gravando ? "Importando..." : `Importar ${prontos.length} arquivo(s)`}
            </button>
            <Link href="/financeiro/conciliacao" className={estiloBotaoSecundario}>
              Cancelar
            </Link>
            {gravando ? (
              <span className="text-sm text-texto-suave">{gravando}</span>
            ) : lendo ? (
              <span className="text-sm text-texto-suave">Lendo os arquivos...</span>
            ) : semConta.length > 0 ? (
              <span className="text-sm text-alerta">Escolha a conta de {semConta.length} arquivo(s) em amarelo, ou tire-os da lista.</span>
            ) : (
              <span className="text-xs text-texto-suave">Lançamentos que já estão no sistema são reconhecidos e não entram de novo.</span>
            )}
            {erro && <p className="w-full text-sm text-perigo">{erro}</p>}
          </div>
        )}
      </Cartao>

      {detalhe && <Conferencia item={detalhe} mudar={(m) => mudar(detalhe.a.id, m)} />}
    </div>
  );
}

// Conferência das linhas de um arquivo: colunas da planilha, sinal e linhas a tirar.
function Conferencia({
  item,
  mudar,
}: {
  item: { a: Arquivo; todas: (LinhaExtrato & { i: number })[]; leitura: ExtratoLido | null };
  mudar: (m: Partial<Arquivo>) => void;
}) {
  const { a, todas: linhas, leitura } = item;
  const colunas = a.planilha?.[a.cabecalho] ?? [];
  const aplicacoes = linhas.filter((l) => l.aplicacao && !a.fora.has(l.i));
  const aConferir = linhas.filter((l) => (l.conferir || (l.sinalIncerto && !a.invertidas.has(l.i))) && !a.fora.has(l.i)).length;
  const alternar = (campo: "fora" | "invertidas", i: number) => {
    const n = new Set(a[campo]);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    mudar({ [campo]: n });
  };

  return (
    <>
      {a.origem === "planilha" && a.planilha && (
        <Cartao titulo={`Colunas da planilha · ${a.nome}`}>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Campo rotulo="Linha do cabeçalho">
              <input
                type="number"
                min={1}
                max={a.planilha.length}
                value={a.cabecalho + 1}
                onChange={(e) => {
                  const c = Math.max(0, Number(e.target.value) - 1);
                  mudar({ cabecalho: c, mapa: mapearColunasExtrato(a.planilha![c] ?? []) });
                }}
                className={estiloCampo}
              />
            </Campo>
            {(Object.keys(CAMPOS_EXTRATO) as CampoExtrato[]).map((campo) => (
              <Campo key={campo} rotulo={CAMPOS_EXTRATO[campo]}>
                <select
                  value={a.mapa[campo] ?? ""}
                  onChange={(e) => mudar({ mapa: { ...a.mapa, [campo]: e.target.value === "" ? undefined : Number(e.target.value) } })}
                  className={estiloCampo}
                >
                  <option value="">—</option>
                  {colunas.map((c, i) => (
                    <option key={i} value={i}>
                      {String(c ?? `Coluna ${i + 1}`)}
                    </option>
                  ))}
                </select>
              </Campo>
            ))}
          </div>
        </Cartao>
      )}

      <Cartao
        titulo={`Confira · ${a.nome}`}
        acoes={
          <span className="flex flex-wrap items-center gap-3 text-xs">
            {aConferir > 0 && <span className="text-alerta">{aConferir} linha(s) em amarelo para conferir</span>}
            {aplicacoes.length > 0 && (
              <button
                type="button"
                title="Aplicação e resgate automáticos do banco (ex.: BB Rende Fácil): não têm título no pagar/receber"
                onClick={() => mudar({ fora: new Set([...a.fora, ...aplicacoes.map((l) => l.i)]) })}
                className="text-primaria hover:underline"
              >
                Tirar {aplicacoes.length} aplicação(ões) automática(s)
              </button>
            )}
          </span>
        }
      >
        {leitura && (
          <p className="mb-2 text-xs text-texto-suave">
            {[
              (leitura.saldoInicial ?? null) !== null ? `Saldo anterior ${formatarMoeda(leitura.saldoInicial!)}` : null,
              leitura.saldoFinal !== null ? `saldo final informado ${formatarMoeda(leitura.saldoFinal)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {leitura?.avisos.map((t) => (
          <p key={t} className={`mb-1 text-sm ${t.startsWith("Conferido") ? "text-sucesso" : "text-alerta"}`}>
            {t}
          </p>
        ))}
        {linhas.length === 0 ? (
          <p className="text-sm text-texto-suave">Nenhum lançamento lido neste arquivo.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-superficie">
                <tr className="text-left text-xs text-texto-suave">
                  <th className="px-2 py-1.5 font-medium">Data</th>
                  <th className="px-2 py-1.5 font-medium">Lançamento</th>
                  <th className="px-2 py-1.5 text-right font-medium">Valor</th>
                  <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borda/70">
                {linhas.map((l) => (
                  <tr
                    key={l.i}
                    className={
                      a.fora.has(l.i) ? "text-texto-suave line-through" : l.conferir || (l.sinalIncerto && !a.invertidas.has(l.i)) ? "bg-alerta/10" : ""
                    }
                  >
                    <td className="whitespace-nowrap px-2 py-1 tabular-nums">{formatarData(l.data)}</td>
                    <td className="px-2 py-1">
                      {l.descricao}
                      {l.documento && <span className="text-xs text-texto-suave"> · doc {l.documento}</span>}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${l.valor < 0 ? "text-perigo" : "text-sucesso"}`}>{formatarMoeda(l.valor)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-texto-suave">{l.saldo === null ? "" : formatarMoeda(l.saldo)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      <button type="button" title="Inverter entrada/saída" onClick={() => alternar("invertidas", l.i)} className="p-1 text-texto-suave hover:text-texto">
                        <ArrowLeftRight size={14} />
                      </button>
                      <button type="button" title="Tirar da importação" onClick={() => alternar("fora", l.i)} className="p-1 text-texto-suave hover:text-perigo">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  );
}
