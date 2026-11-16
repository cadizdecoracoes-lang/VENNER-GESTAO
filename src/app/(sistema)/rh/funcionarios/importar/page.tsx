"use client";

import Link from "next/link";
import { TelaCliente } from "@/components/tela-cliente";
import { CabecalhoTela, SemAcesso, estiloBotaoSecundario } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { ImportarHolerites, type Existente, type Mes } from "./importar-holerites";

const TELA = "rh.funcionarios";

async function carregar() {
  if (!supabaseConfigurado) return { empresas: [], funcionarios: [], meses: [] };
  const supabase = criarClienteNavegador();
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

async function PaginaImportarHolerites() {
  const acesso = await carregarAcesso();
  if (!(pode(acesso, TELA, "criar") && pode(acesso, "rh.folha", "criar"))) return <SemAcesso codigo={TELA} />;
  const dados = await carregar();
  return (
    <div className="space-y-3">
      <CabecalhoTela
        codigo={TELA}
        ajuda="Escolha os PDFs da folha (mensal e vale), um ou vários meses de uma vez. O sistema lê cada recibo, confere os totais e mostra o que vai mudar antes de gravar. Nada é gravado até você clicar em Gravar. Reimportar um mês troca os recibos dele, sem duplicar."
      >
        <Link href="/rh/funcionarios" className={estiloBotaoSecundario}>
          Voltar à lista
        </Link>
      </CabecalhoTela>
      <ImportarHolerites {...dados} />
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaImportarHolerites} />;
}
