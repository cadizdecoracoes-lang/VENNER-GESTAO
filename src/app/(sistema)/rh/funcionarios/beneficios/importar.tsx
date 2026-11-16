"use client";

import { FileUp } from "lucide-react";
import { useMemo, useState } from "react";
import { FormAcao } from "@/components/form-acao";
import { Campo, Cartao, Celula, Etiqueta, Tabela, estiloCampo } from "@/components/ui";
import { competenciaDoArquivo, lerPdfVA, lerPlanilhaVT, ROTULO_BENEFICIO, type LoteBeneficio } from "@/lib/beneficios";
import { hojeBrasil } from "@/lib/datas";
import { formatarMoeda } from "@/lib/formato";
import { mesAno } from "@/lib/holerite";
import { importarBeneficios } from "./actions";

export type Empresa = { id: string; nome: string };
export type MesGravado = { empresa_id: string; competencia: string; tipo: string };

// Escolher a planilha do VT (todas as abas) e o PDF do auxílio-alimentação,
// conferir e gravar. O mês do PDF vem do nome do arquivo e pode ser trocado.
export function ImportarBeneficios({
  empresas,
  empresaPadrao,
  cpfs,
  gravados,
}: {
  empresas: Empresa[];
  empresaPadrao: string;
  cpfs: string[];
  gravados: MesGravado[];
}) {
  const [lotes, setLotes] = useState<LoteBeneficio[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [lendo, setLendo] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState(empresaPadrao);
  const conhecidos = useMemo(() => new Set(cpfs), [cpfs]);
  const hoje = hojeBrasil();

  async function ler(lista: FileList | null) {
    if (!lista?.length) return;
    const novos: LoteBeneficio[] = [];
    const novosAvisos: string[] = [];
    for (const arquivo of [...lista]) {
      setLendo(`Lendo ${arquivo.name}...`);
      try {
        if (/\.pdf$/i.test(arquivo.name)) novos.push(await lerPdfVA(arquivo, competenciaDoArquivo(arquivo.name, hoje)));
        else novos.push(...(await lerPlanilhaVT(arquivo, Number(hoje.slice(0, 4)))));
      } catch (e) {
        novosAvisos.push(e instanceof Error ? e.message : `${arquivo.name}: não foi possível ler.`);
      }
    }
    // Mesmo tipo e mês lido de novo: fica a última leitura.
    const porChave = new Map<string, LoteBeneficio>();
    for (const l of [...lotes, ...novos]) porChave.set(`${l.tipo}|${l.competencia}`, l);
    setLotes([...porChave.values()].sort((a, b) => a.competencia.localeCompare(b.competencia) || a.tipo.localeCompare(b.tipo)));
    setAvisos((a) => [...a, ...novosAvisos, ...novos.flatMap((l) => l.avisos)]);
    setLendo(null);
  }

  const mudarMes = (i: number, mes: string) =>
    setLotes((atual) => atual.map((l, j) => (j === i && /^\d{4}-\d{2}$/.test(mes) ? { ...l, competencia: `${mes}-01` } : l)));

  const dados = JSON.stringify(lotes.map((l) => ({ empresa_id: empresa, tipo: l.tipo, competencia: l.competencia, linhas: l.linhas })));
  const total = lotes.reduce((s, l) => s + l.linhas.length, 0);

  return (
    <Cartao titulo="Importar VT e auxílio-alimentação">
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-fundo px-3 py-2 text-texto-suave hover:bg-primaria-suave/50">
            <FileUp size={18} className="text-primaria" />
            <span>
              <strong className="text-texto">Escolher arquivos</strong>: planilha do VT (.xlsx, uma aba por mês) e PDF do pedido do auxílio
            </span>
            <input type="file" multiple accept=".xlsx,.pdf" className="sr-only" disabled={!!lendo} onChange={(e) => ler(e.target.files)} />
          </label>
          <Campo rotulo="Empresa que paga" className="min-w-48">
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={estiloCampo}>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </Campo>
          {lendo && <span className="text-texto-suave">{lendo}</span>}
        </div>
        {avisos.length > 0 && (
          <ul className="space-y-0.5 rounded-lg bg-fundo px-3 py-2 text-xs text-texto-suave">
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
        {lotes.length > 0 && (
          <Tabela embutida colunas={["Origem", "Tipo", "Mês", "Pessoas", "CPF já no cadastro", "Total", ""]}>
            {lotes.map((l, i) => {
              const ligados = l.linhas.filter((x) => x.cpf && conhecidos.has(x.cpf)).length;
              const jaTem = gravados.some((g) => g.empresa_id === empresa && g.tipo === l.tipo && g.competencia === l.competencia);
              return (
                <tr key={`${l.tipo}${l.competencia}`}>
                  <Celula className="text-xs text-texto-suave">{l.origem}</Celula>
                  <Celula>{ROTULO_BENEFICIO[l.tipo]}</Celula>
                  <Celula>
                    <input
                      type="month"
                      value={l.competencia.slice(0, 7)}
                      onChange={(e) => mudarMes(i, e.target.value)}
                      className={`${estiloCampo} w-36 py-1`}
                      aria-label="Mês"
                    />
                  </Celula>
                  <Celula className="tabular-nums">{l.linhas.length}</Celula>
                  <Celula className="tabular-nums">
                    {ligados} de {l.linhas.length}
                  </Celula>
                  <Celula className="tabular-nums">{formatarMoeda(l.linhas.reduce((s, x) => s + x.valor, 0))}</Celula>
                  <Celula>{jaTem && <Etiqueta cor="alerta">{mesAno(l.competencia)} já importado: será trocado</Etiqueta>}</Celula>
                </tr>
              );
            })}
          </Tabela>
        )}
        {total > 0 && (
          <>
            <p className="text-xs text-texto-suave">
              Ao gravar, cada pessoa é ligada ao funcionário pelo CPF ou, sem CPF no cadastro, pelo nome (e o CPF da planilha completa o cadastro). Quem não for achado fica marcado "fora do cadastro", sem setor. Conta e chave PIX da planilha não são gravadas.
            </p>
            <FormAcao acao={importarBeneficios} rotulo={`Gravar ${total} linhas`} enviando="Gravando...">
              <input type="hidden" name="dados" value={dados} />
            </FormAcao>
          </>
        )}
      </div>
    </Cartao>
  );
}
