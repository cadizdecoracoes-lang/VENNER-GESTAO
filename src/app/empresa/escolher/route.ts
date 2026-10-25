import { NextResponse, type NextRequest } from "next/server";
import { carregarEmpresas } from "@/lib/empresa";
import { COOKIE_EMPRESA } from "@/lib/empresa-cookie";

// Endereço público do sistema como o navegador o vê.
function origemPublica(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const protocolo = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${protocolo}://${host}`;
}

// Troca a empresa do seletor do topo e volta para a tela (links do resumo por empresa).
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const volta = request.nextUrl.searchParams.get("volta") ?? "/";
  const destino = volta.startsWith("/") && !volta.startsWith("//") ? volta : "/";
  const resposta = NextResponse.redirect(`${origemPublica(request)}${destino}`);
  if (id && (await carregarEmpresas()).some((e) => e.id === id)) {
    resposta.cookies.set(COOKIE_EMPRESA, id, { path: "/", maxAge: 31536000, sameSite: "lax" });
  } else {
    resposta.cookies.delete({ name: COOKIE_EMPRESA, path: "/" });
  }
  return resposta;
}
