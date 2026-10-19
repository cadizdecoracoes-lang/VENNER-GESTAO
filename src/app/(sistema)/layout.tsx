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
          <BarraAbas />
          <header className="flex h-12 items-center justify-end gap-4 border-b border-borda/70 bg-superficie px-6">
            <SeletorEmpresa empresas={empresas} valor={selecionada?.id ?? null} />
            {email ? (
              <form action={sair} className="flex items-center gap-2 text-sm text-texto-suave">
                <span>{email}</span>
                <button className="rounded-lg p-1.5 hover:bg-fundo" aria-label="Sair">
                  <LogOut size={16} />
                </button>
              </form>
            ) : (
              <span className="rounded-full bg-alerta/10 px-3 py-1 text-xs text-alerta">
                Demonstração: banco de dados ainda não conectado
              </span>
            )}
          </header>
          <main className="flex-1 overflow-y-auto p-6">
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
