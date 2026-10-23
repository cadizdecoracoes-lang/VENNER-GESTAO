import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL, supabaseConfigurado } from "@/lib/supabase/config";

// Renova a sessão do Supabase a cada requisição e manda para /login quem não
// estiver autenticado.
export async function proxy(request: NextRequest) {
  // O robô do Tiny entra sem login (o banco confere a chave dele) e não gasta
  // uma chamada à toa conferindo sessão.
  if (!supabaseConfigurado || request.nextUrl.pathname === "/integracoes/robo") return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(lista) {
        lista.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        lista.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Avisos das plataformas chegam sem login e não leem nada.
  const publico = request.nextUrl.pathname.startsWith("/login") || /^\/integracoes\/[a-z_]+\/aviso$/.test(request.nextUrl.pathname);
  if (!user && !publico) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
