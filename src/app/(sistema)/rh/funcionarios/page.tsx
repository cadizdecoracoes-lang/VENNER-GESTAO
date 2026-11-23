"use client";

import { FileUp, Plus } from "lucide-react";
import Link from "next/link";
import { ATALHO_SITUACAO, Filtro } from "@/components/filtro";
import { FormAcao } from "@/components/form-acao";
import { TelaCliente } from "@/components/tela-cliente";
import {
  CabecalhoTela,
  Cartao,
  Celula,
  Etiqueta,
  Indicador,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloBotaoSecundario,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { mesAno, ROTULO_SETOR, type Setor } from "@/lib/holerite";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { salvarFuncionario } from "./actions";
import { CAMPOS_FUNCIONARIO, CamposFuncionario, SETORES, type Funcionario } from "./campos";

const TELA = "rh.funcionarios";

type CustoMes = { competencia: string; setor: Setor | "sem_setor"; funcionarios: number; custo: number; liquido_pago: number };

async function carregar(empresa: string | null, verFolha: boolean) {
  if (!supabaseConfigurado) return { funcionarios: [] as Funcionario[], ultimos: new Map<string, string>(), custos: [] as CustoMes[] };
  const supabase = criarClienteNavegador();
  let consulta = supabase.from("funcionarios").select(CAMPOS_FUNCIONARIO).order("nome").limit(3000);
  if (empresa) consulta = consulta.eq("empresa_id", empresa);
  let custos = supabase.from("folha_custo_mensal").select("competencia, setor, funcionarios, custo, liquido_pago").order("competencia");
  if (empresa) custos = custos.eq("empresa_id", empresa);
  const [f, u, c] = await Promise.all([
    consulta,
    verFolha ? supabase.from("funcionarios_ultimo_holerite").select("funcionario_id, competencia") : Promise.resolve({ data: [] }),
    verFolha ? custos : Promise.resolve({ data: [] }),
  ]);
  return {
    funcionarios: (f.data ?? []) as Funcionario[],
    ultimos: new Map(((u.data ?? []) as { funcionario_id: string; competencia: string }[]).map((h) => [h.funcionario_id, h.competencia])),
    custos: ((c.data ?? []) as CustoMes[]).map((x) => ({ ...x, custo: Number(x.custo), liquido_pago: Number(x.liquido_pago) })),
  };
}

// Custo por mês (linhas) e setor (colunas), com o total.
function montarCustos(custos: CustoMes[]) {
  const meses = [...new Set(custos.map((c) => c.competencia))].sort();
  const setores = [...SETORES.map(([v]) => v as Setor | "sem_setor"), "sem_setor" as const].filter((s) => custos.some((c) => c.setor === s));
  const linhas = meses.map((m) => {
    const doMes = custos.filter((c) => c.competencia === m);
    const porSetor = Object.fromEntries(setores.map((s) => [s, doMes.find((c) => c.setor === s)?.custo ?? 0]));
    return {
      competencia: m,
      porSetor,
      total: doMes.reduce((s, c) => s + c.custo, 0),
      pessoas: doMes.reduce((s, c) => s + c.funcionarios, 0),
    };
  });
  return { setores, linhas };
}

async function PaginaFuncionarios({ searchParams }: { searchParams: Promise<{ novo?: string; importados?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const verFolha = pode(acesso, "rh.folha", "ver");
  const { funcionarios, ultimos, custos } = await carregar(selecionada?.id ?? null, verFolha);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const mostrarForm = filtros.novo && pode(acesso, TELA, "criar");
  const importar = pode(acesso, TELA, "criar") && pode(acesso, "rh.folha", "criar");
  const ativos = funcionarios.filter((f) => f.ativo);
  const { setores, linhas } = montarCustos(custos);
  const ultimo = linhas.at(-1);
  const anteriores = linhas.slice(-4, -1);
  const media = anteriores.length ? anteriores.reduce((s, l) => s + l.total, 0) / anteriores.length : null;
  const producao = ultimo?.porSetor.producao ?? 0;
  const porSetor = SETORES.map(([v, r]) => [r, ativos.filter((f) => f.setor === v).length] as const).filter(([, n]) => n > 0);
  const semSetor = ativos.filter((f) => !f.setor).length;

  return (
    <div className="space-y-3">
      <CabecalhoTela
        codigo={TELA}
        empresa={selecionada}
        ajuda="Cargo e salário base seguem o holerite mensal mais recente importado. O holerite não traz admissão nem setor: a admissão é estimada pelo primeiro holerite com mês incompleto (marcada como estimada) e o setor é sugerido pelo cargo. Corrija na ficha de cada um."
      >
        {verFolha && (
          <Link href="/rh/funcionarios/beneficios" className={estiloBotaoSecundario}>
            VT e alimentação
          </Link>
        )}
        {importar && (
          <Link href="/rh/funcionarios/importar" className={estiloBotaoSecundario}>
            <FileUp size={16} /> Importar holerites
          </Link>
        )}
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Novo funcionário
          </Link>
        )}
      </CabecalhoTela>

      {filtros.importados && (
        <p className="rounded-lg bg-sucesso/10 px-3 py-1.5 text-sm text-sucesso">
          {filtros.importados} recibos gravados. Confira setor e admissão de quem entrou agora.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Indicador
          rotulo="Ativos"
          valor={ativos.length}
          detalhe={[...porSetor.map(([r, n]) => `${n} ${r.toLowerCase()}`), ...(semSetor ? [`${semSetor} sem setor`] : [])].join(" · ")}
          fonte="Funcionários ativos no cadastro, por setor."
        />
        {verFolha && (
          <>
            <Indicador
              rotulo={ultimo ? `Custo da folha ${mesAno(ultimo.competencia)}` : "Custo da folha"}
              valor={ultimo ? formatarMoeda(ultimo.total) : "—"}
              detalhe={ultimo ? `${ultimo.pessoas} holerites` : undefined}
              fonte="Proventos do holerite mensal + FGTS do mês. O vale já está dentro do mensal. Não inclui o INSS da empresa nem o VT e o auxílio pagos à parte (veja VT e alimentação)."
            />
            <Indicador
              rotulo="Média dos 3 meses anteriores"
              valor={media != null ? formatarMoeda(media) : "—"}
              detalhe={media && ultimo ? `${ultimo.total >= media ? "+" : ""}${(((ultimo.total - media) / media) * 100).toFixed(1).replace(".", ",")}% no último` : undefined}
              fonte="Média do custo da folha nos três meses antes do último importado."
            />
            <Indicador
              rotulo="Produção no último mês"
              valor={ultimo ? formatarMoeda(producao) : "—"}
              detalhe={ultimo && ultimo.total ? `${((producao / ultimo.total) * 100).toFixed(0)}% da folha` : undefined}
              fonte="Parte do custo da folha do setor Produção."
            />
          </>
        )}
      </div>

      {verFolha && linhas.length > 0 && (
        <details className="rounded-xl bg-superficie px-3 py-2 text-sm shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
          <summary className="cursor-pointer text-texto-suave">Custo da folha por mês e setor</summary>
          <div className="mt-2">
            <Tabela embutida colunas={["Mês", ...setores.map((s) => ROTULO_SETOR[s]), "Total", "Holerites"]}>
              {linhas.map((l) => (
                <tr key={l.competencia}>
                  <Celula className="tabular-nums">{mesAno(l.competencia)}</Celula>
                  {setores.map((s) => (
                    <Celula key={s} className="whitespace-nowrap tabular-nums">
                      {formatarMoeda(l.porSetor[s])}
                    </Celula>
                  ))}
                  <Celula className="whitespace-nowrap font-medium tabular-nums">{formatarMoeda(l.total)}</Celula>
                  <Celula className="tabular-nums">{l.pessoas}</Celula>
                </tr>
              ))}
            </Tabela>
          </div>
        </details>
      )}

      {mostrarForm && (
        <Cartao titulo="Novo funcionário">
          <FormAcao
            acao={salvarFuncionario.bind(null, null)}
            rotulo="Salvar"
            className="space-y-3"
            extra={
              <Link href="/rh/funcionarios" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            }
          >
            <CamposFuncionario empresas={empresas} />
          </FormAcao>
        </Cartao>
      )}

      <Filtro
        atalhos={[ATALHO_SITUACAO, { rotulo: "Setor", opcoes: [...SETORES.map(([valor, rotulo]) => ({ valor, rotulo })), { valor: "sem_setor", rotulo: "Sem setor" }] }]}
        iniciais={{ Situação: "ativo" }}
        placeholder="Filtrar por nome, matrícula, cargo..."
      >
        <Tabela
          colunas={["Funcionário", ...(selecionada ? [] : ["Empresa"]), "Cargo", "Setor", "Salário base", "Admissão", ...(verFolha ? ["Último holerite"] : []), ""]}
          vazio="Nenhum funcionário cadastrado ainda. Importe os holerites da folha para começar."
        >
          {funcionarios.map((f) => (
            <tr key={f.id} data-tags={`${f.ativo ? "ativo" : "inativo"} ${f.setor ?? "sem_setor"}`} className={f.ativo ? "" : "text-texto-suave"}>
              <Celula>
                <Link href={`/rh/funcionarios/ficha?id=${f.id}`} className="font-medium hover:text-primaria">
                  {f.nome}
                </Link>{" "}
                <span className="text-xs text-texto-suave">· {f.matricula}</span> {!f.ativo && <Etiqueta>Desligado</Etiqueta>}
              </Celula>
              {!selecionada && <Celula>{nomeEmpresa.get(f.empresa_id) ?? "—"}</Celula>}
              <Celula>{f.cargo ?? "—"}</Celula>
              <Celula>{f.setor ? ROTULO_SETOR[f.setor] : <span className="text-alerta">Sem setor</span>}</Celula>
              <Celula className="whitespace-nowrap tabular-nums">{f.salario_base != null ? formatarMoeda(f.salario_base) : "—"}</Celula>
              <Celula className="whitespace-nowrap tabular-nums" >
                {f.admissao ? formatarData(f.admissao) : <span className="text-alerta">Falta</span>}
                {f.admissao_estimada && <span className="text-xs text-texto-suave"> · estimada</span>}
              </Celula>
              {verFolha && <Celula className="whitespace-nowrap tabular-nums">{ultimos.has(f.id) ? mesAno(ultimos.get(f.id)!) : "—"}</Celula>}
              <Celula className="text-right">
                <LinkAcao href={`/rh/funcionarios/ficha?id=${f.id}`}>Abrir</LinkAcao>
              </Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaFuncionarios} />;
}
