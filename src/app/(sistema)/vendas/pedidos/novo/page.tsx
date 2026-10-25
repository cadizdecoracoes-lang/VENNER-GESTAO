"use client";

import { CabecalhoTela, Cartao, SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil } from "@/lib/datas";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { carregarClientes, carregarProdutosVenda } from "@/lib/vendas";
import { salvarPedido } from "../actions";
import { FormPedido } from "../form-pedido";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "vendas.pedidos";

async function PaginaNovoPedido() {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "criar")) return <SemAcesso codigo={TELA} />;
  const [empresas, selecionada, clientes, produtos] = await Promise.all([
    carregarEmpresas(),
    empresaSelecionada(),
    carregarClientes(),
    carregarProdutosVenda(),
  ]);

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} />
      <Cartao titulo="Novo pedido de venda">
        <FormPedido
          acao={salvarPedido.bind(null, null)}
          pedido={
            selecionada
              ? {
                  empresa_id: selecionada.id,
                  cliente_id: "",
                  data_pedido: hojeBrasil(),
                  prazo_entrega: null,
                  condicao_pagamento: null,
                  prazo_recebimento_dias: 28,
                  prioridade: 0,
                  observacao: null,
                  itens: [],
                }
              : undefined
          }
          empresas={empresas}
          clientes={clientes}
          produtos={produtos}
          hoje={hojeBrasil()}
          voltar="/vendas/pedidos"
        />
      </Cartao>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaNovoPedido} />;
}
