import { redirect } from "next/navigation";
import { FormLogin } from "./form-login";

type Busca = { code?: string; erro?: string; error_description?: string };

export default async function PaginaLogin({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  // Link de e-mail que caiu no endereço principal (Site URL) em vez da tela de confirmação.
  if (busca.code) redirect(`/login/confirmar?code=${encodeURIComponent(busca.code)}&proximo=/login/nova-senha`);

  const erro =
    busca.erro === "link" || busca.error_description
      ? "O link do e-mail expirou ou já foi usado. Peça um novo em “Esqueci minha senha”."
      : undefined;
  return <FormLogin erroInicial={erro} />;
}
