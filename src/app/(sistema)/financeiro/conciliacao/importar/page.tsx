"use client";

import { CabecalhoTela, Cartao, SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { ImportarExtrato } from "./importar-extrato";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.conciliacao";

async function PaginaImportarExtrato({ searchParams }: { searchParams: Promise<{ conta?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const { conta } = await searchParams;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  let contas: { id: string; nome: string; empresa_id: string; conta: string | null; banco_nome: string | null }[] = [];
  if (supabaseConfigurado) {
    const supabase = criarClienteNavegador();
    let q = supabase.from("contas_bancarias").select("id, nome, empresa_id, conta, banco_nome").eq("ativa", true).neq("tipo", "caixa").order("nome");
    if (selecionada) q = q.eq("empresa_id", selecionada.id);
    contas = (await q).data ?? [];
  }

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} />
      {pode(acesso, TELA, "criar") && (
        <ImportarExtrato
          contas={contas.map((c) => ({ id: c.id, nome: c.nome, empresa: nomeEmpresa.get(c.empresa_id) ?? "", numero: c.conta }))}
          contaInicial={contas.some((c) => c.id === conta) ? conta! : contas.length === 1 ? contas[0].id : ""}
        />
      )}

      {/* Integração com os bancos: mapeada; a leitura automática entra pela mesma importação (origem "banco"). */}
      <section id="banco">
        <Cartao titulo="Extrato automático do banco">
          <div className="grid gap-4 text-sm lg:grid-cols-[1fr_1fr_1fr]">
            <div className="space-y-1">
              <p className="font-medium">1. Open Finance (agregador)</p>
              <p className="text-texto-suave">
                Um contrato com um agregador autorizado pelo Banco Central (ex.: Pluggy, Belvo) lê todas as contas: Itaú, Bradesco, Banco do Brasil, C6,
                Inter... O titular autoriza cada conta no app do banco. Tem mensalidade do agregador.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium">2. API do próprio banco</p>
              <p className="text-texto-suave">
                Cada banco libera o extrato por API para a empresa: cadastro de desenvolvedor no banco, certificado digital e aprovação. Sem intermediário,
                mas é uma ligação por banco.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium">Situação das contas</p>
              <ul className="space-y-0.5">
                {contas.length === 0 && <li className="text-texto-suave">Nenhuma conta bancária cadastrada.</li>}
                {contas.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span>
                      {c.nome} <span className="text-xs text-texto-suave">· {nomeEmpresa.get(c.empresa_id)}</span>
                    </span>
                    <span className="text-xs text-texto-suave">não ligada · por arquivo</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-texto-suave">
            Os dois caminhos já estão previstos: quando a ligação for feita, o robô lê o extrato sozinho e ele entra aqui do mesmo jeito que o arquivo,
            sem repetir lançamentos. Até lá, importe o arquivo do internet banking.
          </p>
        </Cartao>
      </section>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaImportarExtrato} />;
}
