"use client";

import { CabecalhoTela, Cartao, SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarItensCompra } from "@/lib/compras";
import { hojeBrasil } from "@/lib/datas";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { carregarCategoriasDespesa, carregarFornecedores } from "@/lib/financeiro";
import { salvarPedidoCompra } from "../actions";
import { FormPedidoCompra } from "../form-pedido-compra";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "compras.pedidos";

async function PaginaNovoPedidoCompra() {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "criar")) return <SemAcesso codigo={TELA} />;
  const [empresas, selecionada, fornecedores, categorias, itens] = await Promise.all([
    carregarEmpresas(),
    empresaSelecionada(),
    carregarFornecedores(),
    carregarCategoriasDespesa(),
    carregarItensCompra(),
  ]);
  const hoje = hojeBrasil();

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} />
      <Cartao titulo="Novo pedido de compra">
        <FormPedidoCompra
          acao={salvarPedidoCompra.bind(null, null)}
          pedido={
            selecionada
              ? {
                  empresa_id: selecionada.id,
                  fornecedor_id: null,
                  categoria_id: null,
                  data_pedido: hoje,
                  data_prevista: null,
                  condicao_pagamento: null,
                  dias_parcelas: "",
                  meio_pagamento: null,
                  frete_por_conta: null,
                  transportador: null,
                  valor_frete: 0,
                  valor_desconto: 0,
                  observacoes: null,
                  observacoes_internas: null,
                  itens: [],
                }
              : undefined
          }
          empresas={empresas}
          fornecedores={fornecedores}
          categorias={categorias}
          itens={itens}
          hoje={hoje}
          voltar="/compras/pedidos"
        />
      </Cartao>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaNovoPedidoCompra} />;
}
