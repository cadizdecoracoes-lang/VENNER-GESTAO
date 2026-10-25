"use client";

import { ArrowLeft, CheckCircle2, CopyPlus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { FormAcao } from "@/components/form-acao";
import {
  CabecalhoTela,
  Campo,
  Cartao,
  Celula,
  Etiqueta,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode, type Acesso } from "@/lib/acesso";
import { custoComponente, custoOperacao, custoPadrao, quantidadeComPerda } from "@/lib/custo";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/formato";
import { STATUS_FICHA, TIPOS_COM_FICHA, TIPOS_ITEM, type StatusFicha, type TipoItem } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import {
  adicionarComponente,
  adicionarOperacao,
  ativarVersao,
  criarVersao,
  excluirRascunho,
  removerComponente,
  removerOperacao,
  salvarDadosVersao,
} from "./actions";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "producao.ficha_tecnica";

type Item = { id: string; codigo: string; descricao: string; tipo: TipoItem; unidade: string; custo_medio: number; ativo: boolean };
type Ficha = {
  id: string;
  item_id: string;
  versao: number;
  status: StatusFicha;
  vigencia_inicio: string | null;
  quantidade_base: number;
  observacao: string | null;
};
type Componente = {
  id: string;
  quantidade: number;
  perda_percentual: number;
  item: Pick<Item, "codigo" | "descricao" | "unidade" | "custo_medio" | "tipo">;
};
type Operacao = {
  id: string;
  sequencia: number;
  descricao: string;
  tempo_setup_min: number;
  tempo_execucao_min: number;
  instrucoes: string | null;
  posto: { nome: string; custo_hora: number } | null;
};
type Posto = { id: string; nome: string };

const COR_STATUS = { rascunho: "alerta", ativa: "sucesso", substituida: "neutra" } as const;

async function PaginaFichaTecnica({ searchParams }: { searchParams: Promise<{ item?: string; versao?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const { item, versao } = await searchParams;
  return item ? DetalheFicha({ acesso, itemId: item, versao: Number(versao) || undefined }) : ListaProdutos();
}

// -----------------------------------------------------------------------------
// Lista de produtos e subconjuntos, com a situação da ficha de cada um
// -----------------------------------------------------------------------------
async function ListaProdutos() {
  let itens: Item[] = [];
  let fichas: Pick<Ficha, "item_id" | "versao" | "status" | "vigencia_inicio">[] = [];
  if (supabaseConfigurado) {
    const supabase = criarClienteNavegador();
    const consulta = supabase
      .from("itens")
      .select("id, codigo, descricao, tipo, unidade, custo_medio, ativo")
      .in("tipo", TIPOS_COM_FICHA)
      .order("codigo")
      .limit(2000);
    const [r1, r2] = await Promise.all([
      consulta,
      supabase.from("fichas_tecnicas").select("item_id, versao, status, vigencia_inicio").in("status", ["ativa", "rascunho"]),
    ]);
    itens = (r1.data ?? []) as Item[];
    fichas = (r2.data ?? []) as typeof fichas;
  }

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} />
      <Filtro
        atalhos={[
          { rotulo: "Tipo", opcoes: TIPOS_COM_FICHA.map((valor) => ({ valor, rotulo: TIPOS_ITEM[valor] })) },
          {
            rotulo: "Ficha",
            opcoes: [
              { valor: "com_ficha", rotulo: "Com ficha ativa" },
              { valor: "sem_ficha", rotulo: "Sem ficha ativa" },
              { valor: "em_revisao", rotulo: "Em revisão" },
            ],
          },
        ]}
        placeholder="Filtrar por código ou descrição do produto"
      >
        <Tabela
          colunas={["Código", "Produto", "Tipo", "Versão ativa", "Em revisão", ""]}
          vazio="Cadastre produtos acabados e subconjuntos na tela Itens para montar as fichas."
        >
          {itens.map((i) => {
            const ativa = fichas.find((f) => f.item_id === i.id && f.status === "ativa");
            const rascunho = fichas.find((f) => f.item_id === i.id && f.status === "rascunho");
            return (
              <tr key={i.id} data-tags={[i.tipo, ativa ? "com_ficha" : "sem_ficha", rascunho ? "em_revisao" : ""].join(" ")}>
                <Celula className="whitespace-nowrap font-medium">{i.codigo}</Celula>
                <Celula>{i.descricao}</Celula>
                <Celula>{TIPOS_ITEM[i.tipo]}</Celula>
                <Celula>
                  {ativa ? (
                    <span>
                      v{ativa.versao} <span className="text-texto-suave">desde {formatarData(ativa.vigencia_inicio)}</span>
                    </span>
                  ) : (
                    <Etiqueta cor="alerta">Sem ficha ativa</Etiqueta>
                  )}
                </Celula>
                <Celula>{rascunho && <Etiqueta cor="alerta">v{rascunho.versao} em rascunho</Etiqueta>}</Celula>
                <Celula className="text-right">
                  <LinkAcao href={`?item=${i.id}`}>Abrir</LinkAcao>
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Ficha de um produto: versões, componentes, operações e custo padrão
// -----------------------------------------------------------------------------
async function DetalheFicha({ acesso, itemId, versao }: { acesso: Acesso; itemId: string; versao?: number }) {
  if (!supabaseConfigurado) return ListaProdutos();
  const supabase = criarClienteNavegador();

  const [{ data: itemDado }, { data: fichasDado }] = await Promise.all([
    supabase.from("itens").select("id, codigo, descricao, tipo, unidade, custo_medio, ativo").eq("id", itemId).maybeSingle(),
    supabase
      .from("fichas_tecnicas")
      .select("id, item_id, versao, status, vigencia_inicio, quantidade_base, observacao")
      .eq("item_id", itemId)
      .order("versao", { ascending: false }),
  ]);
  const item = itemDado as Item | null;
  if (!item) {
    return (
      <div className="space-y-4">
        <Voltar />
        <p className="text-texto-suave">Produto não encontrado.</p>
      </div>
    );
  }
  const fichas = (fichasDado ?? []) as Ficha[];
  const rascunho = fichas.find((f) => f.status === "rascunho");
  const ficha = fichas.find((f) => f.versao === versao) ?? rascunho ?? fichas.find((f) => f.status === "ativa") ?? fichas[0];

  const podeCriar = pode(acesso, TELA, "criar");
  const editavel = ficha?.status === "rascunho" && pode(acesso, TELA, "editar");

  let componentes: Componente[] = [];
  let operacoes: Operacao[] = [];
  let opcoesItens: Pick<Item, "id" | "codigo" | "descricao" | "unidade">[] = [];
  let postos: Posto[] = [];
  if (ficha) {
    const [r1, r2, r3, r4] = await Promise.all([
      supabase
        .from("ficha_componentes")
        .select("id, quantidade, perda_percentual, item:itens(codigo, descricao, unidade, custo_medio, tipo)")
        .eq("ficha_id", ficha.id),
      supabase
        .from("ficha_operacoes")
        .select("id, sequencia, descricao, tempo_setup_min, tempo_execucao_min, instrucoes, posto:postos_trabalho(nome, custo_hora)")
        .eq("ficha_id", ficha.id)
        .order("sequencia"),
      editavel
        ? supabase.from("itens").select("id, codigo, descricao, unidade").eq("ativo", true).neq("id", itemId).order("codigo").limit(2000)
        : Promise.resolve({ data: [] }),
      editavel ? supabase.from("postos_trabalho").select("id, nome").eq("ativo", true).order("nome") : Promise.resolve({ data: [] }),
    ]);
    componentes = ((r1.data ?? []) as unknown as Componente[]).sort((a, b) => a.item.codigo.localeCompare(b.item.codigo));
    operacoes = (r2.data ?? []) as unknown as Operacao[];
    opcoesItens = (r3.data ?? []) as typeof opcoesItens;
    postos = (r4.data ?? []) as Posto[];
  }

  const custo = ficha
    ? custoPadrao(
        componentes.map((c) => ({ ...c, custo_medio: c.item.custo_medio })),
        operacoes.map((o) => ({ ...o, custo_hora: o.posto?.custo_hora ?? 0 })),
        ficha.quantidade_base,
      )
    : null;
  const proximaSequencia = (operacoes.at(-1)?.sequencia ?? 0) + 10;

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        <Voltar />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs text-texto-suave">Ficha técnica · {TIPOS_ITEM[item.tipo]} /</span>
            <h1 className="text-lg font-semibold leading-tight">
              {item.codigo} <span className="font-normal text-texto-suave">· {item.descricao}</span>
            </h1>
          </div>
          {podeCriar && !rascunho && (
            <FormAcao
              acao={criarVersao.bind(null, item.id)}
              rotulo={
                <>
                  <CopyPlus size={16} /> {fichas.length ? "Nova versão" : "Criar ficha técnica"}
                </>
              }
              enviando="Criando..."
            />
          )}
        </div>
        {fichas.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {[...fichas].reverse().map((f) => (
              <Link
                key={f.id}
                href={`?item=${item.id}&versao=${f.versao}`}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                  f.id === ficha?.id ? "border-primaria bg-primaria-suave" : "border-borda bg-superficie hover:bg-fundo"
                }`}
              >
                v{f.versao} <Etiqueta cor={COR_STATUS[f.status]}>{STATUS_FICHA[f.status]}</Etiqueta>
              </Link>
            ))}
          </div>
        )}
      </div>

      {!ficha ? (
        <Cartao>
          <p className="text-texto-suave">Este produto ainda não tem ficha técnica.</p>
        </Cartao>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[1fr_20rem]">
          <div className="space-y-3">
            {ficha.status !== "rascunho" && (
              <p className="rounded-xl bg-primaria-suave px-4 py-2.5 text-sm text-primaria">
                {ficha.status === "ativa" ? "Esta é a versão em uso na produção" : "Versão substituída, mantida como histórico"}. Para
                mudar, crie uma nova versão: ela começa como cópia da ativa e só passa a valer depois de aprovada.
              </p>
            )}

            <Cartao titulo="Componentes">
              <div className="space-y-4">
                <Tabela
                  embutida
                  colunas={["Código", "Componente", "Qtd.", "Perda", "Qtd. com perda", "Custo unit.", "Custo", ""]}
                  vazio="Nenhum componente."
                >
                  {componentes.map((c) => (
                    <tr key={c.id}>
                      <Celula className="whitespace-nowrap font-medium">{c.item.codigo}</Celula>
                      <Celula>
                        {c.item.descricao}
                        {c.item.tipo === "subconjunto" && (
                          <span className="ml-2">
                            <Etiqueta>Subconjunto</Etiqueta>
                          </span>
                        )}
                      </Celula>
                      <Celula className="tabular-nums">
                        {formatarNumero(c.quantidade)} {c.item.unidade}
                      </Celula>
                      <Celula className="tabular-nums">{formatarNumero(c.perda_percentual)}%</Celula>
                      <Celula className="tabular-nums">{formatarNumero(quantidadeComPerda(c))}</Celula>
                      <Celula className="tabular-nums">{formatarMoeda(c.item.custo_medio)}</Celula>
                      <Celula className="tabular-nums">{formatarMoeda(custoComponente({ ...c, custo_medio: c.item.custo_medio }))}</Celula>
                      <Celula className="text-right">
                        {editavel && (
                          <FormAcao
                            acao={removerComponente.bind(null, c.id)}
                            rotulo={<Trash2 size={14} />}
                            enviando="..."
                            secundario
                            confirmar={`Tirar ${c.item.codigo} da ficha?`}
                          />
                        )}
                      </Celula>
                    </tr>
                  ))}
                </Tabela>
                {editavel && (
                  <FormAcao
                    acao={adicionarComponente.bind(null, ficha.id)}
                    rotulo="Adicionar"
                    limpar
                    className="flex flex-wrap items-end gap-3"
                  >
                    <Campo rotulo="Componente" className="min-w-64 flex-1">
                      <select name="componente_id" required defaultValue="" className={estiloCampo}>
                        <option value="" disabled>
                          Escolha o item...
                        </option>
                        {opcoesItens.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.codigo} · {o.descricao} ({o.unidade})
                          </option>
                        ))}
                      </select>
                    </Campo>
                    <Campo rotulo="Quantidade" className="w-28">
                      <input name="quantidade" required inputMode="decimal" className={estiloCampo} />
                    </Campo>
                    <Campo rotulo="Perda (%)" className="w-24">
                      <input name="perda_percentual" inputMode="decimal" defaultValue="0" className={estiloCampo} />
                    </Campo>
                  </FormAcao>
                )}
              </div>
            </Cartao>

            <Cartao titulo="Roteiro de operações">
              <div className="space-y-4">
                <Tabela embutida colunas={["Seq.", "Operação", "Posto", "Preparação", "Execução", "Custo", ""]} vazio="Nenhuma operação.">
                  {operacoes.map((o) => (
                    <tr key={o.id}>
                      <Celula className="tabular-nums">{o.sequencia}</Celula>
                      <Celula>
                        <div>{o.descricao}</div>
                        {o.instrucoes && <div className="text-xs text-texto-suave">{o.instrucoes}</div>}
                      </Celula>
                      <Celula>{o.posto?.nome ?? <span className="text-texto-suave">—</span>}</Celula>
                      <Celula className="tabular-nums">{formatarNumero(o.tempo_setup_min)} min</Celula>
                      <Celula className="tabular-nums">{formatarNumero(o.tempo_execucao_min)} min</Celula>
                      <Celula className="tabular-nums">
                        {formatarMoeda(custoOperacao({ ...o, custo_hora: o.posto?.custo_hora ?? 0 }))}
                      </Celula>
                      <Celula className="text-right">
                        {editavel && (
                          <FormAcao
                            acao={removerOperacao.bind(null, o.id)}
                            rotulo={<Trash2 size={14} />}
                            enviando="..."
                            secundario
                            confirmar={`Tirar a operação ${o.sequencia}?`}
                          />
                        )}
                      </Celula>
                    </tr>
                  ))}
                </Tabela>
                {editavel && (
                  <FormAcao
                    key={proximaSequencia}
                    acao={adicionarOperacao.bind(null, ficha.id)}
                    rotulo="Adicionar"
                    limpar
                    className="space-y-3"
                  >
                    <div className="flex flex-wrap items-end gap-3">
                      <Campo rotulo="Seq." className="w-20">
                        <input name="sequencia" required inputMode="numeric" defaultValue={proximaSequencia} className={estiloCampo} />
                      </Campo>
                      <Campo rotulo="Operação" className="min-w-48 flex-1">
                        <input name="descricao" required placeholder="Ex.: Montagem da base" className={estiloCampo} />
                      </Campo>
                      <Campo rotulo="Posto" className="w-48">
                        <select name="posto_id" defaultValue="" className={estiloCampo}>
                          <option value="">Sem posto</option>
                          {postos.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nome}
                            </option>
                          ))}
                        </select>
                      </Campo>
                      <Campo rotulo="Preparação (min)" className="w-32">
                        <input name="tempo_setup_min" inputMode="decimal" defaultValue="0" className={estiloCampo} />
                      </Campo>
                      <Campo rotulo="Execução (min)" className="w-32">
                        <input name="tempo_execucao_min" inputMode="decimal" defaultValue="0" className={estiloCampo} />
                      </Campo>
                    </div>
                    <Campo rotulo="Instruções para a linha (opcional)">
                      <input name="instrucoes" className={estiloCampo} />
                    </Campo>
                  </FormAcao>
                )}
              </div>
            </Cartao>
          </div>

          <div className="space-y-3">
            {custo && (
              <Cartao titulo="Custo padrão por unidade">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-texto-suave">Materiais</dt>
                    <dd className="tabular-nums">{formatarMoeda(custo.materiais)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-texto-suave">Operações</dt>
                    <dd className="tabular-nums">{formatarMoeda(custo.transformacao)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-borda pt-2 font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{formatarMoeda(custo.total)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-texto-suave">
                  Calculado com o custo médio de cada componente e o custo hora dos postos, dividido pela quantidade base.
                </p>
              </Cartao>
            )}

            <Cartao titulo={`Versão ${ficha.versao}`}>
              {editavel ? (
                <FormAcao key={ficha.id} acao={salvarDadosVersao.bind(null, ficha.id)} rotulo="Salvar" secundario className="space-y-3">
                  <Campo rotulo={`Quantidade base (${item.unidade})`} dica="Quantas unidades uma execução desta ficha produz.">
                    <input name="quantidade_base" inputMode="decimal" defaultValue={ficha.quantidade_base} className={estiloCampo} />
                  </Campo>
                  <Campo rotulo="Observação">
                    <textarea name="observacao" rows={3} defaultValue={ficha.observacao ?? ""} className={estiloCampo} />
                  </Campo>
                </FormAcao>
              ) : (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-texto-suave">Situação</dt>
                    <dd>
                      <Etiqueta cor={COR_STATUS[ficha.status]}>{STATUS_FICHA[ficha.status]}</Etiqueta>
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-texto-suave">Em uso desde</dt>
                    <dd>{formatarData(ficha.vigencia_inicio)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-texto-suave">Quantidade base</dt>
                    <dd className="tabular-nums">
                      {formatarNumero(ficha.quantidade_base)} {item.unidade}
                    </dd>
                  </div>
                  {ficha.observacao && <p className="pt-2 text-texto-suave">{ficha.observacao}</p>}
                </dl>
              )}
            </Cartao>

            {ficha.status === "rascunho" && (
              <Cartao titulo="Aprovação">
                <div className="space-y-3 text-sm">
                  {pode(acesso, TELA, "aprovar") ? (
                    <FormAcao
                      acao={ativarVersao.bind(null, ficha.id, item.id)}
                      rotulo={
                        <>
                          <CheckCircle2 size={16} /> Ativar versão {ficha.versao}
                        </>
                      }
                      enviando="Ativando..."
                      confirmar={`Ativar a versão ${ficha.versao}? A versão em uso hoje passa a ser histórico.`}
                    />
                  ) : (
                    <p className="text-texto-suave">Quando o rascunho estiver pronto, peça a quem aprova fichas técnicas para ativá-lo.</p>
                  )}
                  {pode(acesso, TELA, "excluir") && (
                    <FormAcao
                      acao={excluirRascunho.bind(null, ficha.id, item.id)}
                      rotulo={
                        <>
                          <Trash2 size={14} /> Descartar rascunho
                        </>
                      }
                      enviando="Descartando..."
                      secundario
                      confirmar="Descartar este rascunho? As alterações dele serão perdidas."
                    />
                  )}
                </div>
              </Cartao>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Voltar() {
  return (
    <Link href="/producao/ficha-tecnica" className={`${estiloBotaoSecundario} w-fit`}>
      <ArrowLeft size={16} /> Todas as fichas
    </Link>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaFichaTecnica} />;
}
