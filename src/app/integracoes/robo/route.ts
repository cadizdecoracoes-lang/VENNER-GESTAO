import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { lerTiny } from "@/lib/tiny/robo";

// Chamado pelo Supabase a cada 5 minutos (pg_cron + pg_net) com a chave que
// o próprio banco gerou. Sem login: quem confere a chave é o banco.
export async function POST(request: NextRequest) {
  const chave = request.headers.get("x-chave-robo") ?? "";
  const corpo = await request.json().catch(() => ({}));
  const integracao = String(corpo?.integracao ?? "");
  if (!/^[0-9a-f-]{36}$/.test(integracao) || chave.length < 32) {
    return NextResponse.json({ erro: "Pedido inválido" }, { status: 400 });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const r = await lerTiny(supabase, integracao, chave);
    return NextResponse.json(r);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ erro: mensagem }, { status: /não confere/.test(mensagem) ? 403 : 500 });
  }
}
