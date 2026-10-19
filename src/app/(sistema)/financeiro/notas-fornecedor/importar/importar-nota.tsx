"use client";

import { FileUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FormAcao } from "@/components/form-acao";
import { Campo, Cartao, Celula, Etiqueta, Tabela, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import { formatarDocumento, formatarMoeda, formatarNumero, somenteDigitos } from "@/lib/formato";
import { lerPdfDanfe, lerXmlNfe, type NotaLida, type Parcela } from "@/lib/nfe";
import { importarNota } from "../actions";

type Opcao = { id: string; nome: string };
type Props = {
  empresas: (Opcao & { cnpj: string })[];
  fornecedores: (Opcao & { documento: string | null })[];
  categorias: (Opcao & { codigo: string })[];
  centros: (Opcao & { codigo: string })[];
  // Categoria e centro de custo usados por último com cada fornecedor.
  ultimos: Record<string, { categoria_id: string | null; centro_custo_id: string | null }>;
};

const NOVO = "__novo__";

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso || new Date().toISOString().slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function ImportarNota({ empresas, fornecedores, categorias, centros, ultimos }: Props) {
  const [nota, setNota] = useState<NotaLida | null>(null);
  const [lendo, setLendo] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);

  const [empresa, setEmpresa] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [novoDoc, setNovoDoc] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [numero, setNumero] = useState("");
  const [serie, setSerie] = useState("");
  const [emissao, setEmissao] = useState("");
  const [total, setTotal] = useState("");
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [categoria, setCategoria] = useState("");
  const [centro, setCentro] = useState("");
  const [observacao, setObservacao] = useState("");

  async function ler(arquivo: File | undefined) {
    setNota(null);
    setErroLeitura(null);
    if (!arquivo) return;
    setLendo(true);
    try {
      const pdf = arquivo.name.toLowerCase().endsWith(".pdf") || arquivo.type === "application/pdf";
      const lida = pdf
        ? await lerPdfDanfe(
            arquivo,
            empresas.map((e) => e.cnpj),
          )
        : lerXmlNfe(await arquivo.text());

      const conhecido = fornecedores.find((f) => f.documento && f.documento === lida.emitente.documento);
      const empresaDaNota = empresas.find((e) => e.cnpj === lida.destinatario_cnpj);
      setEmpresa(empresaDaNota?.id ?? (empresas.length === 1 ? empresas[0].id : ""));
      setFornecedor(conhecido?.id ?? (lida.emitente.documento ? NOVO : ""));
      setNovoDoc(lida.emitente.documento);
      setNovoNome(lida.emitente.nome);
      setNumero(lida.numero);
      setSerie(lida.serie ?? "");
      setEmissao(lida.data_emissao);
      setTotal(lida.valor_total ? String(lida.valor_total) : "");
      setParcelas(lida.parcelas.length > 0 ? lida.parcelas : [{ vencimento: somarDias(lida.data_emissao, 30), valor: lida.valor_total }]);
      const ultimo = conhecido ? ultimos[conhecido.id] : undefined;
      setCategoria(ultimo?.categoria_id ?? "");
      setCentro(ultimo?.centro_custo_id ?? "");
      setNota(lida);
    } catch (e) {
      setErroLeitura(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      setLendo(false);
    }
  }

  const valorTotal = Number(total.replace(",", ".")) || 0;
  const somaParcelas = parcelas.reduce((t, p) => t + (Number(p.valor) || 0), 0);
  const diferenca = Math.round((valorTotal - somaParcelas) * 100) / 100;
  const empresaEscolhida = empresas.find((e) => e.id === empresa);
  const destinoDiferente = nota?.destinatario_cnpj && empresaEscolhida && empresaEscolhida.cnpj !== nota.destinatario_cnpj;

  const dados = useMemo(() => {
    if (!nota) return "";
    const novo = fornecedor === NOVO;
    return JSON.stringify({
      empresa_id: empresa,
      fornecedor_id: novo ? null : fornecedor || null,
      fornecedor: novo ? { ...nota.emitente, documento: somenteDigitos(novoDoc), nome: novoNome } : { documento: "" },
      numero: numero.trim(),
      serie: serie.trim() || null,
      chave: nota.chave,
      data_emissao: emissao,
      destinatario_cnpj: nota.origem === "xml" ? nota.destinatario_cnpj : null,
      origem: nota.origem,
      valor_produtos: nota.valor_produtos,
      valor_frete: nota.valor_frete,
      valor_desconto: nota.valor_desconto,
      valor_total: valorTotal,
      itens: nota.itens.map((i) => ({ ...i })),
      parcelas: parcelas.map((p) => ({ vencimento: p.vencimento, valor: Number(p.valor) })),
      categoria_id: categoria || null,
      centro_custo_id: centro || null,
      observacao,
    });
  }, [nota, empresa, fornecedor, novoDoc, novoNome, numero, serie, emissao, valorTotal, parcelas, categoria, centro, observacao]);

  const alterarParcela = (i: number, campo: keyof Parcela, valor: string) =>
    setParcelas((lista) =>
      lista.map((p, j) => (j === i ? { ...p, [campo]: campo === "valor" ? Number(valor.replace(",", ".")) : valor } : p)),
    );

  return (
    <FormAcao acao={importarNota} rotulo="Lançar nota" className="space-y-6">
      <Cartao titulo="Arquivo da nota">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl bg-fundo px-6 py-8 text-center text-sm text-texto-suave hover:bg-primaria-suave/50">
          <FileUp size={28} className="text-primaria" />
          <span>
            <strong className="text-texto">Escolha o XML ou o PDF (DANFE)</strong> da nota do fornecedor
          </span>
          <span className="text-xs">O XML traz todos os produtos e parcelas. Do PDF saem só os dados principais, para você conferir.</span>
          <input
            type="file"
            name="arquivo"
            accept=".xml,.pdf,application/xml,text/xml,application/pdf"
            className="sr-only"
            onChange={(e) => {
              setNomeArquivo(e.target.files?.[0]?.name ?? null);
              ler(e.target.files?.[0]);
            }}
          />
          <span className="mt-1 rounded-lg bg-superficie px-3 py-1.5 text-xs font-medium text-texto shadow-[0_0_0_1px_var(--color-borda)]">
            {nomeArquivo ?? "Escolher arquivo"}
          </span>
        </label>
        {lendo && <p className="mt-3 text-sm text-texto-suave">Lendo a nota...</p>}
        {erroLeitura && <p className="mt-3 text-sm text-perigo">{erroLeitura}</p>}
      </Cartao>

      {nota && (
        <>
          <input type="hidden" name="dados" value={dados} />
          {nota.avisos.length > 0 && (
            <div className="space-y-1 rounded-xl bg-alerta/10 px-4 py-3 text-sm text-alerta">
              {nota.avisos.map((a) => (
                <p key={a}>{a}</p>
              ))}
            </div>
          )}

          <Cartao titulo="Dados da nota" acoes={<Etiqueta cor="primaria">Lida do {nota.origem.toUpperCase()}</Etiqueta>}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Empresa que comprou" className="sm:col-span-2">
                <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} required className={estiloCampo}>
                  <option value="" disabled>
                    Escolha...
                  </option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome} · {formatarDocumento(e.cnpj)}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Fornecedor" className="sm:col-span-2">
                <select value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} required className={estiloCampo}>
                  <option value="" disabled>
                    Escolha...
                  </option>
                  <option value={NOVO}>Cadastrar fornecedor novo</option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                      {f.documento ? ` · ${formatarDocumento(f.documento)}` : ""}
                    </option>
                  ))}
                </select>
              </Campo>
              {fornecedor === NOVO && (
                <>
                  <Campo rotulo="CNPJ ou CPF do fornecedor novo">
                    <input value={novoDoc} onChange={(e) => setNovoDoc(e.target.value)} required className={estiloCampo} />
                  </Campo>
                  <Campo rotulo="Nome do fornecedor novo" className="sm:col-span-2 lg:col-span-3">
                    <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} required className={estiloCampo} />
                  </Campo>
                </>
              )}
              <Campo rotulo="Número">
                <input value={numero} onChange={(e) => setNumero(e.target.value)} required className={estiloCampo} />
              </Campo>
              <Campo rotulo="Série">
                <input value={serie} onChange={(e) => setSerie(e.target.value)} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Emissão">
                <input type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} required className={estiloCampo} />
              </Campo>
              <Campo rotulo="Valor total (R$)">
                <input
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  inputMode="decimal"
                  required
                  readOnly={nota.origem === "xml"}
                  className={estiloCampo}
                />
              </Campo>
            </div>
            {nota.chave && <p className="mt-3 text-xs text-texto-suave">Chave de acesso: {nota.chave.replace(/(\d{4})/g, "$1 ").trim()}</p>}
            {destinoDiferente && (
              <p className="mt-3 text-sm text-perigo">
                A nota foi emitida para o CNPJ {formatarDocumento(nota.destinatario_cnpj!)}, que não é o da empresa escolhida.
              </p>
            )}
          </Cartao>

          {nota.itens.length > 0 && (
            <Cartao titulo={`Produtos (${nota.itens.length})`}>
              <p className="-mt-2 mb-3 text-sm text-texto-suave">
                Depois de lançar, você vincula cada produto a um item do sistema (uma vez só por produto) e dá entrada no estoque.
              </p>
              <Tabela embutida colunas={["Código", "Descrição", "Quantidade", "Valor unitário", "Total"]}>
                {nota.itens.map((i, n) => (
                  <tr key={n}>
                    <Celula className="whitespace-nowrap text-texto-suave">{i.codigo}</Celula>
                    <Celula>{i.descricao}</Celula>
                    <Celula className="whitespace-nowrap tabular-nums">
                      {formatarNumero(i.quantidade)} {i.unidade}
                    </Celula>
                    <Celula className="tabular-nums">{formatarMoeda(i.valor_unitario)}</Celula>
                    <Celula className="tabular-nums">{formatarMoeda(i.valor_total)}</Celula>
                  </tr>
                ))}
              </Tabela>
            </Cartao>
          )}

          <Cartao titulo="Contas a pagar">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                rotulo="Categoria financeira"
                dica={categoria && fornecedor !== NOVO ? "Sugerida pela última nota deste fornecedor." : undefined}
              >
                <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={estiloCampo}>
                  <option value="">Sem categoria</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Centro de custo">
                <select value={centro} onChange={(e) => setCentro(e.target.value)} className={estiloCampo}>
                  <option value="">Sem centro de custo</option>
                  {centros.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <div className="mt-4 space-y-2">
              {parcelas.map((p, i) => (
                <div key={i} className="flex flex-wrap items-end gap-3">
                  <span className="w-12 pb-2 text-sm text-texto-suave">
                    {i + 1}/{parcelas.length}
                  </span>
                  <Campo rotulo="Vencimento">
                    <input
                      type="date"
                      value={p.vencimento}
                      onChange={(e) => alterarParcela(i, "vencimento", e.target.value)}
                      className={estiloCampo}
                    />
                  </Campo>
                  <Campo rotulo="Valor (R$)">
                    <input
                      defaultValue={p.valor}
                      onChange={(e) => alterarParcela(i, "valor", e.target.value)}
                      inputMode="decimal"
                      className={estiloCampo}
                    />
                  </Campo>
                  <button
                    type="button"
                    aria-label="Remover parcela"
                    onClick={() => setParcelas((l) => l.filter((_, j) => j !== i))}
                    className="mb-1 rounded p-1.5 text-texto-suave hover:bg-fundo hover:text-perigo"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setParcelas((l) => [...l, { vencimento: somarDias(l.at(-1)?.vencimento ?? emissao, 30), valor: 0 }])}
                  className={estiloBotaoSecundario}
                >
                  <Plus size={14} /> Parcela
                </button>
                <span className={`text-sm ${diferenca !== 0 ? "text-alerta" : "text-texto-suave"}`}>
                  Parcelas: {formatarMoeda(somaParcelas)}
                  {diferenca !== 0 && ` · diferença de ${formatarMoeda(diferenca)} para o total da nota`}
                </span>
              </div>
              {nota.parcelas.length === 0 && (
                <p className="text-xs text-texto-suave">A nota não trouxe as parcelas: confira o vencimento sugerido.</p>
              )}
            </div>
            <Campo rotulo="Observação" className="mt-4">
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} className={estiloCampo} />
            </Campo>
          </Cartao>
        </>
      )}

      <Link href="/financeiro/notas-fornecedor" className="text-sm text-texto-suave hover:text-texto">
        Voltar para as notas
      </Link>
    </FormAcao>
  );
}
