import { NextResponse } from "next/server";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

// Abre o XML ou PDF da nota por um link temporário do Storage (a regra de
// acesso por CNPJ vale para o arquivo também).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigurado) return new NextResponse("Banco não conectado", { status: 404 });
  const { id } = await params;
  const supabase = await criarClienteServidor();
  const { data: nota } = await supabase.from("notas_fornecedor").select("arquivo").eq("id", id).maybeSingle();
  if (!nota?.arquivo) return new NextResponse("Arquivo não encontrado", { status: 404 });
  const { data, error } = await supabase.storage.from("notas-fornecedor").createSignedUrl(nota.arquivo, 60);
  if (error || !data) return new NextResponse("Não foi possível abrir o arquivo", { status: 403 });
  return NextResponse.redirect(data.signedUrl);
}
