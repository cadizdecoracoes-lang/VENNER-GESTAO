"use client";

import { Clock, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AbasProvider } from "@/components/abas";
import { BarraAbas } from "@/components/barra-abas";
import { MenuLateral } from "@/components/menu-lateral";
import { SaidaPorInatividade } from "@/components/saida-inatividade";
import { SeletorEmpresa } from "@/components/seletor-empresa";
import { Carregando } from "@/components/tela-cliente";
import { type Acesso, carregarAcesso, telasVisiveis } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada, type EmpresaResumo } from "@/lib/empresa";
import { aoRecarregar, registrarNavegacao } from "@/lib/navegacao";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { sair } from "../login/actions";

type Dados = { acesso: Acesso; empresas: EmpresaResumo[]; selecionada: EmpresaResumo | null };

export default function LayoutSistema({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [dados, setDados] = useState<Dados | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    registrarNavegacao((url) => router.push(url));
    return aoRecarregar(() => setVersao((v) => v + 1));
  }, [router]);

  useEffect(() => {
    Promise.all([carregarAcesso(), carregarEmpresas(), empresaSelecionada()]).then(([acesso, empresas, selecionada]) => {
      // Sem login: vai para a tela de entrada (antes era o proxy do servidor).
      if (supabaseConfigurado && !acesso.email) router.replace("/login");
      else setDados({ acesso, empresas, selecionada });
    });
  }, [router, versao]);

  if (!dados) return <div className="p-6"><Carregando /></div>;
  const { acesso, empresas, selecionada } = dados;
  const { email } = acesso;

  return (
    <AbasProvider>
      {supabaseConfigurado && <SaidaPorInatividade />}
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
