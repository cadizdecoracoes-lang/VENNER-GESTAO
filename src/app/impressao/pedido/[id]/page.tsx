import { notFound } from "next/navigation";
import { carregarAcesso, pode } from "@/lib/acesso";
import { formatarData, formatarDocumento, formatarMoeda, formatarNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { BotaoImprimir } from "../../botao-imprimir";

// Pedido de venda no padrão da Venner, para imprimir ou salvar em PDF e mandar
// ao cliente. Fica fora do layout do sistema (sem menu) para sair limpo no papel.

type Item = {
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
  itens: { codigo: string; descricao: string; unidade: string } | null;
};

export default async function ImprimirPedido({ params }: { params: Promise<{ id: string }> }) {
  const acesso = await carregarAcesso();
  if (!supabaseConfigurado || !pode(acesso, "vendas.pedidos", "ver")) notFound();
  const { id } = await params;
  const supabase = await criarClienteServidor();
  const { data: pedido } = await supabase
    .from("pedidos_venda_resumo")
    .select(
      "numero, data_pedido, prazo_entrega, condicao_pagamento, prazo_recebimento_dias, observacao, valor_total, empresas(razao_social, nome_fantasia, cnpj), clientes(nome, nome_fantasia, documento, email, telefone, cidade, uf)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!pedido) notFound();
  const { data: itensData } = await supabase
    .from("pedido_venda_itens")
    .select("quantidade, preco_unitario, valor_total, itens(codigo, descricao, unidade)")
    .eq("pedido_id", id);
  const itens = ((itensData ?? []) as unknown as Item[]).sort((a, b) => (a.itens?.codigo ?? "").localeCompare(b.itens?.codigo ?? ""));
  const empresa = pedido.empresas as unknown as { razao_social: string; nome_fantasia: string | null; cnpj: string } | null;
  const cliente = pedido.clientes as unknown as {
    nome: string;
    nome_fantasia: string | null;
    documento: string | null;
    email: string | null;
    telefone: string | null;
    cidade: string | null;
    uf: string | null;
  } | null;

  return (
    <div className="min-h-full bg-fundo py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end print:hidden">
        <BotaoImprimir />
      </div>
      <article className="mx-auto max-w-[210mm] space-y-6 bg-white p-10 text-sm text-black shadow-[0_1px_3px_rgba(16,24,40,0.1)] print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div className="flex items-center gap-4">
            {/* Logo da Venner: entra aqui quando o arquivo for enviado. */}
            <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed border-gray-400 text-xs text-gray-500">
              Logo
            </div>
            <div>
              <p className="text-lg font-semibold">{empresa?.nome_fantasia ?? empresa?.razao_social ?? "Venner"}</p>
              {empresa && (
                <p className="text-xs text-gray-600">
                  {empresa.razao_social} · CNPJ {formatarDocumento(empresa.cnpj)}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-gray-600">Pedido de venda</p>
            <p className="text-2xl font-semibold">Nº {pedido.numero}</p>
            <p className="text-xs text-gray-600">Emitido em {formatarData(pedido.data_pedido)}</p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Cliente</p>
            <p className="font-medium">{cliente?.nome}</p>
            {cliente?.nome_fantasia && <p>{cliente.nome_fantasia}</p>}
            <p>{cliente?.documento ? `${cliente.documento.length === 11 ? "CPF" : "CNPJ"} ${formatarDocumento(cliente.documento)}` : ""}</p>
            <p>{[cliente?.cidade, cliente?.uf].filter(Boolean).join(" / ")}</p>
            <p>{[cliente?.telefone, cliente?.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Condições</p>
            <p>Prazo de entrega: {formatarData(pedido.prazo_entrega)}</p>
            <p>
              Pagamento:{" "}
              {pedido.condicao_pagamento ?? (pedido.prazo_recebimento_dias === 0 ? "À vista" : `${pedido.prazo_recebimento_dias} dias`)}
            </p>
          </div>
        </section>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left text-xs uppercase tracking-wide text-gray-600">
              <th className="py-2 pr-2 font-semibold">Código</th>
              <th className="py-2 pr-2 font-semibold">Descrição</th>
              <th className="py-2 pr-2 text-right font-semibold">Qtd.</th>
              <th className="py-2 pr-2 font-semibold">Un.</th>
              <th className="py-2 pr-2 text-right font-semibold">Preço unit.</th>
              <th className="py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i, k) => (
              <tr key={k} className="border-b border-gray-300">
                <td className="py-2 pr-2">{i.itens?.codigo}</td>
                <td className="py-2 pr-2">{i.itens?.descricao}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatarNumero(Number(i.quantidade))}</td>
                <td className="py-2 pr-2">{i.itens?.unidade}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatarMoeda(Number(i.preco_unitario))}</td>
                <td className="py-2 text-right tabular-nums">{formatarMoeda(Number(i.valor_total))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="pt-3 text-right font-semibold">
                Total do pedido
              </td>
              <td className="pt-3 text-right text-base font-semibold tabular-nums">{formatarMoeda(Number(pedido.valor_total))}</td>
            </tr>
          </tfoot>
        </table>

        {pedido.observacao && (
          <section>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Observações</p>
            <p className="whitespace-pre-line">{pedido.observacao}</p>
          </section>
        )}

        <section className="grid grid-cols-2 gap-10 pt-16">
          <div className="border-t border-black pt-1 text-center text-xs">
            {empresa?.nome_fantasia ?? empresa?.razao_social ?? "Venner"}
          </div>
          <div className="border-t border-black pt-1 text-center text-xs">De acordo do cliente</div>
        </section>
      </article>
    </div>
  );
}
