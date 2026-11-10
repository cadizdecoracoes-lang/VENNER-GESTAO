"use client";

import { CabecalhoTela, SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { ConferirTinyReceber } from "./conferir-tiny";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.receber";

async function PaginaConferirTiny() {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "editar")) return <SemAcesso codigo={TELA} />;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  return (
    <div className="space-y-3">
      <CabecalhoTela
        codigo={TELA}
        empresa={selecionada}
        ajuda="No Tiny (Olist), abra Finanças › Contas a receber, escolha todas as situações e o período, e exporte a planilha (.xlsx). Envie aqui: cada linha é ligada ao título daqui pelo cliente, vencimento e valor. Antes de mudar qualquer coisa a tela mostra quantos ficam recebidos e quantos voltam para em aberto; só depois de clicar em Corrigir os títulos ficam com a situação, a data do recebimento, o valor e a conta do Tiny. Recebimentos feitos aqui ou conciliados com o extrato não mudam."
      />
      <ConferirTinyReceber
        empresas={empresas.map((e) => ({ id: e.id, nome: e.nome }))}
        empresaInicial={selecionada?.id ?? (empresas.length === 1 ? empresas[0].id : "")}
      />
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaConferirTiny} />;
}
