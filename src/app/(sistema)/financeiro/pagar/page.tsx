"use client";

import { FileUp, History, Pencil, Plus, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { CampoBusca, type OpcaoBusca } from "@/components/campo-busca";
import { Filtro } from "@/components/filtro";
import { FormAcao } from "@/components/form-acao";
import { Janela } from "@/components/janela";
import { FiltroPeriodo, lerPeriodo, type Periodo } from "@/components/periodo";
import { ResumoPorEmpresa } from "@/components/por-empresa";
import { CaixaSelecao, CaixaTodas, Selecao } from "@/components/selecao";
import { TelaCliente } from "@/components/tela-cliente";
import { CabecalhoTela, Campo, Celula, Etiqueta, SemAcesso, Tabela, estiloCampo } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { statusDoTitulo } from "@/lib/contas-pagar";
import { hojeBrasil, somarDias } from "@/lib/datas";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { carregarCategoriasDespesa, carregarCentrosCusto, carregarFornecedores } from "@/lib/financeiro";
import { formatarData, formatarDataHora, formatarMoeda } from "@/lib/formato";
import { type SituacaoTitulo } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { cancelarConta, editarConta, estornarPagamento, novaConta, pagarConta, reabrirConta } from "./actions";
import { BarraEmMassa } from "./em-massa";
import { CamposLancamento, CamposPagamento } from "./formularios";

const TELA = "financeiro.pagar";
const CAMINHO = "/financeiro/pagar";

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
  juros: number | null;
  multa: number | null;
  desconto: number | null;
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
  centros_custo: { codigo: string; nome: string } | null;
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

// "auto": cada status pela sua data (em aberto e canceladas pelo vencimento,
// pagas pela data do pagamento).
const DATAS_PERIODO = { auto: "Vencimento (a pagar) e pagamento (pagas)", vencimento: "Só vencimento", data_pagamento: "Só pagamento" };
const COLUNAS =
  "id, empresa_id, descricao, parcela, valor, vencimento, situacao, data_pagamento, valor_pago, juros, multa, desconto, nota_id, fornecedor_id, categoria_id, centro_custo_id, observacao, tiny_id, criado_em, integrado_em, fornecedores(nome, nome_fantasia), plano_contas(codigo, nome), centros_custo(codigo, nome), contas_bancarias(nome)";
// O banco entrega no máximo 1000 linhas por vez: busca em páginas.
const PAGINA = 1000;
const MAXIMO = 20000;

async function carregar(empresa: string | null, periodo: Periodo): Promise<Titulo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const pagina = (i: number, contar = false) => {
    let consulta = supabase
      .from("contas_pagar")
      .select(COLUNAS, contar ? { count: "exact" } : undefined)
      .order("vencimento")
      .order("id")
      .range(i, i + PAGINA - 1);
    if (periodo?.por === "auto") {
      const { de, ate } = periodo;
      consulta = consulta.or(
        `and(situacao.neq.pago,vencimento.gte.${de},vencimento.lte.${ate}),and(situacao.eq.pago,data_pagamento.gte.${de},data_pagamento.lte.${ate})`,
      );
    } else if (periodo) {
      consulta = consulta.gte(periodo.por, periodo.de).lte(periodo.por, periodo.ate);
    }
    if (empresa) consulta = consulta.eq("empresa_id", empresa);
    return consulta;
  };
  // A primeira página diz quantas são; as outras vêm juntas.
  const primeira = await pagina(0, true);
  if (primeira.error) throw new Error(primeira.error.message);
  const total = Math.min(primeira.count ?? 0, MAXIMO);
  const resto = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGINA) - 1) }, (_, k) => pagina((k + 1) * PAGINA)),
  );
  const erro = resto.find((r) => r.error)?.error;
  if (erro) throw new Error(erro.message);
  return [primeira, ...resto].flatMap((r) => (r.data ?? []) as unknown as Titulo[]);
}

async function carregarBancos(): Promise<{ id: string; nome: string; empresa_id: string }[]> {
  if (!supabaseConfigurado) return [];
  const { data } = await criarClienteNavegador()
    .from("contas_bancarias")
    .select("id, nome, empresa_id")
    .eq("ativa", true)
    .order("tipo")
    .order("nome");
  return data ?? [];
}

const JANELAS = ["novo", "pagar", "editar", "ver", "volta"];

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
  const podeEditar = pode(acesso, TELA, "editar");

  // Endereço da lista como está (período, situação), sem as janelas: para onde
  // a janela fecha e para onde se volta depois de salvar.
  const busca = new URLSearchParams(filtros as Record<string, string>);
  for (const k of JANELAS) busca.delete(k);
  const aqui = busca.toString() ? `${CAMINHO}?${busca.toString()}` : CAMINHO;
  const comJanela = (param: string, id: string) => `?${new URLSearchParams([...busca.entries(), [param, id]]).toString()}`;

  const status = (t: Titulo) => statusDoTitulo(t, hoje);
  const abertos = titulos.filter((t) => t.situacao === "aberto");
  const vencidos = abertos.filter((t) => status(t) === "vencido");
  const aVencer = abertos.filter((t) => status(t) === "a_vencer");
  const pagos = titulos.filter((t) => t.situacao === "pago");
  const cancelados = titulos.filter((t) => t.situacao === "cancelado");
  // Sem categoria financeira não entram certo no fluxo de caixa e no DRE.
  const semCategoria = titulos.filter((t) => !t.categoria_id && t.situacao !== "cancelado");
  const valorDa = (t: Titulo) => Number(t.situacao === "pago" ? (t.valor_pago ?? t.valor) : t.valor);
  const soma = (l: Titulo[]) => l.reduce((s, t) => s + valorDa(t), 0);

  const pagando = filtros.pagar && podeEditar ? abertos.find((t) => t.id === filtros.pagar) : undefined;
  const editando = filtros.editar && podeEditar ? abertos.find((t) => t.id === filtros.editar) : undefined;
  const criando = !!filtros.novo && pode(acesso, TELA, "criar");
  const vendo = filtros.ver ? titulos.find((t) => t.id === filtros.ver) : undefined;
  const comCadastros = criando || podeEditar;
  const [historico, bancos, fornecedores, categorias, centros] = await Promise.all([
    vendo ? carregarHistorico(vendo.id) : Promise.resolve([]),
    podeEditar ? carregarBancos() : Promise.resolve([]),
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
  const opFornecedores: OpcaoBusca[] = fornecedores.map((f) => ({ id: f.id, nome: f.nome, detalhe: f.documento }));
  const opCategorias: OpcaoBusca[] = categorias.map((c) => ({ id: c.id, nome: `${c.codigo} · ${c.nome}` }));
  const opCentros: OpcaoBusca[] = centros.map((c) => ({ id: c.id, nome: `${c.codigo} · ${c.nome}` }));

  const colunas = [
    ...(podeEditar ? [<CaixaTodas key="todas" />] : []),
    "Vencimento",
    ...(selecionada ? [] : ["Empresa"]),
    "Fornecedor",
    "Conta",
    "Categoria",
    "Valor",
    "Situação",
    "",
  ];
  const fechar = aqui;

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} empresa={selecionada}>
        {pode(acesso, "financeiro.notas_fornecedor", "criar") && (
          <Link href="/financeiro/notas-fornecedor/importar" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-texto-suave hover:bg-superficie hover:text-texto">
            <FileUp size={16} /> Importar nota
          </Link>
        )}
        {podeEditar && (
          <Link
            href="/financeiro/pagar/conferir-tiny"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-texto-suave hover:bg-superficie hover:text-texto"
            title="Deixa situação e data do pagamento iguais à planilha do Tiny"
          >
            <RefreshCw size={16} /> Conferir com o Tiny
          </Link>
        )}
        {pode(acesso, TELA, "criar") && (
          <Link href={comJanela("novo", "1")} scroll={false} className="inline-flex items-center gap-1.5 rounded-lg bg-primaria px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            <Plus size={16} /> Nova conta
          </Link>
        )}
      </CabecalhoTela>

      {criando && (
        <Janela titulo="Nova conta a pagar" fechar={filtros.volta?.startsWith("/financeiro/") ? filtros.volta : fechar} largura="max-w-3xl">
          <FormAcao
            extra={
              <Link href={fechar} scroll={false} className="text-sm text-texto-suave hover:text-texto">
                Cancelar
              </Link>
            }
            acao={novaConta}
            rotulo="Salvar"
            className="space-y-4"
          >
            <input type="hidden" name="volta" value={filtros.volta?.startsWith("/financeiro/conciliacao") ? filtros.volta : aqui} />
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
              <div className="space-y-1 text-sm sm:col-span-2">
                <span className="text-texto-suave">Fornecedor (opcional)</span>
                <CampoBusca name="fornecedor_id" opcoes={opFornecedores} placeholder="Digite parte do nome ou CNPJ" />
              </div>
              <Campo rotulo="Descrição" className="sm:col-span-2">
                <input name="descricao" required defaultValue={filtros.descricao} placeholder="Ex.: Aluguel do galpão" className={estiloCampo} />
              </Campo>
              <div className="space-y-1 text-sm">
                <span className="text-texto-suave">Categoria financeira</span>
                <CampoBusca name="categoria_id" opcoes={opCategorias} vazio={null} obrigatorio placeholder="Digite para procurar" />
              </div>
              <div className="space-y-1 text-sm">
                <span className="text-texto-suave">Centro de custo</span>
                <CampoBusca name="centro_custo_id" opcoes={opCentros} placeholder="Nenhum" />
              </div>
              <CamposLancamento valorInicial={filtros.valor?.replace(".", ",")} vencimentoInicial={filtros.vencimento ?? hoje} />
              <Campo rotulo="Observação" className="sm:col-span-2 lg:col-span-4">
                <input name="observacao" className={estiloCampo} />
              </Campo>
            </div>
          </FormAcao>
        </Janela>
      )}

      {vendo && (
        <Janela titulo={`Origem e histórico: ${vendo.descricao}${vendo.parcela ? ` (${vendo.parcela})` : ""}`} fechar={fechar} largura="max-w-3xl">
          <div className="space-y-3 text-sm">
            <DadosTitulo t={vendo} empresa={nomeEmpresa.get(vendo.empresa_id)} />
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
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
                  <Celula className="whitespace-nowrap">{h.origem === "tiny" ? "Tiny" : (h.usuario_nome ?? ROTULO_ORIGEM[h.origem])}</Celula>
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
        </Janela>
      )}

      {editando && (
        <Janela titulo={`Editar: ${editando.descricao}${editando.parcela ? ` (${editando.parcela})` : ""} · ${nomeEmpresa.get(editando.empresa_id) ?? ""}`} fechar={fechar} largura="max-w-3xl">
          <FormAcao
            key={editando.id}
            extra={
              <Link href={fechar} scroll={false} className="text-sm text-texto-suave hover:text-texto">
                Cancelar
              </Link>
            }
            acao={editarConta.bind(null, editando.id)}
            rotulo="Salvar"
            className="space-y-4"
          >
            <input type="hidden" name="volta" value={aqui} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1 text-sm sm:col-span-2">
                <span className="text-texto-suave">Fornecedor (opcional)</span>
                <CampoBusca name="fornecedor_id" opcoes={opFornecedores} inicial={editando.fornecedor_id ?? ""} placeholder="Digite parte do nome ou CNPJ" />
              </div>
              <Campo rotulo="Descrição" className="sm:col-span-2">
                <input name="descricao" required defaultValue={editando.descricao} className={estiloCampo} />
              </Campo>
              <div className="space-y-1 text-sm">
                <span className="text-texto-suave">Categoria financeira</span>
                <CampoBusca name="categoria_id" opcoes={opCategorias} inicial={editando.categoria_id ?? ""} vazio="Sem categoria" />
              </div>
              <div className="space-y-1 text-sm">
                <span className="text-texto-suave">Centro de custo</span>
                <CampoBusca name="centro_custo_id" opcoes={opCentros} inicial={editando.centro_custo_id ?? ""} />
              </div>
              <Campo rotulo="Valor (R$)">
                <input name="valor" required inputMode="decimal" defaultValue={String(editando.valor).replace(".", ",")} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Vencimento" dica={editando.tiny_id ? "Veio do Tiny: se a conta for alterada lá, a versão do Tiny volta a valer." : undefined}>
                <input name="vencimento" type="date" required defaultValue={editando.vencimento} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Observação" className="sm:col-span-2 lg:col-span-4">
                <input name="observacao" defaultValue={editando.observacao ?? ""} className={estiloCampo} />
              </Campo>
            </div>
          </FormAcao>
        </Janela>
      )}

      {pagando && (
        <Janela titulo={`Pagar: ${pagando.descricao}${pagando.parcela ? ` (${pagando.parcela})` : ""}`} fechar={fechar}>
          <div className="space-y-4">
            <DadosTitulo t={pagando} empresa={nomeEmpresa.get(pagando.empresa_id)} />
            <FormAcao
              extra={
                <Link href={fechar} scroll={false} className="text-sm text-texto-suave hover:text-texto">
                  Cancelar
                </Link>
              }
              acao={pagarConta.bind(null, pagando.id)}
              rotulo="Confirmar pagamento"
              className="space-y-4 border-t border-borda/70 pt-3"
            >
              <input type="hidden" name="volta" value={aqui} />
              <div className="grid gap-3 sm:grid-cols-4">
                <Campo rotulo="Data do pagamento" className="sm:col-span-2">
                  <input name="data_pagamento" type="date" required defaultValue={hoje} className={estiloCampo} />
                </Campo>
                {(() => {
                  const daEmpresa = bancos.filter((b) => b.empresa_id === pagando.empresa_id);
                  return (
                    <Campo
                      rotulo={`Conta bancária (${nomeEmpresa.get(pagando.empresa_id) ?? "empresa"})`}
                      dica={daEmpresa.length === 0 ? "Esta empresa ainda não tem conta bancária cadastrada." : undefined}
                      className="sm:col-span-2"
                    >
                      <select name="conta_bancaria_id" required defaultValue={daEmpresa[0]?.id ?? ""} className={estiloCampo}>
                        {daEmpresa.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </select>
                    </Campo>
                  );
                })()}
                <CamposPagamento principal={Number(pagando.valor)} />
              </div>
            </FormAcao>
          </div>
        </Janela>
      )}

      {!selecionada && empresas.length > 1 && (
        <ResumoPorEmpresa
          colunas={["Vencido", "A vencer", "Em aberto", periodo ? "Pago no período" : "Pago"]}
          filtros={["vencido", "a_vencer", "aberto", "pago"]}
          caminho={CAMINHO}
          extra={periodo ? `&de=${periodo.de}&ate=${periodo.ate}&por=${periodo.por}` : ""}
          linhas={empresas.map((e) => {
            const grupos = [vencidos, aVencer, abertos, pagos].map((l) => l.filter((t) => t.empresa_id === e.id));
            return { id: e.id, nome: e.nome, valores: grupos.map(soma), quantidades: grupos.map((g) => g.length) };
          })}
          fonte={`Mesmos títulos da faixa de situação (${periodo ? "período escolhido" : "todo o período"}), separados pelo CNPJ que paga.`}
        />
      )}

      <Selecao>
        <Filtro
          situacoes={{
            rotulo: "Situação",
            formatar: formatarMoeda,
            opcoes: [
              { valor: "aberto", rotulo: "Em aberto", total: formatarMoeda(soma(abertos)), quantidade: abertos.length, dica: "Vencidas + a vencer: tudo que ainda não foi pago." },
              {
                valor: "vencido",
                rotulo: "Vencido",
                total: formatarMoeda(soma(vencidos)),
                quantidade: vencidos.length,
                cor: "perigo",
                dica: `Em aberto com vencimento antes de hoje (${formatarData(hoje)}).`,
              },
              {
                valor: "a_vencer",
                rotulo: "A vencer",
                total: formatarMoeda(soma(aVencer)),
                quantidade: aVencer.length,
                dica: `Em aberto com vencimento de hoje (${formatarData(hoje)}) em diante.`,
              },
              {
                valor: "pago",
                rotulo: "Pago",
                total: formatarMoeda(soma(pagos)),
                quantidade: pagos.length,
                cor: "sucesso",
                dica: "Valor efetivamente pago (principal + juros + multa - desconto).",
              },
              { valor: "cancelado", rotulo: "Cancelado", total: formatarMoeda(soma(cancelados)), quantidade: cancelados.length },
              { valor: "", rotulo: "Todos", total: formatarMoeda(soma(titulos)), quantidade: titulos.length },
            ],
          }}
          atalhos={[
            {
              rotulo: "Categoria",
              opcoes: [{ valor: "sem_categoria", rotulo: `Sem categoria (${semCategoria.length})` }],
            },
          ]}
          ferramentas={<FiltroPeriodo periodo={periodo} hoje={hoje} campos={DATAS_PERIODO} semPeriodo="Todo o período" />}
          periodo={false}
          placeholder="Filtrar por fornecedor, descrição, empresa, valor..."
          iniciais={{ Situação: filtros.situacao ?? "aberto" }}
        >
          <Tabela colunas={colunas} vazio="Nenhuma conta a pagar. Importe uma nota de fornecedor ou lance uma conta nova.">
            {titulos.map((t) => {
              const st = status(t);
              const vencido = st === "vencido";
              const tags = [
                t.situacao,
                st,
                t.situacao === "aberto" && t.vencimento >= hoje && t.vencimento <= semana && "semana",
                !t.categoria_id && t.situacao !== "cancelado" && "sem_categoria",
              ];
              const encargos = Number(t.juros ?? 0) + Number(t.multa ?? 0);
              return (
                <tr
                  key={t.id}
                  data-tags={tags.filter(Boolean).join(" ")}
                  data-soma={valorDa(t)}
                  data-empresa={t.empresa_id}
                  className={t.situacao === "cancelado" ? "text-texto-suave line-through" : ""}
                >
                  {podeEditar && <Celula className="w-6 pr-0">{t.situacao === "aberto" && <CaixaSelecao id={t.id} rotulo={t.descricao} />}</Celula>}
                  <Celula className={`whitespace-nowrap tabular-nums ${vencido ? "font-medium text-perigo" : ""}`}>{formatarData(t.vencimento)}</Celula>
                  {!selecionada && <Celula className="whitespace-nowrap text-texto-suave">{nomeEmpresa.get(t.empresa_id) ?? "—"}</Celula>}
                  <Celula>
                    {t.fornecedores ? (
                      <span className="block max-w-[min(11rem,11vw)] truncate" title={t.fornecedores.nome}>
                        {t.fornecedores.nome_fantasia || t.fornecedores.nome}
                      </span>
                    ) : (
                      <span className="text-texto-suave">—</span>
                    )}
                  </Celula>
                  <Celula>
                    <span className="flex min-w-0 max-w-[min(17rem,14vw)] items-baseline gap-1.5">
                      <span className="truncate font-medium" title={t.descricao}>
                        {t.descricao}
                      </span>
                      {t.parcela && <span className="shrink-0 whitespace-nowrap text-xs text-texto-suave">{t.parcela}</span>}
                      <Link
                        href={comJanela("ver", t.id)}
                        scroll={false}
                        title="Ver origem e histórico de alterações"
                        className="shrink-0 text-xs text-texto-suave hover:text-primaria hover:underline"
                      >
                        {origemDaConta(t)}
                      </Link>
                      {t.nota_id && (
                        <Link href={`/financeiro/notas-fornecedor/nota?id=${t.nota_id}`} className="shrink-0 text-xs text-primaria hover:underline">
                          nota
                        </Link>
                      )}
                    </span>
                  </Celula>
                  <Celula className="text-texto-suave">
                    <span className="block max-w-[min(15rem,14vw)] truncate" title={t.plano_contas ? `${t.plano_contas.codigo} · ${t.plano_contas.nome}` : undefined}>
                      {t.plano_contas ? (
                        `${t.plano_contas.codigo} · ${t.plano_contas.nome}`
                      ) : t.situacao === "cancelado" ? (
                        "—"
                      ) : (
                        <span className="font-medium text-alerta" title="Sem categoria financeira: não aparece certo no fluxo de caixa. Use Editar ou marque várias e Alterar.">
                          Sem categoria
                        </span>
                      )}
                    </span>
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">
                    {formatarMoeda(t.valor)}
                    {t.situacao === "pago" && t.valor_pago !== null && Number(t.valor_pago) !== Number(t.valor) && (
                      <span
                        className="ml-1 text-xs text-texto-suave"
                        title={encargos ? `Juros ${formatarMoeda(Number(t.juros ?? 0))} · multa ${formatarMoeda(Number(t.multa ?? 0))} · desconto ${formatarMoeda(Number(t.desconto ?? 0))}` : undefined}
                      >
                        pago {formatarMoeda(t.valor_pago)}
                      </span>
                    )}
                  </Celula>
                  <Celula className="whitespace-nowrap">
                    {t.situacao === "pago" ? (
                      <>
                        <span title={`Pago em ${formatarData(t.data_pagamento)} · ${t.contas_bancarias?.nome ?? ""}`}>
                          <Etiqueta cor="sucesso">Pago</Etiqueta>
                        </span>
                        <span className="ml-1 text-xs tabular-nums text-texto-suave">{formatarData(t.data_pagamento).slice(0, 5)}</span>
                      </>
                    ) : t.situacao === "cancelado" ? (
                      <Etiqueta>Cancelado</Etiqueta>
                    ) : vencido ? (
                      <Etiqueta cor="alerta">Vencido</Etiqueta>
                    ) : (
                      <Etiqueta cor="primaria">A vencer</Etiqueta>
                    )}
                  </Celula>
                  <Celula className="whitespace-nowrap text-right">
                    {podeEditar && (
                      <div className="flex items-center justify-end gap-1" data-filtro-ignorar>
                        {t.situacao === "aberto" && (
                          <>
                            <Link
                              href={comJanela("pagar", t.id)}
                              scroll={false}
                              className="rounded-md px-2 py-0.5 text-xs font-medium text-primaria shadow-[0_0_0_1px_var(--color-borda)] hover:bg-primaria-suave"
                            >
                              Pagar
                            </Link>
                            <Link href={comJanela("editar", t.id)} scroll={false} title="Editar" aria-label="Editar" className="rounded p-1 text-texto-suave hover:bg-fundo hover:text-primaria">
                              <Pencil size={14} />
                            </Link>
                            <span title="Cancelar a conta">
                              <FormAcao
                                acao={cancelarConta.bind(null, t.id)}
                                rotulo={<X size={15} aria-label="Cancelar a conta" />}
                                enviando="..."
                                discreto
                                confirmar="Cancelar esta conta? Ela deixa de contar como a pagar e pode ser reaberta depois em Cancelado."
                              />
                            </span>
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
                        {t.situacao === "cancelado" && <FormAcao acao={reabrirConta.bind(null, t.id)} rotulo="Reabrir" enviando="..." discreto />}
                        <Link href={comJanela("ver", t.id)} scroll={false} title="Origem e histórico" aria-label="Origem e histórico" className="rounded p-1 text-texto-suave hover:bg-fundo hover:text-primaria">
                          <History size={14} />
                        </Link>
                      </div>
                    )}
                  </Celula>
                </tr>
              );
            })}
          </Tabela>
        </Filtro>
        {podeEditar && <BarraEmMassa bancos={bancos} fornecedores={opFornecedores} categorias={opCategorias} centros={opCentros} hoje={hoje} />}
      </Selecao>
    </div>
  );
}

// Informação do título, no alto das janelas de pagar e de histórico.
function DadosTitulo({ t, empresa }: { t: Titulo; empresa?: string }) {
  const item = (rotulo: string, valor: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-xs text-texto-suave">{rotulo}</dt>
      <dd className="truncate">{valor}</dd>
    </div>
  );
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-fundo px-3 py-2 text-sm sm:grid-cols-4">
      {item("Fornecedor", t.fornecedores ? t.fornecedores.nome_fantasia || t.fornecedores.nome : "—")}
      {item("Empresa", empresa ?? "—")}
      {item("Vencimento", formatarData(t.vencimento))}
      {item("Valor", <span className="font-semibold tabular-nums">{formatarMoeda(t.valor)}</span>)}
      {item("Categoria", t.plano_contas ? `${t.plano_contas.codigo} · ${t.plano_contas.nome}` : "—")}
      {item("Centro de custo", t.centros_custo ? `${t.centros_custo.codigo} · ${t.centros_custo.nome}` : "—")}
      {item("Parcela", t.parcela ?? "—")}
      {item("Origem", origemDaConta(t))}
      {t.situacao === "pago" && (
        <>
          {item("Pago em", `${formatarData(t.data_pagamento)} · ${t.contas_bancarias?.nome ?? ""}`)}
          {item("Valor pago", <span className="tabular-nums">{formatarMoeda(Number(t.valor_pago ?? 0))}</span>)}
          {item("Juros + multa", <span className="tabular-nums">{formatarMoeda(Number(t.juros ?? 0) + Number(t.multa ?? 0))}</span>)}
          {item("Desconto", <span className="tabular-nums">{formatarMoeda(Number(t.desconto ?? 0))}</span>)}
        </>
      )}
      {t.observacao && <div className="col-span-2 sm:col-span-4">{item("Observação", t.observacao)}</div>}
    </dl>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaContasPagar} />;
}
