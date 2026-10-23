import { notFound } from "next/navigation";
import { CabecalhoTela, Cartao, SemAcesso } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil } from "@/lib/datas";
import { carregarEmpresas } from "@/lib/empresa";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { carregarClientes, carregarOpcoesPedido, carregarProdutosVenda } from "@/lib/vendas";
import { salvarPedido } from "../../actions";
import { FormPedido, type PedidoForm } from "../../form-pedido";

const TELA = "vendas.pedidos";

export default async function PaginaEditarPedido({ params }: { params: Promise<{ id: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "editar")) return <SemAcesso codigo={TELA} />;
  const { id } = await params;
  if (!supabaseConfigurado) notFound();
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("pedidos_venda_resumo")
    .select(
      "numero, fase, empresa_id, cliente_id, data_pedido, prazo_entrega, condicao_pagamento, prazo_recebimento_dias, prioridade, observacao, numero_ordem_compra, vendedor_cadastro_id, lista_preco_id, natureza_operacao_id, forma_pagamento_id, categoria_id, transportadora_id, forma_envio_id, frete_por_conta, valor_frete, valor_desconto, valor_outras_despesas, endereco_entrega, observacao_interna",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const [{ data: itens }, { data: parcelas }, empresas, clientes, produtos, opcoes] = await Promise.all([
    supabase.from("pedido_venda_itens").select("item_id, quantidade, preco_unitario, info_adicional").eq("pedido_id", id),
    supabase.from("pedido_parcelas").select("dias, vencimento, valor, observacao").eq("pedido_id", id).order("numero"),
    carregarEmpresas(),
    carregarClientes(),
    carregarProdutosVenda(),
    carregarOpcoesPedido(),
  ]);
  const pedido = {
    ...data,
    valor_frete: Number(data.valor_frete),
    valor_desconto: Number(data.valor_desconto),
    valor_outras_despesas: Number(data.valor_outras_despesas),
    parcelas: (parcelas ?? []).map((p) => ({ ...p, valor: Number(p.valor) })),
    itens: (itens ?? []).map((i) => ({ ...i, quantidade: Number(i.quantidade), preco_unitario: Number(i.preco_unitario) })),
  } as PedidoForm;

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA} />
      <Cartao titulo={`Editar pedido nº ${data.numero}`}>
        {data.fase !== "negociacao" ? (
          <p className="rounded-xl bg-alerta/10 px-4 py-2.5 text-sm text-alerta">
            Este pedido já saiu da negociação e por isso não pode mais ser alterado. Para mudar produtos ou condições, volte a etapa para
            uma de negociação na tela do pedido.
          </p>
        ) : (
          <FormPedido
            acao={salvarPedido.bind(null, id)}
            pedido={pedido}
            empresas={empresas}
            clientes={clientes}
            produtos={produtos}
            opcoes={opcoes}
            hoje={hojeBrasil()}
            voltar={`/vendas/pedidos/${id}`}
          />
        )}
      </Cartao>
    </div>
  );
}
