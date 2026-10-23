import Link from "next/link";
import { CabecalhoTela, SemAcesso, estiloBotaoSecundario } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { ImportarHolerites, type Existente, type Mes } from "./importar-holerites";

const TELA = "rh.funcionarios";

async function carregar() {
  if (!supabaseConfigurado) return { empresas: [], funcionarios: [], meses: [] };
  const supabase = await criarClienteServidor();
  const [empresas, funcionarios, holerites] = await Promise.all([
    supabase.from("empresas").select("id, cnpj, nome_fantasia, razao_social").eq("ativa", true).order("razao_social"),
    supabase.from("funcionarios").select("id, empresa_id, matricula, nome, cargo, salario_base, ativo").limit(5000),
    supabase.from("holerites_por_mes").select("empresa_id, competencia, tipo, matriculas"),
  ]);
  return {
    empresas: (empresas.data ?? []).map((e) => ({ id: e.id as string, cnpj: e.cnpj as string, nome: (e.nome_fantasia || e.razao_social) as string })),
    funcionarios: (funcionarios.data ?? []) as Existente[],
    meses: (holerites.data ?? []) as Mes[],
  };
}

export default async function PaginaImportarHolerites() {
  const acesso = await carregarAcesso();
  if (!(pode(acesso, TELA, "criar") && pode(acesso, "rh.folha", "criar"))) return <SemAcesso codigo={TELA} />;
  const dados = await carregar();
  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        <Link href="/rh/funcionarios" className={estiloBotaoSecundario}>
          Voltar à lista
        </Link>
      </CabecalhoTela>
      <ImportarHolerites {...dados} />
    </div>
  );
}
