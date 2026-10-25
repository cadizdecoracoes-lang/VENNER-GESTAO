// Segredos das Edge Functions (Deno.env). Nos testes (node --test) lê do
// process.env, para o mesmo código rodar nos dois lugares.
type Global = { Deno?: { env: { get(nome: string): string | undefined } }; process?: { env: Record<string, string | undefined> } };

export function ambiente(nome: string): string {
  const g = globalThis as Global;
  return ((g.Deno ? g.Deno.env.get(nome) : g.process?.env[nome]) ?? "").trim();
}
