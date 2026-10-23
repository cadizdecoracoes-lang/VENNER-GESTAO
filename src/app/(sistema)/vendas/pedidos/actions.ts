"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { lerNumero } from "@/lib/formato";
import { diasDaCondicao, dividirParcelas } from "@/lib/parcelas";

type ItemForm = { item_id: string; quantidade: number; preco_unitario: number; info_adicional?: string };
type ParcelaForm = { dias: number | null; vencimento: string; valor: number; observacao?: string; forma_pagamento_id?: string };

const lerJson = <T>(form: FormData, campo: string, padrao: T): T | null => {
  try {
    return JSON.parse(String(form.get(campo) ?? "")) as T;
  } catch {
    return form.get(campo) === null ? padrao : null;
  }
};

// O formulário manda os itens num campo "itens" (JSON), montado na tela.
export async function salvarPedido(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  let itens = lerJson<ItemForm[]>(form, "itens", []);
  const parcelas = lerJson<ParcelaForm[]>(form, "parcelas", []);
  const endereco = lerJson<Record<string, string>>(form, "endereco_entrega", {});
  if (!itens || !parcelas || !endereco) return { erro: "Não foi possível ler os itens do pedido." };
  itens = itens.filter((i) => i.item_id);
  if (itens.length === 0) return { erro: "Inclua pelo menos um produto." };
  if (itens.some((i) => !(i.quantidade > 0))) return { erro: "Toda quantidade precisa ser maior que zero." };
  if (itens.some((i) => !(i.preco_unitario >= 0))) return { erro: "Confira os preços: use números como 1.234,56." };
  if (new Set(itens.map((i) => i.item_id)).size !== itens.length)
    return { erro: "Há um produto repetido: junte as quantidades numa linha só." };

  const cliente = String(form.get("cliente_id") ?? "");
  const empresa = String(form.get("empresa_id") ?? "");
  if (!cliente) return { erro: "Escolha o cliente." };
  if (!id && !empresa) return { erro: "Escolha a empresa que vende." };
  if (parcelas.some((p) => !p.vencimento || !(p.valor > 0)))
    return { erro: "Toda parcela precisa de vencimento e valor maior que zero (ou tire a parcela)." };
  const valor = (campo: string) => (form.get(campo) ? lerNumero(form.get(campo)) : 0);
  const [frete, desconto, outras] = [valor("valor_frete"), valor("valor_desconto"), valor("valor_outras_despesas")];
  if ([frete, desconto, outras].some((v) => !(v >= 0))) return { erro: "Frete, desconto e outras despesas: use números como 1.234,56." };
  // O prazo de recebimento (peso na fila de produção) passa a vir da primeira parcela.
  const recebimento = parcelas[0]?.dias ?? Number(form.get("prazo_recebimento_dias") || 0);
  const texto = (campo: string) => String(form.get(campo) ?? "");
  const limpo = Object.fromEntries(Object.entries(endereco).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v));

  const dados = {
    id,
    empresa_id: empresa,
    cliente_id: cliente,
    data_pedido: String(form.get("data_pedido") || "") || null,
    prazo_entrega: String(form.get("prazo_entrega") || "") || null,
    condicao_pagamento: String(form.get("condicao_pagamento") ?? ""),
    prazo_recebimento_dias: recebimento,
    prioridade: Number(form.get("prioridade") || 0),
    observacao: texto("observacao"),
    numero_ordem_compra: texto("numero_ordem_compra"),
    vendedor_cadastro_id: texto("vendedor_cadastro_id"),
    lista_preco_id: texto("lista_preco_id"),
    natureza_operacao_id: texto("natureza_operacao_id"),
    forma_pagamento_id: texto("forma_pagamento_id"),
    categoria_id: texto("categoria_id"),
    transportadora_id: texto("transportadora_id"),
    forma_envio_id: texto("forma_envio_id"),
    frete_por_conta: texto("frete_por_conta"),
    valor_frete: frete,
    valor_desconto: desconto,
    valor_outras_despesas: outras,
    endereco_entrega: limpo,
    observacao_interna: texto("observacao_interna"),
    parcelas,
    itens,
  };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("salvar_pedido_venda", { dados });
  if (error) return { erro: error.code === "42501" ? "Seu perfil não pode lançar pedidos nesta empresa." : mensagemErro(error) };
  revalidatePath("/vendas/pedidos");
  redirect(`/vendas/pedidos/${data}`);
}

export async function mudarEtapa(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const etapa = String(form.get("etapa_id") ?? "");
  if (!etapa) return { erro: "Escolha a etapa." };
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("pedidos_venda").update({ etapa_id: etapa }).eq("id", id).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath("/vendas/pedidos");
  revalidatePath(`/vendas/pedidos/${id}`);
  return { ok: Date.now() };
}

// Parcelas a receber do pedido: dias da condição de pagamento contados da data base.
export async function gerarParcelas(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const base = String(form.get("base") ?? "");
  const total = lerNumero(form.get("total"));
  const dias = diasDaCondicao(String(form.get("dias") ?? ""), 0);
  if (!base) return { erro: "Informe a data de onde contam os dias (normalmente a da nota ou da entrega)." };
  if (!(total > 0)) return { erro: "Informe o valor total a receber." };
  if (dias.length > 24) return { erro: "No máximo 24 parcelas." };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("gerar_receber_pedido", { pedido: id, parcelas: dividirParcelas(total, dias, base) });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(`/vendas/pedidos/${id}`);
  revalidatePath("/financeiro/receber");
  return { ok: Date.now() };
}
