// Busca as vendas de uma conta ligada (Mercado Livre ou Shopee) e importa no
// sistema, renovando o acesso quando vencido. Roda só no servidor: as chaves
// saem do banco pela função acesso_integracao, que confere o perfil.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarVendasML, renovarML, type Tokens } from "./mercado-livre";
import { buscarVendasShopee, renovarShopee } from "./shopee";
import type { Canal, VendaImportada } from "./tipos";

type Acesso = {
  empresa_id: string;
  canal: Canal;
  conta_externa: string;
  access_token: string;
  refresh_token: string | null;
  expira_em: string | null;
  local_baixa_id: string | null;
};

export type Resultado = { importadas: number; repetidas: number; semAnuncio: string[]; puladas: number };

export async function sincronizarConta(supabase: SupabaseClient, integracao: string, desde: string, dias: number): Promise<Resultado> {
  const { data, error } = await supabase.rpc("acesso_integracao", { integracao });
  if (error) throw new Error(error.message);
  const conta = (data as Acesso[] | null)?.[0];
  if (!conta) throw new Error("Conta não encontrada ou sem permissão.");
  if (!conta.local_baixa_id) throw new Error("Escolha antes o local de onde sai o estoque dessa conta.");

  // Renova o acesso com folga de 5 minutos.
  let token = conta.access_token;
  if (!conta.expira_em || Date.parse(conta.expira_em) < Date.now() + 5 * 60_000) {
    if (!conta.refresh_token) throw new Error("O acesso venceu. Ligue a conta de novo.");
    const novo: Tokens =
      conta.canal === "mercado_livre"
        ? await renovarML(conta.refresh_token)
        : await renovarShopee(conta.refresh_token, conta.conta_externa);
    const salvo = await supabase.rpc("salvar_integracao", {
      empresa: conta.empresa_id,
      canal_conta: conta.canal,
      conta: conta.conta_externa,
      nome: null,
      acesso: novo.access_token,
      renovacao: novo.refresh_token,
      expira: novo.expira_em,
    });
    if (salvo.error) throw new Error(salvo.error.message);
    token = novo.access_token;
  }

  const vendas: VendaImportada[] =
    conta.canal === "mercado_livre"
      ? await buscarVendasML(token, conta.conta_externa, desde, dias)
      : await buscarVendasShopee(token, conta.conta_externa, desde, dias);

  // Vendas com anúncio ainda sem produto ficam para depois de ligar o anúncio.
  const { data: ligados } = await supabase
    .from("anuncios_plataforma")
    .select("codigo")
    .eq("empresa_id", conta.empresa_id)
    .eq("canal", conta.canal)
    .limit(10000);
  const conhecidos = new Set((ligados ?? []).map((a) => a.codigo as string));
  const semAnuncio = new Set<string>();
  const prontas = vendas.filter((v) => {
    const faltam = v.itens.filter((i) => !conhecidos.has(i.codigo));
    faltam.forEach((i) => semAnuncio.add(i.codigo));
    return faltam.length === 0;
  });

  let r = { importadas: 0, repetidas: 0 };
  for (let i = 0; i < prontas.length; i += 200) {
    const lote = await supabase.rpc("importar_vendas_plataforma", {
      empresa: conta.empresa_id,
      canal_venda: conta.canal,
      vendas: prontas.slice(i, i + 200),
      local_baixa: conta.local_baixa_id,
    });
    if (lote.error) throw new Error(lote.error.message);
    const d = lote.data as { importadas: number; repetidas: number };
    r = { importadas: r.importadas + d.importadas, repetidas: r.repetidas + d.repetidas };
  }
  await supabase.rpc("ajustar_integracao", { integracao, sincronizado_em: new Date().toISOString() });
  return { ...r, semAnuncio: [...semAnuncio], puladas: vendas.length - prontas.length };
}
