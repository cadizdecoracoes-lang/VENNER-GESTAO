import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_LIGACAO, enderecoRetorno, type Ligacao, origemPublica } from "@/lib/plataformas/ligacao";
import { trocarCodigoML, type Tokens } from "@/lib/plataformas/mercado-livre";
import { trocarCodigoShopee } from "@/lib/plataformas/shopee";
import { criarClienteServidor } from "@/lib/supabase/server";

// Volta da plataforma depois da autorização: troca o código pelo acesso e grava a conta.
export async function GET(request: NextRequest, { params }: { params: Promise<{ canal: string }> }) {
  const { canal } = await params;
  const origem = origemPublica(request);
  const q = request.nextUrl.searchParams;
  const ir = (sufixo: string) => {
    const r = NextResponse.redirect(`${origem}/config/integracoes?${sufixo}`);
    r.cookies.delete({ name: COOKIE_LIGACAO, path: "/integracoes" });
    return r;
  };
  const erro = (texto: string) => ir(`erro=${encodeURIComponent(texto)}`);

  let ligacao: Ligacao | null = null;
  try {
    ligacao = JSON.parse(request.cookies.get(COOKIE_LIGACAO)?.value ?? "null");
  } catch {
    ligacao = null;
  }
  if (!ligacao || ligacao.canal !== canal) return erro("A autorização demorou ou foi aberta em outro navegador. Clique em Ligar de novo.");
  const codigo = q.get("code");
  if (!codigo) return erro("A plataforma não autorizou a ligação.");

  let tokens: Tokens;
  try {
    if (canal === "mercado_livre") {
      if (q.get("state") !== ligacao.estado) return erro("A autorização não confere. Clique em Ligar de novo.");
      tokens = await trocarCodigoML(codigo, enderecoRetorno(origem, canal), ligacao.verificador);
    } else if (canal === "shopee") {
      const loja = q.get("shop_id");
      if (!loja || !/^\d+$/.test(loja)) return erro("A Shopee não informou a loja autorizada.");
      tokens = await trocarCodigoShopee(codigo, loja);
    } else {
      return erro("Plataforma desconhecida.");
    }
  } catch (e) {
    return erro(e instanceof Error ? e.message : "A plataforma recusou a ligação.");
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("salvar_integracao", {
    empresa: ligacao.empresa,
    canal_conta: canal,
    conta: tokens.conta,
    nome: tokens.apelido,
    acesso: tokens.access_token,
    renovacao: tokens.refresh_token,
    expira: tokens.expira_em,
  });
  if (error) return erro(error.message);
  return ir("ligada=1");
}
