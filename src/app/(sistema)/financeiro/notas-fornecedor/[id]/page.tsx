import { FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormAcao } from "@/components/form-acao";
import {
  Campo,
  CabecalhoTela,
  Cartao,
  Celula,
  Etiqueta,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { formatarData, formatarDocumento, formatarMoeda, formatarNumero } from "@/lib/formato";
import { ORIGENS_NOTA, SITUACOES_TITULO, type OrigemNota, type SituacaoTitulo } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { darEntrada, vincularItem } from "../actions";

const TELA = "financeiro.notas_fornecedor";

type Nota = {
  id: string;
  numero: string;
  serie: string | null;
  chave: string | null;
  data_emissao: string;
  valor_produtos: number;
  valor_frete: number;
  valor_desconto: number;
  valor_total: number;
  origem: OrigemNota;
  arquivo: string | null;
  observacao: string | null;
  entrada_em: string | null;
  empresas: { razao_social: string; nome_fantasia: string | null; cnpj: string } | null;
  fornecedores: { nome: string; documento: string | null } | null;
  locais_estoque: { nome: string } | null;
};
type Linha = {
  id: string;
  ordem: number;
  codigo_fornecedor: string;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  item_id: string | null;
  fator: number;
  valor_unitario_anterior: number | null;
  numero_anterior: string | null;
  data_anterior: string | null;
  variacao_preco_pct: number | null;
  produto_novo: boolean;
};
type Item = { id: string; codigo: string; descricao: string; unidade: string };
type Titulo = { id: string; parcela: string | null; vencimento: string; valor: number; situacao: SituacaoTitulo };

function Variacao({ pct }: { pct: number | null }) {
  if (pct === null || pct === 0) return <span className="text-texto-suave">igual</span>;
  return (
    <span className={pct > 0 ? "text-perigo" : "text-sucesso"}>
      {pct > 0 ? "+" : ""}
      {formatarNumero(pct)}%
    </span>
  );
}

export default async function PaginaNota({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vincular?: string }>;
}) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  if (!supabaseConfigurado) notFound();
  const [{ id }, { vincular }] = await Promise.all([params, searchParams]);

  const supabase = await criarClienteServidor();
  const [{ data: nota }, { data: linhas }, { data: itens }, { data: locais }, { data: titulos }] = await Promise.all([
    supabase
      .from("notas_fornecedor")
      .select(
        "id, numero, serie, chave, data_emissao, valor_produtos, valor_frete, valor_desconto, valor_total, origem, arquivo, observacao, entrada_em, empresas(razao_social, nome_fantasia, cnpj), fornecedores(nome, documento), locais_estoque(nome)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("nota_fornecedor_itens_comparacao").select("*").eq("nota_id", id).order("ordem"),
    supabase.from("itens").select("id, codigo, descricao, unidade").eq("ativo", true).neq("tipo", "servico").order("codigo"),
    supabase.from("locais_estoque").select("id, nome").eq("ativo", true).order("nome"),
    pode(acesso, "financeiro.pagar", "ver")
      ? supabase.from("contas_pagar").select("id, parcela, vencimento, valor, situacao").eq("nota_id", id).order("vencimento")
      : Promise.resolve({ data: null }),
  ]);
  if (!nota) notFound();
  const n = nota as unknown as Nota;
  const lista = (linhas ?? []) as Linha[];
  const porId = new Map(((itens ?? []) as Item[]).map((i) => [i.id, i]));
  const faltam = lista.filter((l) => !l.item_id).length;
  const podeEditar = pode(acesso, TELA, "editar") && !n.entrada_em;
  const caminho = `/financeiro/notas-fornecedor/${n.id}`;

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        <Link href="/financeiro/notas-fornecedor" className={estiloBotaoSecundario}>
          Voltar
        </Link>
      </CabecalhoTela>

      <Cartao
        titulo={`NF ${n.numero}${n.serie ? ` · série ${n.serie}` : ""} · ${n.fornecedores?.nome ?? ""}`}
        acoes={
          n.arquivo && (
            <a
              href={`${caminho}/arquivo`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primaria hover:underline"
            >
              <FileText size={14} /> Abrir {ORIGENS_NOTA[n.origem]}
            </a>
          )
        }
      >
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-texto-suave">Empresa que comprou</dt>
            <dd>{n.empresas?.nome_fantasia || n.empresas?.razao_social}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Fornecedor</dt>
            <dd>{formatarDocumento(n.fornecedores?.documento ?? null)}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Emissão</dt>
            <dd>{formatarData(n.data_emissao)}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Valor total</dt>
            <dd className="font-medium tabular-nums">{formatarMoeda(n.valor_total)}</dd>
          </div>
          {n.origem === "xml" && (
            <div className="text-texto-suave sm:col-span-2 lg:col-span-4">
              Produtos {formatarMoeda(n.valor_produtos)} · frete {formatarMoeda(n.valor_frete)} · desconto {formatarMoeda(n.valor_desconto)}
            </div>
          )}
          {n.chave && (
            <div className="text-xs text-texto-suave sm:col-span-2 lg:col-span-4">Chave {n.chave.replace(/(\d{4})/g, "$1 ").trim()}</div>
          )}
          {n.observacao && <div className="sm:col-span-2 lg:col-span-4">{n.observacao}</div>}
        </dl>
      </Cartao>

      {lista.length > 0 ? (
        <Cartao
          titulo="Produtos e comparação com a compra anterior"
          acoes={faltam > 0 ? <Etiqueta cor="alerta">{faltam} sem vínculo</Etiqueta> : <Etiqueta cor="sucesso">Todos vinculados</Etiqueta>}
        >
          <Tabela embutida colunas={["Produto do fornecedor", "Quantidade", "Valor unitário", "Compra anterior", "Item no sistema"]}>
            {lista.map((l) => {
              const item = l.item_id ? porId.get(l.item_id) : undefined;
              const editando =
                vincular === l.id || (!l.item_id && podeEditar && vincular === undefined && lista.find((x) => !x.item_id)?.id === l.id);
              return (
                <tr key={l.id}>
                  <Celula>
                    <span className="font-medium">{l.descricao}</span>
                    <span className="block text-xs text-texto-suave">Cód. {l.codigo_fornecedor}</span>
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">
                    {formatarNumero(l.quantidade)} {l.unidade}
                    {item && l.fator !== 1 && (
                      <span className="block text-xs text-texto-suave">
                        = {formatarNumero(l.quantidade * l.fator)} {item.unidade}
                      </span>
                    )}
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">
                    {formatarMoeda(l.valor_unitario)}
                    <span className="block text-xs text-texto-suave">total {formatarMoeda(l.valor_total)}</span>
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">
                    {l.produto_novo ? (
                      <Etiqueta cor="primaria">Primeira compra</Etiqueta>
                    ) : (
                      <>
                        {formatarMoeda(l.valor_unitario_anterior ?? 0)} <Variacao pct={l.variacao_preco_pct} />
                        <span className="block text-xs text-texto-suave">
                          NF {l.numero_anterior} de {formatarData(l.data_anterior)}
                        </span>
                      </>
                    )}
                  </Celula>
                  <Celula className="min-w-72">
                    {editando && podeEditar ? (
                      <FormAcao acao={vincularItem.bind(null, n.id, l.id)} rotulo="Vincular" secundario className="space-y-2">
                        <select name="item_id" required defaultValue={l.item_id ?? ""} className={estiloCampo}>
                          <option value="" disabled>
                            Escolha o item...
                          </option>
                          {[...porId.values()].map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.codigo} · {i.descricao} ({i.unidade})
                            </option>
                          ))}
                        </select>
                        <Campo rotulo={`1 ${l.unidade ?? "un."} do fornecedor equivale a quantas unidades do item?`}>
                          <input name="fator" defaultValue={l.fator} inputMode="decimal" className={estiloCampo} />
                        </Campo>
                      </FormAcao>
                    ) : item ? (
                      <>
                        <span className="whitespace-nowrap">{item.codigo}</span> · {item.descricao}
                        {podeEditar && (
                          <span className="ml-2">
                            <LinkAcao href={`?vincular=${l.id}`}>Alterar</LinkAcao>
                          </span>
                        )}
                      </>
                    ) : podeEditar ? (
                      <LinkAcao href={`?vincular=${l.id}`}>Vincular</LinkAcao>
                    ) : (
                      <span className="text-texto-suave">Sem vínculo</span>
                    )}
                  </Celula>
                </tr>
              );
            })}
          </Tabela>
          <p className="mt-3 text-xs text-texto-suave">
            O vínculo fica memorizado: nas próximas notas deste fornecedor, o mesmo produto já chega vinculado.
          </p>
        </Cartao>
      ) : (
        <p className="rounded-xl bg-fundo px-4 py-3 text-sm text-texto-suave">
          Nota lançada pelo PDF: os produtos não vêm no PDF, então ela não dá entrada no estoque. Para isso, importe o XML desta nota.
        </p>
      )}

      {lista.length > 0 && (
        <Cartao titulo="Estoque">
          {n.entrada_em ? (
            <p className="text-sm">
              <Etiqueta cor="sucesso">Entrada feita</Etiqueta> em {formatarData(n.entrada_em)} no local {n.locais_estoque?.nome}.
            </p>
          ) : faltam > 0 ? (
            <p className="text-sm text-texto-suave">Vincule todos os produtos a itens do sistema para dar entrada no estoque.</p>
          ) : pode(acesso, TELA, "editar") ? (
            <FormAcao
              acao={darEntrada.bind(null, n.id)}
              rotulo="Dar entrada no estoque"
              enviando="Lançando..."
              confirmar="Confirma a entrada destes produtos no estoque? Depois disso a nota não pode mais ser alterada."
              className="flex flex-wrap items-end gap-4"
            >
              <Campo rotulo="Local de estoque">
                <select name="local_id" required defaultValue={(locais ?? [])[0]?.id ?? ""} className={estiloCampo}>
                  {(locais ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </Campo>
            </FormAcao>
          ) : (
            <p className="text-sm text-texto-suave">Aguardando a entrada no estoque.</p>
          )}
        </Cartao>
      )}

      {titulos && (
        <Cartao titulo="Contas a pagar desta nota">
          <Tabela embutida colunas={["Parcela", "Vencimento", "Valor", "Situação"]} vazio="Esta nota não gerou contas a pagar.">
            {(titulos as Titulo[]).map((t) => (
              <tr key={t.id}>
                <Celula>{t.parcela ?? "Única"}</Celula>
                <Celula className="tabular-nums">{formatarData(t.vencimento)}</Celula>
                <Celula className="tabular-nums">{formatarMoeda(t.valor)}</Celula>
                <Celula>
                  <Etiqueta cor={t.situacao === "pago" ? "sucesso" : "neutra"}>{SITUACOES_TITULO[t.situacao]}</Etiqueta>
                </Celula>
              </tr>
            ))}
          </Tabela>
        </Cartao>
      )}
    </div>
  );
}
