import { Clock, LogOut } from "lucide-react";
import { AbasProvider } from "@/components/abas";
import { BarraAbas } from "@/components/barra-abas";
import { MenuLateral } from "@/components/menu-lateral";
import { SeletorEmpresa } from "@/components/seletor-empresa";
import { carregarAcesso, telasVisiveis } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { sair } from "../login/actions";

export default async function LayoutSistema({ children }: { children: React.ReactNode }) {
  const [acesso, empresas, selecionada] = await Promise.all([carregarAcesso(), carregarEmpresas(), empresaSelecionada()]);
  const { email } = acesso;

  return (
    <AbasProvider>
      <div className="flex h-full">
        <MenuLateral telas={telasVisiveis(acesso)} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Uma faixa só no topo: abas abertas à esquerda, empresa e usuário à direita. */}
          <header className="flex h-10 shrink-0 items-stretch gap-3 border-b border-borda/70 bg-superficie pl-3 pr-4">
            <BarraAbas />
            <div className="flex shrink-0 items-center gap-3">
              <SeletorEmpresa empresas={empresas} valor={selecionada?.id ?? null} />
              {email ? (
                <form action={sair} className="flex items-center gap-1 text-xs text-texto-suave">
                  <span className="hidden max-w-48 truncate xl:inline" title={email}>
                    {email}
                  </span>
                  <button className="rounded-lg p-1.5 hover:bg-fundo" aria-label="Sair" title={`Sair (${email})`}>
                    <LogOut size={15} />
                  </button>
                </form>
              ) : (
                <span className="rounded-full bg-alerta/10 px-3 py-0.5 text-xs text-alerta">Demonstração: sem banco de dados</span>
              )}
            </div>
          </header>
          <main className="flex-1 overflow-y-auto px-5 py-3">
            {acesso.ativo ? (
              children
            ) : (
              <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center text-texto-suave">
                <Clock size={28} />
                <p className="text-lg font-medium text-texto">Acesso aguardando liberação</p>
                <p>Seu login foi criado. A diretoria precisa definir o seu perfil para as telas aparecerem.</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </AbasProvider>
  );
}
