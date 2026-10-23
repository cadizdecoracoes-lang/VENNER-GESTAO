import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { caminhoSeguro, enderecoPublico } from "@/lib/endereco";
import { criarClienteServidor } from "@/lib/supabase/server";

// Destino dos links enviados por e-mail (recuperar senha, confirmar login):
// troca o código do link por uma sessão e segue para a tela pedida.
export async function GET(request: NextRequest) {
  const busca = request.nextUrl.searchParams;
  const base = await enderecoPublico();
  const proximo = caminhoSeguro(busca.get("proximo"), "/login/nova-senha");
  const supabase = await criarClienteServidor();

  const codigo = busca.get("code");
  const tokenHash = busca.get("token_hash");
  const tipo = busca.get("type") as EmailOtpType | null;
  const { error } = codigo
    ? await supabase.auth.exchangeCodeForSession(codigo)
    : tokenHash && tipo
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo })
      : { error: new Error("sem código") };

  return NextResponse.redirect(new URL(error ? "/login?erro=link" : proximo, base));
}
