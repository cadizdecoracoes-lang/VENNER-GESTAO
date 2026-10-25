// Ida e volta da autorização nas plataformas (Tiny, Mercado Livre e Shopee).
// O clique em "Ligar conta" gera um estado e um verificador, que o banco
// guarda por 15 minutos (iniciar_ligacao); a plataforma volta para a Edge
// Function integracoes-retorno, que devolve a pessoa à tela com o código, e a
// tela termina a ligação (concluir_ligacao) já com o login de quem começou.
export const CANAIS = ["tiny", "mercado_livre", "shopee"] as const;
export type CanalLigacao = (typeof CANAIS)[number];

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

// Endereço de retorno cadastrado em cada plataforma (precisa bater letra por letra).
export const enderecoRetorno = (supabaseUrl: string, canal: string) => `${supabaseUrl}/functions/v1/integracoes-retorno/${canal}`;
