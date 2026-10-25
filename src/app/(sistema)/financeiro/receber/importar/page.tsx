import { CabecalhoTela, SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { carregarLocais } from "@/lib/financeiro";
import { carregarProdutosVenda } from "@/lib/vendas";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { ImportarVendas } from "./importar-vendas";

const TELA = "financeiro.receber";

// Códigos já ligados a produto, por empresa e plataforma ("empresa|canal|código").
async function carregarLigados(): Promise<string[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("anuncios_plataforma").select("empresa_id, canal, codigo").limit(10000);
  return [...new Set((data ?? []).map((a) => `${a.empresa_id}|${a.canal}|${a.codigo}`))];
}

export default async function PaginaImportarVendas() {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "criar")) return <SemAcesso codigo={TELA} />;
  const [empresas, selecionada, locais, produtos, ligados] = await Promise.all([
    carregarEmpresas(),
    empresaSelecionada(),
    carregarLocais(),
    carregarProdutosVenda(),
    carregarLigados(),
  ]);
  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} />
      <ImportarVendas
        empresas={empresas.map((e) => ({ id: e.id, nome: e.nome }))}
        empresaInicial={selecionada?.id ?? (empresas.length === 1 ? empresas[0].id : "")}
        locais={locais}
        produtos={produtos.map((p) => ({ id: p.id, nome: `${p.codigo} · ${p.descricao}` }))}
        ligados={ligados}
      />
    </div>
  );
}
