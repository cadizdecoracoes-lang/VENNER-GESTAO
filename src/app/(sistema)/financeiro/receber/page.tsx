import { FileUp, Plus } from "lucide-react";
import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { FiltroPeriodo, lerPeriodo, type Periodo } from "@/components/periodo";
import { FormAcao } from "@/components/form-acao";
import {
  CabecalhoTela,
  Campo,
  Cartao,
  Celula,
  Etiqueta,
  FaixaEmpresa,
  Fonte,
  Indicador,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { carregarCategoriasReceita, carregarContasBancarias } from "@/lib/financeiro";
import { hojeBrasil, somarDias } from "@/lib/datas";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { CANAIS, type SituacaoTitulo } from "@/lib/rotulos";
import { carregarClientes } from "@/lib/vendas";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { cancelarConta, estornarRecebimento, novaConta, receberConta, reabrirConta } from "./actions";

const TELA = "financeiro.receber";

type Titulo = {
  id: string;
  empresa_id: string;
  pedido_id: string | null;
  canal: string;
  descricao: string;
  parcela: string | null;
  valor: number;
  tarifas: number;
  valor_liquido: number;
  vencimento: string;
  situacao: SituacaoTitulo;
  data_recebimento: string | null;
  valor_recebido: number | null;
  observacao: string | null;
  clientes: { nome: string; nome_fantasia: string | null } | null;
  plano_contas: { codigo: string; nome: string } | null;
  contas_bancarias: { nome: string } | null;
  pedidos_venda: { numero: number } | null;
};
type Filtros = {
  novo?: string;
  receber?: string;
  de?: string;
  ate?: string;
  por?: string;
  situacao?: string;
  pedido?: string;
  importadas?: string;
  repetidas?: string;
};
const DATAS_PERIODO = { vencimento: "Vencimento", data_recebimento: "Recebimento" };

async function carregar(empresa: string | null, periodo: Periodo, pedido: string | null): Promise<Titulo[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  let consulta = supabase
    .from("contas_receber")
    .select(
      "id, empresa_id, pedido_id, canal, descricao, parcela, valor, tarifas, valor_liquido, vencimento, situacao, data_recebimento, valor_recebido, observacao, clientes(nome, nome_fantasia), plano_contas(codigo, nome), contas_bancarias(nome), pedidos_venda(numero)",
    )
    .order("vencimento")
    .limit(5000);
  if (pedido) {
    consulta = consulta.eq("pedido_id", pedido);
  } else if (periodo) {
    consulta = consulta.gte(periodo.por, periodo.de).lte(periodo.por, periodo.ate);
  } else {
    // Sem período: tudo em aberto, e recebidos ou cancelados dos últimos 120 dias.
    const desde = somarDias(hojeBrasil(), -120);
    consulta = consulta.or(`situacao.eq.aberto,vencimento.gte.${desde},data_recebimento.gte.${desde}`);
  }
  if (empresa) consulta = consulta.eq("empresa_id", empresa);
  return ((await consulta).data ?? []) as unknown as Titulo[];
}

export default async function PaginaContasReceber({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const periodo = lerPeriodo(filtros, Object.keys(DATAS_PERIODO));
  const pedido = filtros.pedido && /^[0-9a-f-]{36}$/.test(filtros.pedido) ? filtros.pedido : null;
  const titulos = await carregar(selecionada?.id ?? null, periodo, pedido);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const hoje = hojeBrasil();
  const semana = somarDias(hoje, 7);
  const inicioMes = hoje.slice(0, 8) + "01";

  const abertos = titulos.filter((t) => t.situacao === "aberto");
  const vencidos = abertos.filter((t) => t.vencimento < hoje);
  const proximos = abertos.filter((t) => t.vencimento >= hoje && t.vencimento <= semana);
  const recebidos = titulos.filter((t) => t.situacao === "pago" && (periodo || pedido || (t.data_recebimento ?? "") >= inicioMes));
  const liquido = (l: Titulo[]) => l.reduce((s, t) => s + Number(t.valor_liquido), 0);
  const tarifasAbertas = abertos.reduce((s, t) => s + Number(t.tarifas), 0);
  const somaRecebida = recebidos.reduce((s, t) => s + Number(t.valor_recebido ?? 0), 0);

  const recebendo = filtros.receber ? abertos.find((t) => t.id === filtros.receber) : undefined;
  const criando = !!filtros.novo && pode(acesso, TELA, "criar");
  const [contasBancarias, clientes, categorias] = await Promise.all([
    recebendo ? carregarContasBancarias(recebendo.empresa_id) : Promise.resolve([]),
    criando ? carregarClientes() : Promise.resolve([]),
    criando ? carregarCategoriasReceita() : Promise.resolve([]),
  ]);

  const manterPeriodo = periodo ? `&de=${periodo.de}&ate=${periodo.ate}&por=${periodo.por}` : "";
  const origem = pedido
    ? `Títulos do pedido nº ${titulos[0]?.pedidos_venda?.numero ?? ""}`
    : periodo
      ? `${DATAS_PERIODO[periodo.por as keyof typeof DATAS_PERIODO]} de ${formatarData(periodo.de)} a ${formatarData(periodo.ate)}`
      : "Tudo em aberto e os recebidos dos últimos 120 dias";
  const colunas = ["Vencimento", ...(selecionada ? [] : ["Empresa"]), "Conta", "Cliente", "Valor", "Situação", ""];

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && (
          <Link href="/financeiro/receber/importar" className={estiloBotaoSecundario}>
            <FileUp size={16} /> Importar vendas das plataformas
          </Link>
        )}
        {pode(acesso, TELA, "criar") && !criando && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Nova conta
          </Link>
        )}
      </CabecalhoTela>

      {criando && (
        <Cartao titulo="Nova conta a receber">
          <FormAcao acao={novaConta} rotulo="Salvar" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Empresa que recebe" className="sm:col-span-2">
                <select name="empresa_id" required defaultValue={selecionada?.id ?? ""} className={estiloCampo}>
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
              <Campo rotulo="Cliente (opcional)" className="sm:col-span-2">
                <select name="cliente_id" defaultValue="" className={estiloCampo}>
                  <option value="">Nenhum</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Descrição" className="sm:col-span-2">
                <input name="descricao" required placeholder="Ex.: Venda avulsa no showroom" className={estiloCampo} />
              </Campo>
              <Campo rotulo="Categoria financeira" className="sm:col-span-2">
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
              <Campo rotulo="Valor de cada parcela (R$)">
                <input name="valor" required inputMode="decimal" className={estiloCampo} />
              </Campo>
              <Campo rotulo="Vencimento (1ª parcela)">
                <input name="vencimento" type="date" required defaultValue={hoje} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Parcelas" dica="Uma por mês, no mesmo dia.">
                <input name="parcelas" type="number" min={1} max={120} defaultValue={1} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Observação">
                <input name="observacao" className={estiloCampo} />
              </Campo>
            </div>
            <p className="text-xs text-texto-suave">
              Parcelas de pedidos das distribuidoras são geradas no próprio pedido, em Vendas › Pedidos de venda.
            </p>
            <div className="flex justify-end">
              <Link href="/financeiro/receber" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      {recebendo && pode(acesso, TELA, "editar") && (
        <Cartao titulo={`Receber: ${recebendo.descricao}${recebendo.parcela ? ` (${recebendo.parcela})` : ""}`}>
          <FormAcao acao={receberConta.bind(null, recebendo.id)} rotulo="Confirmar recebimento" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Data em que entrou">
                <input name="data_recebimento" type="date" required defaultValue={hoje} className={estiloCampo} />
              </Campo>
              <Campo
                rotulo={`Conta bancária (${nomeEmpresa.get(recebendo.empresa_id) ?? "empresa"})`}
                dica={contasBancarias.length === 0 ? "Esta empresa ainda não tem conta bancária cadastrada." : undefined}
              >
                <select name="conta_bancaria_id" required defaultValue={contasBancarias[0]?.id ?? ""} className={estiloCampo}>
                  {contasBancarias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Valor recebido (R$)" dica="O líquido, já sem as tarifas da plataforma.">
                <input name="valor_recebido" required inputMode="decimal" defaultValue={recebendo.valor_liquido} className={estiloCampo} />
              </Campo>
            </div>
            <div className="flex justify-end">
              <Link href="/financeiro/receber" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      {filtros.importadas !== undefined && (
        <p className="rounded-xl bg-sucesso/10 px-4 py-2.5 text-sm text-sucesso">
          {Number(filtros.importadas) === 1 ? "1 venda importada" : `${Number(filtros.importadas)} vendas importadas`}
          {Number(filtros.repetidas) > 0 && ` · ${Number(filtros.repetidas)} já estavam no sistema e ficaram como estavam`}.
        </p>
      )}

      <FaixaEmpresa empresa={selecionada} />

      {pedido ? (
        <p className="text-sm">
          {origem}. <LinkAcao href={`/vendas/pedidos/${pedido}`}>Abrir o pedido</LinkAcao> ·{" "}
          <LinkAcao href="/financeiro/receber">Ver todas as contas</LinkAcao>
        </p>
      ) : (
        <FiltroPeriodo periodo={periodo} hoje={hoje} campos={DATAS_PERIODO} semPeriodo="Em aberto e recentes" />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador
          rotulo="Vencido"
          valor={formatarMoeda(liquido(vencidos))}
          detalhe={`${vencidos.length} ${vencidos.length === 1 ? "conta" : "contas"}`}
          cor={vencidos.length ? "text-perigo" : ""}
          href={`?situacao=vencido${manterPeriodo}${pedido ? `&pedido=${pedido}` : ""}`}
          fonte={`Em aberto com vencimento antes de ${formatarData(hoje)}, pelo valor líquido.`}
        />
        <Indicador
          rotulo="Entra nos próximos 7 dias"
          valor={formatarMoeda(liquido(proximos))}
          detalhe={`${proximos.length} ${proximos.length === 1 ? "conta" : "contas"}`}
          href={`?situacao=semana${manterPeriodo}${pedido ? `&pedido=${pedido}` : ""}`}
          fonte={`Vencimento de ${formatarData(hoje)} a ${formatarData(semana)}, pelo valor líquido.`}
        />
        <Indicador
          rotulo={periodo || pedido ? "Em aberto na seleção" : "Total em aberto"}
          valor={formatarMoeda(liquido(abertos))}
          detalhe={tarifasAbertas > 0 ? `já sem ${formatarMoeda(tarifasAbertas)} de tarifas das plataformas` : `${abertos.length} contas`}
          href={`?situacao=aberto${manterPeriodo}${pedido ? `&pedido=${pedido}` : ""}`}
          fonte={`${origem}. Líquido = valor da venda − comissão e frete da plataforma.`}
        />
        <Indicador
          rotulo={periodo || pedido ? "Recebido na seleção" : "Recebido neste mês"}
          valor={formatarMoeda(somaRecebida)}
          detalhe={`${recebidos.length} ${recebidos.length === 1 ? "conta" : "contas"}`}
          cor="text-sucesso"
          href={`?situacao=pago${manterPeriodo}${pedido ? `&pedido=${pedido}` : ""}`}
          fonte={periodo || pedido ? `${origem}. Valor efetivamente recebido.` : `Recebimentos com data desde ${formatarData(inicioMes)}.`}
        />
      </div>

      <Filtro
        atalhos={[
          {
            rotulo: "Situação",
            opcoes: [
              { valor: "vencido", rotulo: "Vencidas" },
              { valor: "semana", rotulo: "Próximos 7 dias" },
              { valor: "aberto", rotulo: "Em aberto" },
              { valor: "pago", rotulo: "Recebidas" },
              { valor: "cancelado", rotulo: "Canceladas" },
            ],
          },
          {
            rotulo: "Origem",
            opcoes: Object.entries(CANAIS).map(([valor, rotulo]) => ({ valor, rotulo })),
          },
        ]}
        placeholder="Filtrar por cliente, pedido, descrição, empresa, valor..."
        iniciais={filtros.situacao ? { Situação: filtros.situacao } : {}}
      >
        <Tabela colunas={colunas} vazio="Nenhuma conta a receber. Gere as parcelas no pedido ou importe as vendas das plataformas.">
          {titulos.map((t) => {
            const vencido = t.situacao === "aberto" && t.vencimento < hoje;
            const tags = [
              t.situacao,
              t.canal,
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
                  {t.pedido_id ? (
                    <Link href={`/vendas/pedidos/${t.pedido_id}`} className="font-medium text-primaria hover:underline">
                      {t.descricao}
                    </Link>
                  ) : (
                    <span className="font-medium">{t.descricao}</span>
                  )}
                  {t.parcela && <span className="text-texto-suave"> · {t.parcela}</span>}
                  <span className="block text-xs text-texto-suave">
                    {CANAIS[t.canal as keyof typeof CANAIS] ?? t.canal}
                    {t.plano_contas && ` · ${t.plano_contas.codigo} ${t.plano_contas.nome}`}
                    {t.pedido_id && !t.descricao.startsWith("Pedido nº") && ` · pedido interno nº ${t.pedidos_venda?.numero}`}
                  </span>
                </Celula>
                <Celula className="text-texto-suave">
                  {t.clientes?.nome_fantasia || t.clientes?.nome || "—"}
                  {t.observacao && <span className="block text-xs">{t.observacao}</span>}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums">
                  {formatarMoeda(t.valor_liquido)}
                  {Number(t.tarifas) > 0 && (
                    <span className="block text-xs text-texto-suave">
                      venda {formatarMoeda(t.valor)} − tarifas {formatarMoeda(t.tarifas)}
                    </span>
                  )}
                  {t.situacao === "pago" && t.valor_recebido !== null && Number(t.valor_recebido) !== Number(t.valor_liquido) && (
                    <span className="block text-xs text-texto-suave">recebido {formatarMoeda(t.valor_recebido)}</span>
                  )}
                </Celula>
                <Celula>
                  {t.situacao === "pago" ? (
                    <>
                      <Etiqueta cor="sucesso">Recebido</Etiqueta>
                      <span className="block text-xs text-texto-suave">
                        {formatarData(t.data_recebimento)} · {t.contas_bancarias?.nome}
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
                          <LinkAcao href={`?receber=${t.id}${manterPeriodo}`}>Receber</LinkAcao>
                          <FormAcao
                            acao={cancelarConta.bind(null, t.id)}
                            rotulo="Cancelar"
                            enviando="..."
                            discreto
                            confirmar="Cancelar esta conta a receber?"
                          />
                        </>
                      )}
                      {t.situacao === "pago" && (
                        <FormAcao
                          acao={estornarRecebimento.bind(null, t.id)}
                          rotulo="Estornar"
                          enviando="..."
                          discreto
                          confirmar="Desfazer o recebimento? A conta volta para em aberto."
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
      <Fonte>
        Fonte: contas a receber de {selecionada?.nome ?? "todas as empresas"} · {origem}.
      </Fonte>
    </div>
  );
}
