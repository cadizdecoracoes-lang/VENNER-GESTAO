"use client";

import { CabecalhoTela, SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarPedidosParaNota } from "@/lib/compras";
import { carregarCategoriasDespesa, carregarCentrosCusto, carregarFornecedores } from "@/lib/financeiro";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { ImportarNota } from "./importar-nota";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.notas_fornecedor";

async function carregarEmpresasComCnpj() {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("empresas").select("id, cnpj, nome_fantasia, razao_social").eq("ativa", true).order("razao_social");
  return (data ?? []).map((e) => ({ id: e.id, cnpj: e.cnpj, nome: e.nome_fantasia || e.razao_social }));
}

// Última categoria e centro de custo usados com cada fornecedor, para sugerir.
async function carregarUltimos() {
  if (!supabaseConfigurado) return {};
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("contas_pagar")
    .select("fornecedor_id, categoria_id, centro_custo_id")
    .not("fornecedor_id", "is", null)
    .not("categoria_id", "is", null)
    .order("criado_em", { ascending: false })
    .limit(1000);
  const ultimos: Record<string, { categoria_id: string | null; centro_custo_id: string | null }> = {};
  for (const t of data ?? []) ultimos[t.fornecedor_id] ??= { categoria_id: t.categoria_id, centro_custo_id: t.centro_custo_id };
  return ultimos;
}

async function PaginaImportarNota({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "criar")) return <SemAcesso codigo={TELA} />;
  const { pedido } = await searchParams;
  const [empresas, fornecedores, categorias, centros, ultimos, pedidos] = await Promise.all([
    carregarEmpresasComCnpj(),
    carregarFornecedores(),
    carregarCategoriasDespesa(),
    carregarCentrosCusto(),
    carregarUltimos(),
    carregarPedidosParaNota(),
  ]);
  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} />
      <ImportarNota empresas={empresas} fornecedores={fornecedores} categorias={categorias} centros={centros} ultimos={ultimos} pedidos={pedidos} pedidoInicial={pedido} />
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaImportarNota} />;
}
