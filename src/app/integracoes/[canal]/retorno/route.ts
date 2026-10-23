import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_LIGACAO, enderecoRetorno, type Ligacao, origemPublica } from "@/lib/plataformas/ligacao";
import { trocarCodigoML, type Tokens } from "@/lib/plataformas/mercado-livre";
import { trocarCodigoShopee } from "@/lib/plataformas/shopee";
import { criarClienteServidor } from "@/lib/supabase/server";
import { trocarCodigoTiny } from "@/lib/tiny/api";

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

  if (canal === "tiny") return ligarTiny(ligacao, codigo, q.get("state"), origem, erro, ir);

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

async function ligarTiny(
  ligacao: Ligacao,
  codigo: string,
  estado: string | null,
  origem: string,
  erro: (texto: string) => NextResponse,
  ir: (sufixo: string) => NextResponse,
) {
  if (estado !== ligacao.estado) return erro("A autorização não confere. Clique em Ligar de novo.");
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("credenciais_tiny", { empresa: ligacao.empresa });
  const app = (data as { client_id: string; client_secret: string }[] | null)?.[0];
  if (!app) return erro("Faltam as chaves do aplicativo do Tiny desta empresa.");
  let tokens;
  try {
    tokens = await trocarCodigoTiny(codigo, enderecoRetorno(origem, "tiny"), app.client_id, app.client_secret);
  } catch (e) {
    return erro(e instanceof Error ? e.message : "O Tiny recusou a ligação.");
  }
  const salvo = await supabase.rpc("salvar_integracao", {
    empresa: ligacao.empresa,
    canal_conta: "tiny",
    conta: "tiny",
    nome: tokens.apelido ?? "Tiny",
    acesso: tokens.access_token,
    renovacao: tokens.refresh_token,
    expira: tokens.expira_em,
  });
  if (salvo.error) return erro(salvo.error.message);
  // Leitura automática: o banco passa a chamar o robô neste endereço.
  const robo = await supabase.rpc("preparar_robo_tiny", { integracao: salvo.data, endereco_publico: origem });
  if (robo.error) return erro(robo.error.message);
  return ir("ligada=tiny");
}
