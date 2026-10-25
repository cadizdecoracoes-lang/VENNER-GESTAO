// Volta das plataformas depois da autorização (endereço cadastrado no Tiny, no
// Mercado Livre e na Shopee). Não tem login: só devolve a pessoa para a tela de
// integrações do sistema, com o código, e a tela termina a ligação.
// .../integracoes-retorno/<canal>/aviso é o endereço de notificações pedido
// pelo Mercado Livre: o sistema só confirma o recebimento.
import { CANAIS } from "../_shared/plataformas/ligacao.ts";
import { clientePublico } from "../_shared/supabase.ts";

const texto = (corpo: string, status = 400) => new Response(corpo, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

Deno.serve(async (pedido) => {
  const url = new URL(pedido.url);
  const partes = url.pathname.split("/").filter(Boolean);
  const i = partes.indexOf("integracoes-retorno");
  const canal = partes[i + 1] ?? "";
  if (partes[i + 2] === "aviso") return new Response(null, { status: 200 });
  if (!(CANAIS as readonly string[]).includes(canal)) return texto("Plataforma desconhecida.", 404);

  // A Shopee não devolve o "state": ele vai no próprio endereço de retorno.
  const estado = url.searchParams.get("state") ?? "";
  const { data: voltar } = estado ? await clientePublico().rpc("destino_ligacao", { estado }) : { data: null };
  if (typeof voltar !== "string" || !voltar) {
    return texto("A autorização demorou mais de 15 minutos ou já foi usada. Volte ao sistema e clique em Ligar de novo.");
  }
  const q = new URLSearchParams({ ligacao: canal, state: estado });
  for (const campo of ["code", "shop_id", "error", "error_description"]) {
    const v = url.searchParams.get(campo);
    if (v) q.set(campo, v);
  }
  return new Response(null, { status: 302, headers: { location: `${voltar}?${q}` } });
});
