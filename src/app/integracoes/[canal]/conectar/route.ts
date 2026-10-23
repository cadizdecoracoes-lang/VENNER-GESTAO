import { NextResponse, type NextRequest } from "next/server";
import { carregarAcesso, pode } from "@/lib/acesso";
import { aleatorio, COOKIE_LIGACAO, desafioPkce, enderecoRetorno, type Ligacao, origemPublica } from "@/lib/plataformas/ligacao";
import { chavesML, mlConfigurado, urlAutorizacaoML } from "@/lib/plataformas/mercado-livre";
import { shopeeConfigurado, urlAutorizacaoShopee } from "@/lib/plataformas/shopee";

// Clique em "Ligar conta": manda a pessoa para a tela de autorização da plataforma.
export async function GET(request: NextRequest, { params }: { params: Promise<{ canal: string }> }) {
  const { canal } = await params;
  const origem = origemPublica(request);
  const voltar = (erro: string) => NextResponse.redirect(`${origem}/config/integracoes?erro=${encodeURIComponent(erro)}`);

  const acesso = await carregarAcesso();
  if (!(pode(acesso, "config.integracoes", "editar") || pode(acesso, "financeiro.receber", "criar"))) {
    return voltar("Seu perfil não pode ligar contas das plataformas.");
  }
  const empresa = request.nextUrl.searchParams.get("empresa") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(empresa)) return voltar("Escolha a empresa dona da conta.");

  const ligacao: Ligacao = { canal, empresa, estado: aleatorio(), verificador: aleatorio() };
  let destino: string;
  if (canal === "mercado_livre" && mlConfigurado()) {
    destino = urlAutorizacaoML(chavesML().appId, enderecoRetorno(origem, canal), ligacao.estado, await desafioPkce(ligacao.verificador));
  } else if (canal === "shopee" && shopeeConfigurado()) {
    destino = await urlAutorizacaoShopee(enderecoRetorno(origem, canal));
  } else {
    return voltar("Essa plataforma ainda não tem as chaves do aplicativo no Cloudflare.");
  }

  const resposta = NextResponse.redirect(destino);
  resposta.cookies.set(COOKIE_LIGACAO, JSON.stringify(ligacao), {
    httpOnly: true,
    secure: origem.startsWith("https"),
    sameSite: "lax",
    path: "/integracoes",
    maxAge: 15 * 60,
  });
  return resposta;
}
