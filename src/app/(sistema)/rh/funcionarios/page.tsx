import { FileUp, Plus } from "lucide-react";
import Link from "next/link";
import { ATALHO_SITUACAO, Filtro } from "@/components/filtro";
import { FormAcao } from "@/components/form-acao";
import {
  CabecalhoTela,
  Cartao,
  Celula,
  Etiqueta,
  FaixaEmpresa,
  Fonte,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloBotaoSecundario,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { mesAno } from "@/lib/holerite";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarFuncionario } from "./actions";
import { CAMPOS_FUNCIONARIO, CamposFuncionario, type Funcionario } from "./campos";

const TELA = "rh.funcionarios";

async function carregar(empresa: string | null): Promise<Funcionario[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  let consulta = supabase.from("funcionarios").select(CAMPOS_FUNCIONARIO).order("nome").limit(3000);
  if (empresa) consulta = consulta.eq("empresa_id", empresa);
  const { data } = await consulta;
  return (data ?? []) as Funcionario[];
}

// Mês do último holerite de cada funcionário (só para quem vê a folha).
async function ultimosHolerites(): Promise<Map<string, string>> {
  if (!supabaseConfigurado) return new Map();
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("funcionarios_ultimo_holerite").select("funcionario_id, competencia");
  return new Map((data ?? []).map((h) => [h.funcionario_id as string, h.competencia as string]));
}

export default async function PaginaFuncionarios({ searchParams }: { searchParams: Promise<{ novo?: string; importados?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const verFolha = pode(acesso, "rh.folha", "ver");
  const [funcionarios, ultimos] = await Promise.all([carregar(selecionada?.id ?? null), verFolha ? ultimosHolerites() : new Map<string, string>()]);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const mostrarForm = filtros.novo && pode(acesso, TELA, "criar");
  const importar = pode(acesso, TELA, "criar") && pode(acesso, "rh.folha", "criar");
  const ativos = funcionarios.filter((f) => f.ativo);

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
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

      <FaixaEmpresa empresa={selecionada} />

      {filtros.importados && (
        <p className="rounded-xl bg-sucesso/10 px-4 py-2.5 text-sm text-sucesso">
          {filtros.importados} recibos gravados. Cargo e salário de cada funcionário seguem o holerite mensal mais recente.
        </p>
      )}

      {mostrarForm && (
        <Cartao titulo="Novo funcionário">
          <FormAcao acao={salvarFuncionario.bind(null, null)} rotulo="Salvar" className="space-y-4">
            <CamposFuncionario empresas={empresas} />
            <div className="flex justify-end">
              <Link href="/rh/funcionarios" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Filtro atalhos={[ATALHO_SITUACAO]} iniciais={{ Situação: "ativo" }} placeholder="Filtrar por nome, matrícula, cargo, CPF...">
        <Tabela
          colunas={["Funcionário", "Empresa", "Cargo", "Salário base", "Admissão", ...(verFolha ? ["Último holerite"] : []), ""]}
          vazio="Nenhum funcionário cadastrado ainda. Importe os holerites da folha para começar."
        >
          {funcionarios.map((f) => (
            <tr key={f.id} data-tags={f.ativo ? "ativo" : "inativo"} className={f.ativo ? "" : "text-texto-suave"}>
              <Celula>
                <Link href={`/rh/funcionarios/${f.id}`} className="font-medium hover:text-primaria">
                  {f.nome}
                </Link>{" "}
                {!f.ativo && <Etiqueta>Desligado</Etiqueta>}
                <span className="block text-xs text-texto-suave">Matrícula {f.matricula}</span>
              </Celula>
              <Celula>{nomeEmpresa.get(f.empresa_id) ?? "—"}</Celula>
              <Celula>{f.cargo ?? "—"}</Celula>
              <Celula className="whitespace-nowrap tabular-nums">{f.salario_base != null ? formatarMoeda(f.salario_base) : "—"}</Celula>
              <Celula className="whitespace-nowrap tabular-nums">{formatarData(f.admissao)}</Celula>
              {verFolha && <Celula className="whitespace-nowrap tabular-nums">{ultimos.has(f.id) ? mesAno(ultimos.get(f.id)!) : "—"}</Celula>}
              <Celula className="text-right">
                <LinkAcao href={`/rh/funcionarios/${f.id}`}>Abrir</LinkAcao>
              </Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
      <Fonte>
        {ativos.length} funcionários ativos de {funcionarios.length} cadastrados. Cargo e salário base vêm do holerite mensal mais recente
        importado; CPF e admissão são preenchidos na ficha de cada um.
      </Fonte>
    </div>
  );
}
