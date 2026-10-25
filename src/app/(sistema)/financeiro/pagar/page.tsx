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
  FaixaEmpresa,
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
import { formatarData, formatarMoeda } from "@/lib/formato";
import { type SituacaoTitulo } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { cancelarConta, estornarPagamento, novaConta, pagarConta, reabrirConta } from "./actions";
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
  fornecedores: { nome: string; nome_fantasia: string | null } | null;
  plano_contas: { codigo: string; nome: string } | null;
  contas_bancarias: { nome: string } | null;
};
type Filtros = { novo?: string; pagar?: string; de?: string; ate?: string; por?: string; situacao?: string } & Preenchido;
// Atalho da conciliação bancária: abre a conta nova já preenchida com a linha do extrato.
type Preenchido = { empresa?: string; descricao?: string; valor?: string; vencimento?: string; volta?: string };

const DATAS_PERIODO = { vencimento: "Vencimento", data_pagamento: "Pagamento" };

async function carregar(empresa: string | null, periodo: Periodo): Promise<Titulo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  let consulta = supabase
    .from("contas_pagar")
    .select(
      "id, empresa_id, descricao, parcela, valor, vencimento, situacao, data_pagamento, valor_pago, nota_id, fornecedores(nome, nome_fantasia), plano_contas(codigo, nome), contas_bancarias(nome)",
    )
    .order("vencimento")
    .limit(3000);
  if (periodo) {
    consulta = consulta.gte(periodo.por, periodo.de).lte(periodo.por, periodo.ate);
  } else {
    // Sem período: tudo em aberto, e pagos ou cancelados dos últimos 120 dias.
    const desde = somarDias(hojeBrasil(), -120);
    consulta = consulta.or(`situacao.eq.aberto,vencimento.gte.${desde},data_pagamento.gte.${desde}`);
  }
  if (empresa) consulta = consulta.eq("empresa_id", empresa);
  return ((await consulta).data ?? []) as unknown as Titulo[];
}

function Resumo({ rotulo, valor, quantidade, cor }: { rotulo: string; valor: number; quantidade: number; cor?: string }) {
  return (
    <div className="rounded-2xl bg-superficie px-5 py-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <p className="text-sm text-texto-suave">{rotulo}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${cor ?? ""}`}>{formatarMoeda(valor)}</p>
      <p className="text-xs text-texto-suave">
        {quantidade} {quantidade === 1 ? "conta" : "contas"}
      </p>
    </div>
  );
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
  const inicioMes = hoje.slice(0, 8) + "01";

  const abertos = titulos.filter((t) => t.situacao === "aberto");
  const vencidos = abertos.filter((t) => t.vencimento < hoje);
  const proximos = abertos.filter((t) => t.vencimento >= hoje && t.vencimento <= semana);
  const pagos = titulos.filter((t) => t.situacao === "pago");
  const pagosMes = titulos.filter((t) => t.situacao === "pago" && (t.data_pagamento ?? "") >= inicioMes);
  const soma = (l: Titulo[], campo: "valor" | "valor_pago" = "valor") => l.reduce((s, t) => s + Number(t[campo] ?? 0), 0);

  const pagando = filtros.pagar ? abertos.find((t) => t.id === filtros.pagar) : undefined;
  const criando = !!filtros.novo && pode(acesso, TELA, "criar");
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
    criando ? carregarFornecedores() : Promise.resolve([]),
    criando ? carregarCategoriasDespesa() : Promise.resolve([]),
    criando ? carregarCentrosCusto() : Promise.resolve([]),
  ]);

  const colunas = ["Vencimento", ...(selecionada ? [] : ["Empresa"]), "Conta", "Categoria", "Valor", "Situação", ""];

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
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
          <FormAcao acao={novaConta} rotulo="Salvar" className="space-y-4">
            {filtros.volta && <input type="hidden" name="volta" value={filtros.volta} />}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <div className="flex justify-end">
              <Link href="/financeiro/pagar" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      {pagando && pode(acesso, TELA, "editar") && (
        <Cartao titulo={`Pagar: ${pagando.descricao}${pagando.parcela ? ` (${pagando.parcela})` : ""}`}>
          <FormAcao acao={pagarConta.bind(null, pagando.id)} rotulo="Confirmar pagamento" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
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
            <div className="flex justify-end">
              <Link href="/financeiro/pagar" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <FaixaEmpresa empresa={selecionada} />

      <FiltroPeriodo periodo={periodo} hoje={hoje} campos={DATAS_PERIODO} semPeriodo="Em aberto e recentes" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo rotulo="Vencido" valor={soma(vencidos)} quantidade={vencidos.length} cor={vencidos.length ? "text-perigo" : ""} />
        <Resumo rotulo="Vence nos próximos 7 dias" valor={soma(proximos)} quantidade={proximos.length} />
        <Resumo rotulo={periodo ? "Em aberto no período" : "Total em aberto"} valor={soma(abertos)} quantidade={abertos.length} />
        {periodo ? (
          <Resumo rotulo="Pago no período" valor={soma(pagos, "valor_pago")} quantidade={pagos.length} cor="text-sucesso" />
        ) : (
          <Resumo rotulo="Pago neste mês" valor={soma(pagosMes, "valor_pago")} quantidade={pagosMes.length} cor="text-sucesso" />
        )}
      </div>

      {!selecionada && empresas.length > 1 && (
        <ResumoPorEmpresa
          colunas={["Vencido", "Próximos 7 dias", "Em aberto", periodo ? "Pago no período" : "Pago neste mês"]}
          filtros={["vencido", "semana", "aberto", "pago"]}
          caminho="/financeiro/pagar"
          extra={periodo ? `&de=${periodo.de}&ate=${periodo.ate}&por=${periodo.por}` : ""}
          linhas={empresas.map((e) => {
            const grupos = [vencidos, proximos, abertos, periodo ? pagos : pagosMes].map((l) => l.filter((t) => t.empresa_id === e.id));
            return {
              id: e.id,
              nome: e.nome,
              valores: grupos.map((g, i) => soma(g, i === 3 ? "valor_pago" : "valor")),
              quantidades: grupos.map((g) => g.length),
            };
          })}
          fonte={`Mesmos títulos dos quadros acima (${periodo ? "período escolhido" : "em aberto e pagos dos últimos 120 dias"}), separados pelo CNPJ que paga.`}
        />
      )}

      <Filtro
        atalhos={[
          {
            rotulo: "Situação",
            opcoes: [
              { valor: "vencido", rotulo: "Vencidas" },
              { valor: "semana", rotulo: "Próximos 7 dias" },
              { valor: "aberto", rotulo: "Em aberto" },
              { valor: "pago", rotulo: "Pagas" },
              { valor: "cancelado", rotulo: "Canceladas" },
            ],
          },
        ]}
        placeholder="Filtrar por fornecedor, descrição, empresa, valor..."
        iniciais={filtros.situacao ? { Situação: filtros.situacao } : {}}
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
                  <span className="font-medium">{t.descricao}</span>
                  {t.parcela && <span className="text-texto-suave"> · {t.parcela}</span>}
                  {t.nota_id && (
                    <span className="block text-xs">
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
                          <LinkAcao href={`?pagar=${t.id}${periodo ? `&de=${periodo.de}&ate=${periodo.ate}&por=${periodo.por}` : ""}`}>
                            Pagar
                          </LinkAcao>
                          <FormAcao
                            acao={cancelarConta.bind(null, t.id)}
                            rotulo="Cancelar"
                            enviando="..."
                            discreto
                            confirmar="Cancelar esta conta a pagar?"
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
