"use client";

import { Check, FileUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Campo, Cartao, Celula, Indicador, Tabela, estiloBotao, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import { mensagemErro, SEM_BANCO } from "@/lib/erros";
import { formatarNumero } from "@/lib/formato";
import { lerPlanilhaTinyReceber, type Celula as CelulaPlanilha, type LinhaTinyReceber } from "@/lib/planilha-tiny-receber";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

type Opcao = { id: string; nome: string };
type Resultado = {
  linhas: number;
  iguais: number;
  corrigidos: number;
  para_recebido: number;
  para_aberto: number;
  para_cancelado: number;
  aplicado: boolean;
  corrigir: { titulo: string; de: string; para: string }[];
  mantidos: string[];
  nao_achados: string[];
  so_aqui: string[];
  so_aqui_total: number;
};
type Lista = "corrigir" | "mantidos" | "nao_achados" | "so_aqui";

const ROTULOS: Record<Lista, string> = {
  corrigir: "A corrigir",
  mantidos: "Mantidos",
  nao_achados: "Não achados",
  so_aqui: "Em aberto só aqui",
};

export function ConferirTinyReceber({ empresas, empresaInicial }: { empresas: Opcao[]; empresaInicial: string }) {
  const [empresa, setEmpresa] = useState(empresaInicial);
  const [linhas, setLinhas] = useState<LinhaTinyReceber[] | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [lista, setLista] = useState<Lista>("corrigir");

  async function conferir(dados: LinhaTinyReceber[], aplicar: boolean) {
    if (!supabaseConfigurado) return setErro(SEM_BANCO.erro ?? null);
    if (!empresa) return setErro("Escolha a empresa (CNPJ) dos títulos.");
    setErro(null);
    setOcupado(aplicar ? "Corrigindo os títulos..." : "Conferindo com os títulos daqui...");
    const { data, error } = await criarClienteNavegador().rpc("tiny_aplicar_planilha_receber", { empresa, linhas: dados, aplicar });
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
      const leitura = lerPlanilhaTinyReceber((await lerXlsx(f)) as CelulaPlanilha[][]);
      setOcupado(null);
      if (leitura.erro) return setErro(leitura.erro);
      if (!leitura.linhas.length) return setErro("A planilha não tem títulos.");
      setLinhas(leitura.linhas);
      await conferir(leitura.linhas, false);
    } catch {
      setOcupado(null);
      setErro("Não foi possível ler o arquivo. Use a planilha .xlsx de contas a receber exportada do Tiny.");
    }
  }

  const r = resultado;
  const contagem = (k: Lista) =>
    !r ? 0 : k === "corrigir" ? r.corrigidos : k === "so_aqui" ? r.so_aqui_total : k === "mantidos" ? r.mantidos.length : r.nao_achados.length;
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <Indicador rotulo="Linhas da planilha" valor={formatarNumero(r.linhas)} />
            <Indicador rotulo="Já iguais ao Tiny" valor={formatarNumero(r.iguais)} />
            <Indicador
              rotulo={r.aplicado ? "Ficaram recebidos" : "Ficam recebidos"}
              valor={formatarNumero(r.para_recebido)}
              cor={r.para_recebido ? "text-primaria" : undefined}
              fonte="Em aberto (ou vencidos) aqui e recebidos no Tiny: ficam recebidos com a data e a conta do Tiny."
            />
            <Indicador
              rotulo={r.aplicado ? "Voltaram para aberto" : "Voltam para aberto"}
              valor={formatarNumero(r.para_aberto)}
              cor={r.para_aberto ? "text-primaria" : undefined}
              fonte="Recebidos aqui pela leitura do Tiny, mas em aberto no Tiny."
            />
            <Indicador
              rotulo="Mantidos"
              valor={formatarNumero(r.mantidos.length)}
              fonte="Recebidos, cancelados ou conciliados aqui no sistema: não mudam pela planilha."
            />
            <Indicador
              rotulo="Não achados"
              valor={formatarNumero(r.nao_achados.length)}
              fonte="Sem título aqui com o mesmo cliente, vencimento e valor."
            />
          </div>

          <Cartao
            acoes={
              <div className="flex flex-wrap items-center gap-3">
                {(Object.keys(ROTULOS) as Lista[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setLista(k)}
                    className={`text-sm ${lista === k ? "font-semibold text-primaria" : "text-texto-suave hover:text-primaria"}`}
                    title={k === "so_aqui" ? "Em aberto aqui, no período da planilha, sem linha no Tiny: lançados aqui, pela nota ou pelo pedido, ou repetidos. Só para conferir; não mudam." : undefined}
                  >
                    {k === "corrigir" && r.aplicado ? "Corrigidos" : ROTULOS[k]} ({formatarNumero(contagem(k))})
                  </button>
                ))}
                {r.aplicado ? (
                  <Link href="/financeiro/receber" className={estiloBotao}>
                    <Check size={16} /> Pronto, ver contas a receber
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
                  {(lista === "mantidos" ? r.mantidos : lista === "so_aqui" ? r.so_aqui : r.nao_achados).map((t, i) => (
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
