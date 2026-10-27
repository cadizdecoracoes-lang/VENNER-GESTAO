"use client";

import { FileUp, Plus } from "lucide-react";
import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { ResumoPorEmpresa } from "@/components/por-empresa";
import { FiltroPeriodo, lerPeriodo, type Periodo } from "@/components/periodo";
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
  estiloBotao,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { carregarCategoriasDespesa, carregarCentrosCusto, carregarFornecedores } from "@/lib/financeiro";
import { hojeBrasil, somarDias } from "@/lib/datas";
import { formatarData, formatarDataHora, formatarMoeda } from "@/lib/formato";
import { type SituacaoTitulo } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { cancelarConta, editarConta, estornarPagamento, novaConta, pagarConta, reabrirConta } from "./actions";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.pagar";

type Titulo = {
  id: string;
  empresa_id: string;
  descricao: string;
  parcela: string | null;
  valor: number;
  vencimento: string;
  situacao: SituacaoTitulo;
  data_pagamento: string | null;
  valor_pago: number | null;
  nota_id: string | null;
  fornecedor_id: string | null;
  categoria_id: string | null;
  centro_custo_id: string | null;
  observacao: string | null;
  tiny_id: number | null;
  criado_em: string;
  integrado_em: string | null;
  fornecedores: { nome: string; nome_fantasia: string | null } | null;
  plano_contas: { codigo: string; nome: string } | null;
  contas_bancarias: { nome: string } | null;
};
type Filtros = { novo?: string; pagar?: string; editar?: string; ver?: string; de?: string; ate?: string; por?: string; situacao?: string } & Preenchido;
// Atalho da conciliação bancária: abre a conta nova já preenchida com a linha do extrato.
type Preenchido = { empresa?: string; descricao?: string; valor?: string; vencimento?: string; volta?: string };

type Historico = {
  id: string;
  quando: string;
  evento: "criada" | "alterada";
  origem: Origem;
  usuario_nome: string | null;
  mudancas: Record<string, [string | null, string | null]>;
};
type Origem = "manual" | "nota" | "tiny" | "sistema";
const ROTULO_ORIGEM: Record<Origem, string> = { manual: "Lançada à mão", nota: "Nota do fornecedor", tiny: "Tiny", sistema: "Sistema" };

// Origem curta mostrada na linha: de onde a conta veio.
function origemDaConta(t: Titulo): string {
  if (t.nota_id) return t.tiny_id ? "Nota · Tiny" : "Nota";
  return t.tiny_id ? "Tiny" : "Manual";
}

async function carregarHistorico(conta: string): Promise<Historico[]> {
  if (!supabaseConfigurado) return [];
  const { data } = await criarClienteNavegador()
    .from("contas_pagar_historico")
    .select("id, quando, evento, origem, usuario_nome, mudancas")
    .eq("conta_id", conta)
    .order("quando");
  return (data ?? []) as Historico[];
}

const DATAS_PERIODO = { vencimento: "Vencimento", data_pagamento: "Pagamento" };

async function carregar(empresa: string | null, periodo: Periodo): Promise<Titulo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  let consulta = supabase
    .from("contas_pagar")
    .select(
      "id, empresa_id, descricao, parcela, valor, vencimento, situacao, data_pagamento, valor_pago, nota_id, fornecedor_id, categoria_id, centro_custo_id, observacao, tiny_id, criado_em, integrado_em, fornecedores(nome, nome_fantasia), plano_contas(codigo, nome), contas_bancarias(nome)",
    )
    .order("vencimento")
    .limit(3000);
  if (periodo) {
    consulta = consulta.gte(periodo.por, periodo.de).lte(periodo.por, periodo.ate);
  } else {
    // Sem período: tudo em aberto, os pagos neste mês e os cancelados que venciam a partir deste mês.
    const inicioMes = hojeBrasil().slice(0, 8) + "01";
    consulta = consulta.or(`situacao.eq.aberto,data_pagamento.gte.${inicioMes},and(situacao.eq.cancelado,vencimento.gte.${inicioMes})`);
  }
  if (empresa) consulta = consulta.eq("empresa_id", empresa);
  return ((await consulta).data ?? []) as unknown as Titulo[];
}

async function PaginaContasPagar({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const periodo = lerPeriodo(filtros, Object.keys(DATAS_PERIODO));
  const titulos = await carregar(selecionada?.id ?? null, periodo);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const hoje = hojeBrasil();
  const semana = somarDias(hoje, 7);

  const abertos = titulos.filter((t) => t.situacao === "aberto");
  const vencidos = abertos.filter((t) => t.vencimento < hoje);
  const proximos = abertos.filter((t) => t.vencimento >= hoje && t.vencimento <= semana);
  const pagos = titulos.filter((t) => t.situacao === "pago");
  const cancelados = titulos.filter((t) => t.situacao === "cancelado");
  const soma = (l: Titulo[], campo: "valor" | "valor_pago" = "valor") => l.reduce((s, t) => s + Number(t[campo] ?? 0), 0);

  const pagando = filtros.pagar ? abertos.find((t) => t.id === filtros.pagar) : undefined;
  const editando = filtros.editar && pode(acesso, TELA, "editar") ? abertos.find((t) => t.id === filtros.editar) : undefined;
  const criando = !!filtros.novo && pode(acesso, TELA, "criar");
  const comCadastros = criando || !!editando;
  const vendo = filtros.ver ? titulos.find((t) => t.id === filtros.ver) : undefined;
  const historico = vendo ? await carregarHistorico(vendo.id) : [];
  const [contasBancarias, fornecedores, categorias, centros] = await Promise.all([
    pagando && supabaseConfigurado
      ? (criarClienteNavegador())
          .from("contas_bancarias")
          .select("id, nome")
          .eq("empresa_id", pagando.empresa_id)
          .eq("ativa", true)
          .order("tipo")
          .order("nome")
      : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    comCadastros ? carregarFornecedores() : Promise.resolve([]),
    comCadastros ? carregarCategoriasDespesa() : Promise.resolve([]),
    comCadastros ? carregarCentrosCusto() : Promise.resolve([]),
  ]);
  // Fornecedor inativo continua aparecendo na conta que já é dele.
  if (editando?.fornecedor_id && editando.fornecedores && !fornecedores.some((f) => f.id === editando.fornecedor_id)) {
    fornecedores.unshift({
      id: editando.fornecedor_id,
      nome: editando.fornecedores.nome_fantasia || editando.fornecedores.nome,
      documento: null,
    });
  }
  const filtroPeriodo = periodo ? `&de=${periodo.de}&ate=${periodo.ate}&por=${periodo.por}` : "";

  const colunas = ["Vencimento", ...(selecionada ? [] : ["Empresa"]), "Fornecedor", "Conta", "Categoria", "Valor", "Situação", ""];

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} empresa={selecionada}>
        {pode(acesso, "financeiro.notas_fornecedor", "criar") && (
          <Link href="/financeiro/notas-fornecedor/importar" className={estiloBotaoSecundario}>
            <FileUp size={16} /> Importar nota
          </Link>
        )}
        {pode(acesso, TELA, "criar") && !criando && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Nova conta
          </Link>
        )}
      </CabecalhoTela>

      {criando && (
        <Cartao titulo="Nova conta a pagar">
          <FormAcao
            extra={
              <Link href="/financeiro/pagar" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            }
            acao={novaConta}
            rotulo="Salvar"
            className="space-y-4"
          >
            {filtros.volta && <input type="hidden" name="volta" value={filtros.volta} />}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Empresa que paga" className="sm:col-span-2">
                <select name="empresa_id" required defaultValue={filtros.empresa ?? selecionada?.id ?? ""} className={estiloCampo}>
                  <option value="" disabled>
                    Escolha...
                  </option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Fornecedor (opcional)" className="sm:col-span-2">
                <select name="fornecedor_id" defaultValue="" className={estiloCampo}>
                  <option value="">Nenhum</option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Descrição" className="sm:col-span-2">
                <input name="descricao" required defaultValue={filtros.descricao} placeholder="Ex.: Aluguel do galpão" className={estiloCampo} />
              </Campo>
              <Campo rotulo="Categoria financeira">
                <select name="categoria_id" required defaultValue="" className={estiloCampo}>
                  <option value="" disabled>
                    Escolha...
                  </option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Centro de custo">
                <select name="centro_custo_id" defaultValue="" className={estiloCampo}>
                  <option value="">Nenhum</option>
                  {centros.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Valor de cada parcela (R$)">
                <input name="valor" required inputMode="decimal" defaultValue={filtros.valor?.replace(".", ",")} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Vencimento (1ª parcela)">
                <input name="vencimento" type="date" required defaultValue={filtros.vencimento ?? hoje} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Parcelas" dica="Uma por mês, no mesmo dia.">
                <input name="parcelas" type="number" min={1} max={120} defaultValue={1} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Observação">
                <input name="observacao" className={estiloCampo} />
              </Campo>
            </div>
          </FormAcao>
        </Cartao>
      )}

      {vendo && (
        <Cartao
          titulo={`Origem e histórico: ${vendo.descricao}${vendo.parcela ? ` (${vendo.parcela})` : ""}`}
          acoes={<LinkAcao href={`/financeiro/pagar${filtroPeriodo.replace("&", "?")}`}>Fechar</LinkAcao>}
        >
          <div className="space-y-2 text-sm">
            <p className="flex flex-wrap gap-x-5 gap-y-1">
              <span>
                <span className="text-texto-suave">Origem:</span> {origemDaConta(vendo)}
              </span>
              <span>
                <span className="text-texto-suave">Criada em:</span> {formatarDataHora(vendo.criado_em)}
                {historico[0]?.evento === "criada" && historico[0].usuario_nome && ` por ${historico[0].usuario_nome}`}
              </span>
              {vendo.tiny_id && (
                <span>
                  <span className="text-texto-suave">Integrada do Tiny em:</span> {formatarDataHora(vendo.integrado_em)} · nº {vendo.tiny_id}
                </span>
              )}
            </p>
            <Tabela colunas={["Quando", "Feito por", "O que mudou"]} vazio="Sem alterações registradas." embutida>
              {historico.map((h) => (
                <tr key={h.id}>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarDataHora(h.quando)}</Celula>
                  <Celula className="whitespace-nowrap">
                    {h.origem === "tiny" ? "Tiny" : h.usuario_nome ?? ROTULO_ORIGEM[h.origem]}
                  </Celula>
                  <Celula>
                    {h.evento === "criada" ? (
                      <span className="text-texto-suave">Criada ({ROTULO_ORIGEM[h.origem]})</span>
                    ) : (
                      Object.entries(h.mudancas).map(([campo, [antes, depois]]) => (
                        <span key={campo} className="mr-4 inline-block">
                          <span className="text-texto-suave">{campo}:</span> {antes ?? "—"} → <span className="font-medium">{depois ?? "—"}</span>
                        </span>
                      ))
                    )}
                  </Celula>
                </tr>
              ))}
            </Tabela>
          </div>
        </Cartao>
      )}

      {editando && (
        <Cartao titulo={`Editar: ${editando.descricao}${editando.parcela ? ` (${editando.parcela})` : ""} · ${nomeEmpresa.get(editando.empresa_id) ?? ""}`}>
          <FormAcao
            key={editando.id}
            extra={
              <Link href="/financeiro/pagar" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            }
            acao={editarConta.bind(null, editando.id)}
            rotulo="Salvar"
            className="space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Fornecedor (opcional)" className="sm:col-span-2">
                <select name="fornecedor_id" defaultValue={editando.fornecedor_id ?? ""} className={estiloCampo}>
                  <option value="">Nenhum</option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Descrição" className="sm:col-span-2">
                <input name="descricao" required defaultValue={editando.descricao} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Categoria financeira">
                <select name="categoria_id" defaultValue={editando.categoria_id ?? ""} className={estiloCampo}>
                  <option value="">Sem categoria</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Centro de custo">
                <select name="centro_custo_id" defaultValue={editando.centro_custo_id ?? ""} className={estiloCampo}>
                  <option value="">Nenhum</option>
                  {centros.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Valor (R$)">
                <input
                  name="valor"
                  required
                  inputMode="decimal"
                  defaultValue={String(editando.valor).replace(".", ",")}
                  className={estiloCampo}
                />
              </Campo>
              <Campo
                rotulo="Vencimento"
                dica={editando.tiny_id ? "Veio do Tiny: se a conta for alterada lá, a versão do Tiny volta a valer." : undefined}
              >
                <input name="vencimento" type="date" required defaultValue={editando.vencimento} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Observação" className="sm:col-span-2">
                <input name="observacao" defaultValue={editando.observacao ?? ""} className={estiloCampo} />
              </Campo>
            </div>
          </FormAcao>
        </Cartao>
      )}

      {pagando && pode(acesso, TELA, "editar") && (
        <Cartao titulo={`Pagar: ${pagando.descricao}${pagando.parcela ? ` (${pagando.parcela})` : ""}`}>
          <FormAcao
            extra={
              <Link href="/financeiro/pagar" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            } acao={pagarConta.bind(null, pagando.id)} rotulo="Confirmar pagamento" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Data do pagamento">
                <input name="data_pagamento" type="date" required defaultValue={hoje} className={estiloCampo} />
              </Campo>
              <Campo
                rotulo={`Conta bancária (${nomeEmpresa.get(pagando.empresa_id) ?? "empresa"})`}
                dica={(contasBancarias.data ?? []).length === 0 ? "Esta empresa ainda não tem conta bancária cadastrada." : undefined}
              >
                <select name="conta_bancaria_id" required defaultValue={(contasBancarias.data ?? [])[0]?.id ?? ""} className={estiloCampo}>
                  {(contasBancarias.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Valor pago (R$)" dica="Com juros ou desconto, se houver.">
                <input name="valor_pago" required inputMode="decimal" defaultValue={pagando.valor} className={estiloCampo} />
              </Campo>
            </div>
          </FormAcao>
        </Cartao>
      )}

      {!selecionada && empresas.length > 1 && (
        <ResumoPorEmpresa
          colunas={["Vencido", "Próximos 7 dias", "Em aberto", periodo ? "Pago no período" : "Pago neste mês"]}
          filtros={["vencido", "semana", "aberto", "pago"]}
          caminho="/financeiro/pagar"
          extra={filtroPeriodo}
          linhas={empresas.map((e) => {
            const grupos = [vencidos, proximos, abertos, pagos].map((l) => l.filter((t) => t.empresa_id === e.id));
            return {
              id: e.id,
              nome: e.nome,
              valores: grupos.map((g, i) => soma(g, i === 3 ? "valor_pago" : "valor")),
              quantidades: grupos.map((g) => g.length),
            };
          })}
          fonte={`Mesmos títulos da faixa de situação (${periodo ? "período escolhido" : "em aberto e pagos neste mês"}), separados pelo CNPJ que paga.`}
        />
      )}

      <Filtro
        situacoes={{
          rotulo: "Situação",
          opcoes: [
            {
              valor: "vencido",
              rotulo: "Vencidas",
              total: formatarMoeda(soma(vencidos)),
              quantidade: vencidos.length,
              cor: "perigo",
              dica: `Em aberto com vencimento antes de ${formatarData(hoje)}.`,
            },
            {
              valor: "semana",
              rotulo: "Vencem em 7 dias",
              total: formatarMoeda(soma(proximos)),
              quantidade: proximos.length,
              dica: `Em aberto com vencimento de ${formatarData(hoje)} a ${formatarData(semana)}.`,
            },
            {
              valor: "aberto",
              rotulo: periodo ? "Em aberto no período" : "Em aberto",
              total: formatarMoeda(soma(abertos)),
              quantidade: abertos.length,
              dica: "Tudo que ainda não foi pago (vencido ou a vencer).",
            },
            {
              valor: "pago",
              rotulo: periodo ? "Pagas no período" : "Pagas no mês",
              total: formatarMoeda(soma(pagos, "valor_pago")),
              quantidade: pagos.length,
              cor: "sucesso",
              dica: "Valor efetivamente pago, com juros ou desconto.",
            },
            { valor: "cancelado", rotulo: "Canceladas", total: formatarMoeda(soma(cancelados)), quantidade: cancelados.length },
            { valor: "", rotulo: "Todas", quantidade: titulos.length, total: "\u00a0" },
          ],
        }}
        ferramentas={<FiltroPeriodo periodo={periodo} hoje={hoje} campos={DATAS_PERIODO} semPeriodo="Em aberto + pagas no mês" />}
        periodo={false}
        placeholder="Filtrar por fornecedor, descrição, empresa, valor..."
        iniciais={{ Situação: filtros.situacao ?? "aberto" }}
      >
        <Tabela colunas={colunas} vazio="Nenhuma conta a pagar. Importe uma nota de fornecedor ou lance uma conta nova.">
          {titulos.map((t) => {
            const vencido = t.situacao === "aberto" && t.vencimento < hoje;
            const tags = [
              t.situacao,
              vencido && "vencido",
              t.situacao === "aberto" && t.vencimento >= hoje && t.vencimento <= semana && "semana",
            ];
            return (
              <tr
                key={t.id}
                data-tags={tags.filter(Boolean).join(" ")}
                className={t.situacao === "cancelado" ? "text-texto-suave line-through" : ""}
              >
                <Celula className={`whitespace-nowrap tabular-nums ${vencido ? "font-medium text-perigo" : ""}`}>
                  {formatarData(t.vencimento)}
                </Celula>
                {!selecionada && <Celula className="whitespace-nowrap text-texto-suave">{nomeEmpresa.get(t.empresa_id) ?? "—"}</Celula>}
                <Celula>
                  {t.fornecedores ? (
                    <span className="block max-w-[16rem] truncate" title={t.fornecedores.nome}>
                      {t.fornecedores.nome_fantasia || t.fornecedores.nome}
                    </span>
                  ) : (
                    <span className="text-texto-suave">—</span>
                  )}
                </Celula>
                <Celula>
                  <span className="font-medium">{t.descricao}</span>
                  {t.parcela && <span className="text-texto-suave"> · {t.parcela}</span>}
                  <Link
                    href={`?ver=${t.id}${filtroPeriodo}`}
                    title="Ver origem e histórico de alterações"
                    className="ml-2 text-xs text-texto-suave hover:text-primaria hover:underline"
                  >
                    {origemDaConta(t)}
                  </Link>
                  {t.nota_id && (
                    <span className="ml-2 text-xs">
                      <LinkAcao href={`/financeiro/notas-fornecedor/nota?id=${t.nota_id}`}>Ver nota</LinkAcao>
                    </span>
                  )}
                </Celula>
                <Celula className="text-texto-suave">{t.plano_contas ? `${t.plano_contas.codigo} · ${t.plano_contas.nome}` : "—"}</Celula>
                <Celula className="whitespace-nowrap tabular-nums">
                  {formatarMoeda(t.valor)}
                  {t.situacao === "pago" && t.valor_pago !== null && Number(t.valor_pago) !== Number(t.valor) && (
                    <span className="block text-xs text-texto-suave">pago {formatarMoeda(t.valor_pago)}</span>
                  )}
                </Celula>
                <Celula>
                  {t.situacao === "pago" ? (
                    <>
                      <Etiqueta cor="sucesso">Pago</Etiqueta>
                      <span className="block text-xs text-texto-suave">
                        {formatarData(t.data_pagamento)} · {t.contas_bancarias?.nome}
                      </span>
                    </>
                  ) : t.situacao === "cancelado" ? (
                    <Etiqueta>Cancelado</Etiqueta>
                  ) : vencido ? (
                    <Etiqueta cor="alerta">Vencido</Etiqueta>
                  ) : (
                    <Etiqueta cor="primaria">Em aberto</Etiqueta>
                  )}
                </Celula>
                <Celula className="whitespace-nowrap text-right">
                  {pode(acesso, TELA, "editar") && (
                    <div className="flex items-center justify-end gap-3">
                      {t.situacao === "aberto" && (
                        <>
                          <LinkAcao href={`?pagar=${t.id}${filtroPeriodo}`}>Pagar</LinkAcao>
                          <LinkAcao href={`?editar=${t.id}${filtroPeriodo}`}>Editar</LinkAcao>
                          <FormAcao
                            acao={cancelarConta.bind(null, t.id)}
                            rotulo="Cancelar"
                            enviando="..."
                            discreto
                            confirmar="Cancelar esta conta? Ela deixa de contar como a pagar e pode ser reaberta depois em Canceladas."
                          />
                        </>
                      )}
                      {t.situacao === "pago" && (
                        <FormAcao
                          acao={estornarPagamento.bind(null, t.id)}
                          rotulo="Estornar"
                          enviando="..."
                          discreto
                          confirmar="Desfazer o pagamento? A conta volta para em aberto."
                        />
                      )}
                      {t.situacao === "cancelado" && (
                        <FormAcao acao={reabrirConta.bind(null, t.id)} rotulo="Reabrir" enviando="..." discreto />
                      )}
                    </div>
                  )}
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaContasPagar} />;
}
