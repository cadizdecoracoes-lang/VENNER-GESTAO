"use client";

import Link from "next/link";
import { FormAcao } from "@/components/form-acao";
import { TelaCliente } from "@/components/tela-cliente";
import { CabecalhoTela, Celula, Fonte, Indicador, SemAcesso, Tabela, estiloBotaoSecundario } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { ROTULO_BENEFICIO, type TipoBeneficio } from "@/lib/beneficios";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { mesAno, ROTULO_SETOR, type Setor } from "@/lib/holerite";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { excluirBeneficios } from "./actions";
import { ImportarBeneficios, type MesGravado } from "./importar";

const TELA = "rh.funcionarios";

type Beneficio = {
  id: string;
  empresa_id: string;
  funcionario_id: string | null;
  competencia: string;
  tipo: TipoBeneficio;
  nome: string;
  cpf: string | null;
  valor: number;
  periodo_de: string | null;
  periodo_ate: string | null;
  observacao: string | null;
  funcionarios: { nome: string; setor: Setor | null } | null;
};
type Mensal = { empresa_id: string; competencia: string; tipo: TipoBeneficio; pessoas: number; valor: number };

async function carregar(empresa: string | null, mes: string | null) {
  if (!supabaseConfigurado) return { mensal: [] as Mensal[], linhas: [] as Beneficio[], cpfs: [] as string[] };
  const supabase = criarClienteNavegador();
  let mensal = supabase.from("folha_beneficios_mensal").select("empresa_id, competencia, tipo, pessoas, valor").limit(5000);
  if (empresa) mensal = mensal.eq("empresa_id", empresa);
  const m = await mensal;
  const lista = ((m.data ?? []) as Mensal[]).map((x) => ({ ...x, valor: Number(x.valor), pessoas: Number(x.pessoas) }));
  const escolhido = mes ?? lista.map((x) => x.competencia).sort().at(-1) ?? null;
  let linhas = supabase
    .from("beneficios_folha")
    .select("id, empresa_id, funcionario_id, competencia, tipo, nome, cpf, valor, periodo_de, periodo_ate, observacao, funcionarios(nome, setor)")
    .eq("competencia", escolhido ?? "1900-01-01")
    .order("nome")
    .limit(3000);
  if (empresa) linhas = linhas.eq("empresa_id", empresa);
  const [l, f] = await Promise.all([linhas, supabase.from("funcionarios").select("cpf").not("cpf", "is", null).limit(5000)]);
  return {
    mensal: lista,
    linhas: ((l.data ?? []) as unknown as Beneficio[]).map((x) => ({ ...x, valor: Number(x.valor) })),
    cpfs: ((f.data ?? []) as { cpf: string }[]).map((x) => x.cpf),
  };
}

async function PaginaBeneficios({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, "rh.folha", "ver")) return <SemAcesso codigo={TELA} />;
  const filtros = await searchParams;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const mesFiltro = /^\d{4}-\d{2}$/.test(filtros.mes ?? "") ? `${filtros.mes}-01` : null;
  const { mensal, linhas, cpfs } = await carregar(selecionada?.id ?? null, mesFiltro);
  const meses = [...new Set(mensal.map((x) => x.competencia))].sort();
  const mes = mesFiltro ?? meses.at(-1) ?? null;
  const doMes = (tipo: TipoBeneficio) => mensal.filter((x) => x.competencia === mes && x.tipo === tipo);
  const soma = (l: { valor: number }[]) => l.reduce((s, x) => s + x.valor, 0);
  const podeImportar = pode(acesso, "rh.folha", "criar");
  const podeExcluir = pode(acesso, "rh.folha", "excluir");

  // Uma linha por pessoa no mês (VT e auxílio lado a lado).
  const pessoas = new Map<string, { nome: string; id: string | null; setor: Setor | null; vt?: Beneficio; va?: Beneficio; outro?: Beneficio }>();
  for (const b of linhas) {
    const chave = b.funcionario_id ?? b.cpf ?? b.nome.toLowerCase();
    const p = pessoas.get(chave) ?? { nome: b.funcionarios?.nome ?? b.nome, id: b.funcionario_id, setor: b.funcionarios?.setor ?? null };
    p[b.tipo] = b;
    pessoas.set(chave, p);
  }
  const lista = [...pessoas.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  const gravados: MesGravado[] = mensal.map((x) => ({ empresa_id: x.empresa_id, competencia: x.competencia, tipo: x.tipo }));
  const empresasMes = [...new Set(linhas.map((l) => l.empresa_id))];
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const valorCelula = (b?: Beneficio) =>
    b ? (
      <>
        {formatarMoeda(b.valor)} {b.observacao && <span className="text-xs text-texto-suave">· {b.observacao}</span>}
      </>
    ) : (
      <span className="text-texto-suave">—</span>
    );

  return (
    <div className="space-y-3">
      <CabecalhoTela
        codigo={TELA}
        empresa={selecionada}
        ajuda="Vale-transporte pago à parte (planilha do VT) e auxílio-alimentação (pedido do cartão Caixa), como custo e controle da folha. Cada pessoa é ligada ao cadastro pelo CPF. Reimportar um mês troca as linhas dele. Estes valores entram no custo total da folha dos Indicadores."
      >
        <Link href="/rh/funcionarios" className={estiloBotaoSecundario}>
          Voltar à lista
        </Link>
      </CabecalhoTela>

      <div className="flex flex-wrap items-center gap-1 text-[13px]">
        <span className="text-texto-suave">Mês:</span>
        {meses.length === 0 && <span className="text-texto-suave">nenhum importado ainda</span>}
        {meses.map((m) => (
          <Link
            key={m}
            href={`?mes=${m.slice(0, 7)}`}
            scroll={false}
            className={`rounded-full px-2 py-0.5 ${m === mes ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-superficie"}`}
          >
            {mesAno(m)} <span className="text-xs opacity-80">{formatarMoeda(soma(mensal.filter((x) => x.competencia === m)))}</span>
          </Link>
        ))}
      </div>

      {mes && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Indicador rotulo={`Vale-transporte ${mesAno(mes)}`} valor={formatarMoeda(soma(doMes("vt")))} detalhe={`${doMes("vt").reduce((s, x) => s + x.pessoas, 0)} pessoas`} fonte="Planilha do VT da fábrica, coluna TOTAL." />
          <Indicador rotulo={`Auxílio-alimentação ${mesAno(mes)}`} valor={formatarMoeda(soma(doMes("va")))} detalhe={`${doMes("va").reduce((s, x) => s + x.pessoas, 0)} pessoas`} fonte="Pedido do cartão no portal Caixa Pré-pagos." />
          <Indicador rotulo="Total de benefícios no mês" valor={formatarMoeda(soma(mensal.filter((x) => x.competencia === mes)))} fonte="VT + auxílio. Somado ao custo dos holerites nos Indicadores." />
          <Indicador
            rotulo="Fora do cadastro"
            valor={lista.filter((p) => !p.id).length}
            detalhe="sem CPF igual ao do funcionário"
            cor={lista.some((p) => !p.id) ? "text-alerta" : ""}
            fonte="Pessoas da planilha ou do PDF que não foram ligadas a um funcionário pelo CPF (sem setor). Confira o CPF na ficha."
          />
        </div>
      )}

      {mes && (
        <Tabela colunas={["Pessoa", "Setor", "Vale-transporte", "Auxílio-alimentação", "Total"]} vazio="Nenhum benefício neste mês.">
          {lista.map((p, i) => (
            <tr key={i}>
              <Celula>
                {p.id ? (
                  <Link href={`/rh/funcionarios/ficha?id=${p.id}`} className="hover:text-primaria hover:underline">
                    {p.nome}
                  </Link>
                ) : (
                  <>
                    {p.nome} <span className="text-xs text-alerta">fora do cadastro</span>
                  </>
                )}
              </Celula>
              <Celula className="text-texto-suave">{p.setor ? ROTULO_SETOR[p.setor] : "—"}</Celula>
              <Celula className="tabular-nums">{valorCelula(p.vt)}</Celula>
              <Celula className="tabular-nums">{valorCelula(p.va)}</Celula>
              <Celula className="tabular-nums font-medium">{formatarMoeda((p.vt?.valor ?? 0) + (p.va?.valor ?? 0) + (p.outro?.valor ?? 0))}</Celula>
            </tr>
          ))}
        </Tabela>
      )}

      {mes && (
        <Fonte>
          {(() => {
            const vt = linhas.find((l) => l.tipo === "vt" && l.periodo_de);
            return vt ? `VT do período de ${formatarData(vt.periodo_de)} a ${formatarData(vt.periodo_ate)}. ` : "";
          })()}
          Fonte: planilha do VT e pedido do auxílio importados · {empresasMes.map((e) => nomeEmpresa.get(e) ?? "").join(", ") || "—"} · {mesAno(mes)}.
        </Fonte>
      )}

      {mes && podeExcluir && (
        <div className="flex flex-wrap gap-3 text-xs">
          {(["vt", "va"] as const).flatMap((t) =>
            [...new Set(doMes(t).map((x) => x.empresa_id))].map((e) => (
              <FormAcao
                key={`${t}${e}`}
                acao={excluirBeneficios.bind(null, e, t, mes)}
                rotulo={`Excluir ${ROTULO_BENEFICIO[t].toLowerCase()} de ${mesAno(mes)}`}
                discreto
                confirmar={`Excluir o ${ROTULO_BENEFICIO[t].toLowerCase()} de ${mesAno(mes)} (${nomeEmpresa.get(e) ?? ""})?`}
              />
            )),
          )}
        </div>
      )}

      {podeImportar && (
        <ImportarBeneficios
          empresas={empresas.map((e) => ({ id: e.id, nome: e.nome }))}
          empresaPadrao={selecionada?.id ?? linhas[0]?.empresa_id ?? empresas[0]?.id ?? ""}
          cpfs={cpfs}
          gravados={gravados}
        />
      )}
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaBeneficios} />;
}
