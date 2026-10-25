// Endereço base do site (no GitHub Pages: /VENNER-GESTAO). Os links do Next
// (Link, router) já somam o base; links montados à mão usam comBase.
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const comBase = (caminho: string) => `${BASE}${caminho}`;

// Endereço público do sistema (https://...), para os links que saem por e-mail.
export function enderecoPublico() {
  return `${window.location.origin}${BASE}`;
}

// Só aceita caminhos internos, para o link do e-mail não levar a outro site.
export function caminhoSeguro(valor: string | null | undefined, padrao = "/") {
  return valor && valor.startsWith("/") && !valor.startsWith("//") ? valor : padrao;
}
