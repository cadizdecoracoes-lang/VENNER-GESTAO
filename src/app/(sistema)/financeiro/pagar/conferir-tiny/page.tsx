"use client";

import { CabecalhoTela, SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { ConferirTiny } from "./conferir-tiny";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.pagar";

async function PaginaConferirTiny() {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "editar")) return <SemAcesso codigo={TELA} />;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  return (
    <div className="space-y-3">
      <CabecalhoTela
        codigo={TELA}
        empresa={selecionada}
        ajuda="No Tiny, exporte a planilha de contas a pagar (todas as situações) e envie aqui. Cada linha é ligada ao título que veio do Tiny pelo fornecedor, vencimento e valor; a situação, a data do pagamento, o valor pago e a conta ficam como no Tiny. Baixas feitas aqui no sistema ou conciliadas com o extrato não mudam. Tudo fica no histórico da conta."
      />
      <ConferirTiny
        empresas={empresas.map((e) => ({ id: e.id, nome: e.nome }))}
        empresaInicial={selecionada?.id ?? (empresas.length === 1 ? empresas[0].id : "")}
      />
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaConferirTiny} />;
}
