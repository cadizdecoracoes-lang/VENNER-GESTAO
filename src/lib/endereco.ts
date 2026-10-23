import { headers } from "next/headers";

// Endereço público do sistema (https://...), lido dos cabeçalhos repassados
// pelo Cloudflare. Usado nos links que saem por e-mail.
export async function enderecoPublico() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocolo = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${protocolo}://${host.split(",")[0].trim()}`;
}

// Só aceita caminhos internos, para o link do e-mail não levar a outro site.
export function caminhoSeguro(valor: string | null | undefined, padrao = "/") {
  return valor && valor.startsWith("/") && !valor.startsWith("//") ? valor : padrao;
}
