// Ida e volta da autorização nas plataformas: o que o sistema guarda num
// cookie curto entre o clique em "Ligar conta" e o retorno da plataforma.
export const COOKIE_LIGACAO = "venner_ligacao";

export type Ligacao = { canal: string; empresa: string; estado: string; verificador: string };

const base64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const aleatorio = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

// Desafio PKCE (S256) do verificador.
export async function desafioPkce(verificador: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador))));
}

export const enderecoRetorno = (origem: string, canal: string) => `${origem}/integracoes/${canal}/retorno`;

// Endereço público do sistema como o navegador o vê (a plataforma confere o retorno letra por letra).
export function origemPublica(request: { headers: Headers; nextUrl: URL }): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const protocolo = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${protocolo}://${host}`;
}
