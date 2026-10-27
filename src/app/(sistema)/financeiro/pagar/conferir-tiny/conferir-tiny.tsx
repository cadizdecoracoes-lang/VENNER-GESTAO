"use client";

import { Check, FileUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Campo, Cartao, Celula, Indicador, Tabela, estiloBotao, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import { mensagemErro, SEM_BANCO } from "@/lib/erros";
import { formatarNumero } from "@/lib/formato";
import { lerPlanilhaTinyPagar, type Celula as CelulaPlanilha, type LinhaTinyPagar } from "@/lib/planilha-tiny-pagar";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

type Opcao = { id: string; nome: string };
type Resultado = {
  linhas: number;
  iguais: number;
  corrigidos: number;
  aplicado: boolean;
  corrigir: { titulo: string; de: string; para: string }[];
  mantidos: string[];
  nao_achados: string[];
};

export function ConferirTiny({ empresas, empresaInicial }: { empresas: Opcao[]; empresaInicial: string }) {
  const [empresa, setEmpresa] = useState(empresaInicial);
  const [linhas, setLinhas] = useState<LinhaTinyPagar[] | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [lista, setLista] = useState<"corrigir" | "mantidos" | "nao_achados">("corrigir");

  async function conferir(dados: LinhaTinyPagar[], aplicar: boolean) {
    if (!supabaseConfigurado) return setErro(SEM_BANCO.erro ?? null);
    if (!empresa) return setErro("Escolha a empresa (CNPJ) dos títulos.");
    setErro(null);
    setOcupado(aplicar ? "Corrigindo os títulos..." : "Conferindo com os títulos daqui...");
    const { data, error } = await criarClienteNavegador().rpc("tiny_aplicar_planilha_pagar", {
      empresa,
      linhas: dados,
      aplicar,
    });
    setOcupado(null);
    if (error) return setErro(mensagemErro(error));
    setResultado(data as Resultado);
  }

  async function ler(f: File | undefined) {
    setLinhas(null);
    setResultado(null);
    setErro(null);
    if (!f) return;
    setArquivo(f.name);
    setOcupado("Lendo a planilha...");
    try {
      const { default: lerXlsx } = await import("read-excel-file");
      const leitura = lerPlanilhaTinyPagar((await lerXlsx(f)) as CelulaPlanilha[][]);
      setOcupado(null);
      if (leitura.erro) return setErro(leitura.erro);
      if (!leitura.linhas.length) return setErro("A planilha não tem títulos.");
      setLinhas(leitura.linhas);
      await conferir(leitura.linhas, false);
    } catch {
      setOcupado(null);
      setErro("Não foi possível ler o arquivo. Use a planilha .xlsx exportada do Tiny.");
    }
  }

  const r = resultado;
  return (
    <div className="space-y-3">
      <Cartao>
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <Campo rotulo="Empresa" className="min-w-56">
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={estiloCampo}>
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
          <label className={`${estiloBotaoSecundario} cursor-pointer`}>
            <FileUp size={16} /> {arquivo ?? "Planilha do Tiny (.xlsx)"}
            <input type="file" accept=".xlsx" className="hidden" onChange={(e) => ler(e.target.files?.[0])} />
          </label>
          {ocupado && <span className="text-sm text-texto-suave">{ocupado}</span>}
          {erro && <span className="text-sm text-perigo">{erro}</span>}
        </div>
      </Cartao>

      {r && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Indicador rotulo="Linhas da planilha" valor={formatarNumero(r.linhas)} />
            <Indicador rotulo="Já iguais ao Tiny" valor={formatarNumero(r.iguais)} />
            <Indicador
              rotulo={r.aplicado ? "Corrigidos" : "A corrigir"}
              valor={formatarNumero(r.corrigidos)}
              href="#lista"
              cor={r.corrigidos ? "text-primaria" : undefined}
              fonte="Situação, data do pagamento, valor pago ou conta diferente do Tiny."
            />
            <Indicador
              rotulo="Baixados aqui (mantidos)"
              valor={formatarNumero(r.mantidos.length)}
              fonte="Pagos aqui no sistema ou conciliados com o extrato: não mudam pela planilha."
            />
            <Indicador
              rotulo="Não achados"
              valor={formatarNumero(r.nao_achados.length)}
              fonte="Sem título do Tiny com o mesmo fornecedor, vencimento e valor (ex.: pago antes de 2026)."
            />
          </div>

          <Cartao
            acoes={
              <div className="flex flex-wrap items-center gap-2">
                {(["corrigir", "mantidos", "nao_achados"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setLista(k)}
                    className={`text-sm ${lista === k ? "font-semibold text-primaria" : "text-texto-suave hover:text-primaria"}`}
                  >
                    {k === "corrigir" ? (r.aplicado ? "Corrigidos" : "A corrigir") : k === "mantidos" ? "Mantidos" : "Não achados"}
                  </button>
                ))}
                {r.aplicado ? (
                  <Link href="/financeiro/pagar" className={estiloBotao}>
                    <Check size={16} /> Pronto, ver contas a pagar
                  </Link>
                ) : (
                  r.corrigidos > 0 &&
                  linhas && (
                    <button
                      type="button"
                      disabled={!!ocupado}
                      onClick={() => {
                        if (confirm(`Corrigir ${r.corrigidos} títulos para ficarem iguais ao Tiny?`)) conferir(linhas, true);
                      }}
                      className={estiloBotao}
                    >
                      <Check size={16} /> Corrigir {formatarNumero(r.corrigidos)} títulos
                    </button>
                  )
                )}
              </div>
            }
          >
            <div id="lista">
              {lista === "corrigir" ? (
                <Tabela colunas={["Título", "Aqui estava", "Fica como no Tiny"]} vazio="Nada a corrigir." embutida>
                  {r.corrigir.map((c, i) => (
                    <tr key={i}>
                      <Celula>{c.titulo}</Celula>
                      <Celula className="text-texto-suave">{c.de}</Celula>
                      <Celula>{c.para}</Celula>
                    </tr>
                  ))}
                </Tabela>
              ) : (
                <Tabela colunas={["Título"]} vazio="Nenhum." embutida>
                  {(lista === "mantidos" ? r.mantidos : r.nao_achados).map((t, i) => (
                    <tr key={i}>
                      <Celula>{t}</Celula>
                    </tr>
                  ))}
                </Tabela>
              )}
            </div>
          </Cartao>
        </>
      )}
    </div>
  );
}
