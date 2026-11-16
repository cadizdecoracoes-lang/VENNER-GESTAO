"use client";

import Link from "next/link";
import { FormAcao } from "@/components/form-acao";
import { TelaCliente } from "@/components/tela-cliente";
import { CabecalhoTela, Cartao, Celula, Etiqueta, SemAcesso, Tabela, estiloBotaoSecundario } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas } from "@/lib/empresa";
import { formatarData, formatarDocumento, formatarMoeda, formatarNumero } from "@/lib/formato";
import { mesAno, ROTULO_SETOR, ROTULO_TIPO_HOLERITE } from "@/lib/holerite";
import { notFound } from "@/lib/navegacao";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { confirmarAdmissao, salvarFuncionario } from "../actions";
import { CAMPOS_FUNCIONARIO, CamposFuncionario, type Funcionario } from "../campos";

const TELA = "rh.funcionarios";

type Holerite = {
  id: string;
  competencia: string;
  tipo: string;
  cargo: string | null;
  total_proventos: number;
  total_descontos: number;
  liquido: number;
  fgts: number;
  arquivo: string | null;
  holerite_eventos: {
    ordem: number;
    referencia: number | null;
    valor: number;
    eventos_folha: { codigo: string; descricao: string; tipo: "provento" | "desconto" | "informativo" } | null;
  }[];
};

async function carregar(id: string, verFolha: boolean) {
  if (!supabaseConfigurado) notFound();
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("funcionarios").select(CAMPOS_FUNCIONARIO).eq("id", id).maybeSingle();
  if (!data) notFound();
  let holerites: Holerite[] = [];
  if (verFolha) {
    const r = await supabase
      .from("holerites")
      .select(
        "id, competencia, tipo, cargo, total_proventos, total_descontos, liquido, fgts, arquivo, holerite_eventos(ordem, referencia, valor, eventos_folha(codigo, descricao, tipo))",
      )
      .eq("funcionario_id", id)
      .order("competencia", { ascending: false })
      .order("tipo", { ascending: false });
    holerites = (r.data ?? []) as unknown as Holerite[];
  }
  return { funcionario: data as Funcionario, holerites };
}

async function PaginaFuncionario({ searchParams }: { searchParams: Promise<{ id?: string; editar?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const { id, editar } = await searchParams;
  if (!id) notFound();
  const verFolha = pode(acesso, "rh.folha", "ver");
  const [{ funcionario: f, holerites }, empresas] = await Promise.all([carregar(id, verFolha), carregarEmpresas()]);
  const podeEditar = pode(acesso, TELA, "editar");
  const empresa = empresas.find((e) => e.id === f.empresa_id)?.nome ?? "—";
  const voltar = `/rh/funcionarios/ficha?id=${f.id}`;

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA}>
        <Link href="/rh/funcionarios" className={estiloBotaoSecundario}>
          Voltar à lista
        </Link>
      </CabecalhoTela>

      <Cartao
        titulo={f.nome}
        acoes={
          <div className="flex items-center gap-3">
            {f.ativo ? <Etiqueta cor="sucesso">Ativo</Etiqueta> : <Etiqueta>Desligado</Etiqueta>}
            {podeEditar && !editar && (
              <Link href={`${voltar}&editar=1`} className="text-sm text-primaria hover:underline">
                Editar
              </Link>
            )}
          </div>
        }
      >
        {editar && podeEditar ? (
          <FormAcao
            acao={salvarFuncionario.bind(null, { id: f.id, admissao: f.admissao })}
            rotulo="Salvar"
            className="space-y-3"
            extra={
              <Link href={voltar} className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            }
          >
            <p className="text-sm text-texto-suave">
              {empresa} · matrícula {f.matricula}
            </p>
            <CamposFuncionario valor={f} empresas={empresas} />
          </FormAcao>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Empresa empregadora", empresa],
                ["Matrícula", f.matricula],
                ["CPF", f.cpf ? formatarDocumento(f.cpf) : "Falta preencher"],
                ["Telefone", f.telefone ?? "—"],
                ["Cargo", f.cargo ?? "—"],
                ["Setor", f.setor ? ROTULO_SETOR[f.setor] : "Falta preencher"],
                ["CBO", f.cbo ?? "—"],
                ["Salário base", f.salario_base != null ? formatarMoeda(f.salario_base) : "—"],
                ["Admissão", f.admissao ? `${formatarData(f.admissao)}${f.admissao_estimada ? " (estimada pelo 1º holerite)" : ""}` : "Falta preencher"],
                ["Desligamento", formatarData(f.desligamento)],
                ["Observação", f.observacao ?? "—"],
              ] as const
            ).map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-texto-suave">{rotulo}</dt>
                <dd className={valor === "Falta preencher" || valor.endsWith("(estimada pelo 1º holerite)") ? "text-alerta" : ""}>
                  {valor}
                  {rotulo === "Admissão" && f.admissao_estimada && podeEditar && (
                    <FormAcao acao={confirmarAdmissao.bind(null, f.id)} rotulo="Está certa" discreto className="inline-block" />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Cartao>

      {verFolha && (
        <Tabela colunas={["Mês", "Tipo", "Cargo", "Proventos", "Descontos", "Líquido", "FGTS"]} vazio="Nenhum holerite importado deste funcionário.">
          {holerites.map((h) => (
            <tr key={h.id} className="align-top">
              <Celula className="whitespace-nowrap tabular-nums">{mesAno(h.competencia)}</Celula>
              <Celula>
                <details>
                  <summary className="cursor-pointer text-primaria">{ROTULO_TIPO_HOLERITE[h.tipo] ?? h.tipo}</summary>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {[...h.holerite_eventos]
                      .sort((a, b) => a.ordem - b.ordem)
                      .map((e, i) => (
                        <li key={i} className="flex justify-between gap-6 whitespace-nowrap">
                          <span>
                            {e.eventos_folha?.codigo} {e.eventos_folha?.descricao}
                            {e.referencia != null && <span className="text-texto-suave"> ({formatarNumero(e.referencia)})</span>}
                          </span>
                          <span className={`tabular-nums ${e.eventos_folha?.tipo === "desconto" ? "text-perigo" : ""}`}>
                            {e.eventos_folha?.tipo === "desconto" ? "−" : ""}
                            {formatarMoeda(e.valor)}
                          </span>
                        </li>
                      ))}
                    {h.arquivo && <li className="pt-1 text-texto-suave">Arquivo: {h.arquivo}</li>}
                  </ul>
                </details>
              </Celula>
              <Celula>{h.cargo ?? "—"}</Celula>
              <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(h.total_proventos)}</Celula>
              <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(h.total_descontos)}</Celula>
              <Celula className="whitespace-nowrap font-medium tabular-nums">{formatarMoeda(h.liquido)}</Celula>
              <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(h.fgts)}</Celula>
            </tr>
          ))}
        </Tabela>
      )}
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaFuncionario} />;
}
