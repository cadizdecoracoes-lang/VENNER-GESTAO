"use client";

import { notFound } from "@/lib/navegacao";
import { CabecalhoTela, Cartao, SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { CAMPOS_PEDIDO_COMPRA, carregarItensCompra, type PedidoCompraResumo } from "@/lib/compras";
import { hojeBrasil } from "@/lib/datas";
import { carregarEmpresas } from "@/lib/empresa";
import { carregarCategoriasDespesa, carregarFornecedores } from "@/lib/financeiro";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { salvarPedidoCompra } from "../actions";
import { FormPedidoCompra } from "../form-pedido-compra";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "compras.pedidos";

async function PaginaEditarPedidoCompra({ params }: { params: Promise<{ id: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "editar")) return <SemAcesso codigo={TELA} />;
  const { id } = await params;
  if (!supabaseConfigurado) notFound();
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("pedidos_compra_resumo").select(CAMPOS_PEDIDO_COMPRA).eq("id", id).maybeSingle();
  if (!data) notFound();
  const p = data as unknown as PedidoCompraResumo;
  const [{ data: itensPedido }, { data: parcelas }, empresas, fornecedores, categorias, itens] = await Promise.all([
    supabase.from("pedido_compra_itens").select("item_id, quantidade, valor_unitario, aliquota_ipi, informacoes_adicionais").eq("pedido_id", id),
    supabase.from("pedido_compra_parcelas").select("dias, meio_pagamento").eq("pedido_id", id).order("vencimento"),
    carregarEmpresas(),
    carregarFornecedores(),
    carregarCategoriasDespesa(),
    carregarItensCompra(),
  ]);
  const editavel = p.etapa === "criacao" || p.etapa === "orcamento";

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} />
      <Cartao titulo={`Editar pedido de compra nº ${p.numero}`}>
        {!editavel ? (
          <p className="rounded-xl bg-alerta/10 px-4 py-2.5 text-sm text-alerta">
            Este pedido já foi para aprovação e por isso não pode mais ser alterado. Para mudar, volte o pedido para Orçamento na tela do
            pedido (com o motivo).
          </p>
        ) : (
          <FormPedidoCompra
            acao={salvarPedidoCompra.bind(null, id)}
            editando
            pedido={{
              ...p,
              valor_frete: Number(p.valor_frete),
              valor_desconto: Number(p.valor_desconto),
              dias_parcelas: (parcelas ?? []).map((x) => x.dias).join("/"),
              meio_pagamento: parcelas?.[0]?.meio_pagamento ?? null,
              itens: (itensPedido ?? []).map((i) => ({
                ...i,
                quantidade: Number(i.quantidade),
                valor_unitario: Number(i.valor_unitario),
                aliquota_ipi: Number(i.aliquota_ipi),
              })),
            }}
            empresas={empresas}
            fornecedores={fornecedores}
            categorias={categorias}
            itens={itens}
            hoje={hojeBrasil()}
            voltar={`/compras/pedidos/pedido?id=${id}`}
          />
        )}
      </Cartao>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaEditarPedidoCompra} />;
}
