"use client";

import { FileUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FormAcao } from "@/components/form-acao";
import { Cartao, Celula, Etiqueta, Tabela } from "@/components/ui";
import { formatarCnpj, formatarMoeda } from "@/lib/formato";
import {
  lerPdfHolerites,
  mesAno,
  resumirImportacao,
  ROTULO_TIPO_HOLERITE,
  type EmpresaCnpj,
  type FuncionarioExistente,
  type HoleriteArquivo,
  type MesImportado,
} from "@/lib/holerite";
import { importarHolerites } from "../actions";

export type Existente = FuncionarioExistente;
export type Mes = MesImportado;

export function ImportarHolerites({ empresas, funcionarios, meses }: { empresas: EmpresaCnpj[]; funcionarios: Existente[]; meses: Mes[] }) {
  const [holerites, setHolerites] = useState<HoleriteArquivo[]>([]);
  const [arquivos, setArquivos] = useState<string[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [lendo, setLendo] = useState<string | null>(null);
  // Matrículas (por CNPJ) que a pessoa desmarcou da lista de desligados.
  const [manter, setManter] = useState<Set<string>>(new Set());

  async function ler(lista: FileList | null) {
    if (!lista?.length) return;
    const novos: HoleriteArquivo[] = [];
    const avisosNovos: string[] = [];
    const arqs = [...lista];
    for (const [i, arquivo] of arqs.entries()) {
      setLendo(`Lendo ${arquivo.name} (${i + 1} de ${arqs.length})...`);
      try {
        const r = await lerPdfHolerites(arquivo);
        novos.push(...r.holerites.map((h) => ({ ...h, arquivo: arquivo.name })));
        avisosNovos.push(...r.avisos);
      } catch (e) {
        avisosNovos.push(e instanceof Error ? e.message : `${arquivo.name}: não foi possível ler.`);
      }
    }
    // O mesmo recibo lido de novo (outro arquivo) fica com a última leitura.
    const porChave = new Map<string, HoleriteArquivo>();
    for (const h of [...holerites, ...novos]) porChave.set(`${h.empregador_cnpj}|${h.competencia}|${h.tipo}|${h.matricula}`, h);
    setHolerites([...porChave.values()]);
    setArquivos((a) => [...a, ...arqs.map((f) => f.name)]);
    setAvisos((a) => [...a, ...avisosNovos]);
    setLendo(null);
  }

  const grupos = useMemo(() => resumirImportacao(holerites, empresas, funcionarios, meses), [holerites, empresas, funcionarios, meses]);
  const prontos = grupos.filter((g) => g.empresa);
  const dados = useMemo(
    () =>
      JSON.stringify(
        prontos.map((g) => ({
          empresa_id: g.empresa!.id,
          recibos: g.holerites.map(({ empregador_nome: _n, empregador_cnpj: _c, ...h }) => h),
          desligar: g.semHoleriteNoUltimoMes.map((s) => s.matricula).filter((m) => !manter.has(`${g.cnpj}|${m}`)),
        })),
      ),
    [prontos, manter],
  );
  const totalRecibos = prontos.reduce((s, g) => s + g.holerites.length, 0);

  return (
    <div className="space-y-6">
      <Cartao titulo="Arquivos da folha">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl bg-fundo px-6 py-8 text-center text-sm text-texto-suave hover:bg-primaria-suave/50">
          <FileUp size={28} className="text-primaria" />
          <span>
            <strong className="text-texto">Escolha os PDFs dos holerites</strong> (mensal e vale), um ou vários meses de uma vez
          </span>
          <span className="text-xs">
            O sistema lê cada recibo, confere os totais e mostra o que vai mudar antes de gravar. Nada é gravado até você confirmar.
          </span>
          <input type="file" multiple accept=".pdf,application/pdf" className="sr-only" disabled={!!lendo} onChange={(e) => ler(e.target.files)} />
          <span className="mt-1 rounded-lg bg-superficie px-3 py-1.5 text-xs font-medium text-texto shadow-[0_0_0_1px_var(--color-borda)]">
            {lendo ?? (arquivos.length ? `${arquivos.length} arquivos lidos · escolher mais` : "Escolher arquivos")}
          </span>
        </label>
        {avisos.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg bg-alerta/10 px-4 py-3 text-sm text-alerta">
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
      </Cartao>

      {grupos.map((g) => (
        <Cartao
          key={g.cnpj}
          titulo={`${g.empresa?.nome ?? g.empregador} · ${formatarCnpj(g.cnpj)}`}
          acoes={<Etiqueta cor={g.empresa ? "primaria" : "alerta"}>{g.holerites.length} recibos</Etiqueta>}
        >
          <div className="space-y-5 text-sm">
            {!g.empresa && (
              <p className="rounded-lg bg-perigo/10 px-3 py-2 text-perigo">
                A empresa {g.empregador} (CNPJ {formatarCnpj(g.cnpj)}) não está cadastrada no sistema, ou o seu perfil não a enxerga. Cadastre-a
                em <Link href="/config/empresas" className="underline">Configurações › Empresas</Link> e escolha os arquivos de novo. Estes
                recibos ficam de fora.
              </p>
            )}

            <Tabela embutida colunas={["Mês", "Tipo", "Recibos", "Líquido total", ""]}>
              {g.meses.map((m) => (
                <tr key={`${m.competencia}${m.tipo}`}>
                  <Celula className="tabular-nums">{mesAno(m.competencia)}</Celula>
                  <Celula>{ROTULO_TIPO_HOLERITE[m.tipo] ?? m.tipo}</Celula>
                  <Celula className="tabular-nums">{m.recibos}</Celula>
                  <Celula className="tabular-nums">{formatarMoeda(m.liquido)}</Celula>
                  <Celula>{m.jaImportados > 0 && <Etiqueta cor="alerta">{m.jaImportados} já importados: serão trocados</Etiqueta>}</Celula>
                </tr>
              ))}
            </Tabela>

            {g.novos.length > 0 && (
              <div>
                <p className="font-medium">{g.novos.length} funcionários novos no cadastro</p>
                <p className="text-texto-suave">{g.novos.map((n) => `${n.nome} (${n.matricula}${n.cargo ? `, ${n.cargo.toLowerCase()}` : ""})`).join(" · ")}</p>
              </div>
            )}

            {g.mudancas.length > 0 && (
              <div>
                <p className="font-medium">Mudanças pelo holerite mais recente</p>
                <ul className="text-texto-suave">
                  {g.mudancas.map((m, i) => (
                    <li key={i}>
                      {m.nome}: {m.antes} → {m.depois}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {g.semHoleriteNoUltimoMes.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">Sem holerite em {mesAno(g.ultimoMes)}: marcar como desligados?</p>
                <p className="text-texto-suave">Desmarque quem continua trabalhando (afastado, férias...). A data do desligamento você completa na ficha.</p>
                {g.semHoleriteNoUltimoMes.map((s) => {
                  const chave = `${g.cnpj}|${s.matricula}`;
                  return (
                    <label key={chave} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!manter.has(chave)}
                        onChange={(e) =>
                          setManter((atual) => {
                            const novo = new Set(atual);
                            if (e.target.checked) novo.delete(chave);
                            else novo.add(chave);
                            return novo;
                          })
                        }
                      />
                      {s.nome} <span className="text-texto-suave">(último holerite {s.ultimo ? mesAno(s.ultimo) : "—"})</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </Cartao>
      ))}

      {totalRecibos > 0 && (
        <FormAcao acao={importarHolerites} rotulo={`Gravar ${totalRecibos} recibos`} enviando="Gravando...">
          <input type="hidden" name="dados" value={dados} />
        </FormAcao>
      )}
    </div>
  );
}
