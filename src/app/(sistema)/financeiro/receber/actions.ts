"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import type { VendaImportada } from "@/lib/plataformas/tipos";

const CAMINHO = "/financeiro/receber";

function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

// Recebimento lançado à mão (venda avulsa, outra receita), em uma ou várias parcelas mensais.
export async function novaConta(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const texto = (campo: string) => String(form.get(campo) ?? "").trim() || null;
  const empresa = texto("empresa_id");
  const descricao = texto("descricao");
  const valor = lerNumero(form.get("valor"));
  const vencimento = texto("vencimento");
  const parcelas = Math.trunc(lerNumero(form.get("parcelas")) || 1);

  if (!empresa) return { erro: "Escolha a empresa (CNPJ) que vai receber." };
  if (!descricao) return { erro: "Descreva o recebimento, ex.: Venda avulsa no showroom." };
  if (!(valor > 0)) return { erro: "Informe o valor da parcela." };
  if (!vencimento) return { erro: "Informe o vencimento." };
  if (parcelas < 1 || parcelas > 120) return { erro: "O número de parcelas vai de 1 a 120." };

  const linhas = Array.from({ length: parcelas }, (_, i) => ({
    empresa_id: empresa,
    cliente_id: texto("cliente_id"),
    descricao,
    parcela: parcelas > 1 ? `${i + 1}/${parcelas}` : null,
    categoria_id: texto("categoria_id"),
    valor,
    vencimento: somarMeses(vencimento, i),
    observacao: texto("observacao"),
  }));
  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("contas_receber").insert(linhas);
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  // Veio do atalho da conciliação: volta para a linha do extrato.
  const volta = texto("volta");
  redirect(volta?.startsWith("/financeiro/conciliacao") ? volta : CAMINHO);
}

export async function receberConta(id: string, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const data = String(form.get("data_recebimento") ?? "");
  const conta = String(form.get("conta_bancaria_id") ?? "");
  const valor = lerNumero(form.get("valor_recebido"));
  if (!data) return { erro: "Informe a data em que o dinheiro entrou." };
  if (!conta) return { erro: "Escolha a conta bancária onde o dinheiro entrou." };
  if (!(valor > 0)) return { erro: "Informe o valor recebido." };

  const supabase = await criarClienteServidor();
  const { data: linhas, error } = await supabase
    .from("contas_receber")
    .update({ situacao: "pago", data_recebimento: data, conta_bancaria_id: conta, valor_recebido: valor })
    .eq("id", id)
    .eq("situacao", "aberto")
    .select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(linhas);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  redirect(CAMINHO);
}

async function mudarSituacao(id: string, de: string, para: Record<string, unknown>): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("contas_receber").update(para).eq("id", id).eq("situacao", de).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function estornarRecebimento(id: string): Promise<Estado> {
  return mudarSituacao(id, "pago", { situacao: "aberto", data_recebimento: null, conta_bancaria_id: null, valor_recebido: null });
}

export async function cancelarConta(id: string): Promise<Estado> {
  return mudarSituacao(id, "aberto", { situacao: "cancelado" });
}

export async function reabrirConta(id: string): Promise<Estado> {
  return mudarSituacao(id, "cancelado", { situacao: "aberto" });
}

type AnuncioNovo = { codigo: string; titulo: string; item_id: string; quantidade: number };

// Vendas lidas da planilha (ou da API): liga os anúncios novos escolhidos na
// tela e cria pedido, baixa do estoque e título a receber de cada venda.
export async function importarVendas(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  let dados: { empresa: string; canal: string; local: string; vendas: VendaImportada[]; ligar: AnuncioNovo[] };
  try {
    dados = JSON.parse(String(form.get("dados") ?? ""));
  } catch {
    return { erro: "Leia a planilha antes de importar." };
  }
  if (!dados.empresa) return { erro: "Escolha a empresa (CNPJ) dona das vendas." };
  if (!dados.local) return { erro: "Escolha o local de onde sai o estoque." };
  if (!dados.vendas?.length) return { erro: "Nenhuma venda para importar." };
  const semProduto = dados.ligar.filter((a) => !a.item_id).map((a) => a.codigo);
  if (semProduto.length) return { erro: `Escolha o produto dos anúncios: ${semProduto.join(", ")}.` };

  const supabase = await criarClienteServidor();
  if (dados.ligar.length) {
    const { error } = await supabase.from("anuncios_plataforma").upsert(
      dados.ligar.map((a) => ({
        empresa_id: dados.empresa,
        canal: dados.canal,
        codigo: a.codigo,
        titulo: a.titulo || null,
        item_id: a.item_id,
        quantidade: a.quantidade > 0 ? a.quantidade : 1,
      })),
      { onConflict: "empresa_id,canal,codigo,item_id", ignoreDuplicates: true },
    );
    if (error) return { erro: mensagemErro(error) };
  }
  const { data, error } = await supabase.rpc("importar_vendas_plataforma", {
    empresa: dados.empresa,
    canal_venda: dados.canal,
    vendas: dados.vendas,
    local_baixa: dados.local,
  });
  if (error) return { erro: mensagemErro(error) };
  const r = data as { importadas: number; repetidas: number };
  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}?importadas=${r.importadas}&repetidas=${r.repetidas}&canal=${dados.canal}`);
}
