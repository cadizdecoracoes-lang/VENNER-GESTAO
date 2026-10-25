import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero, somenteDigitos } from "@/lib/formato";
import { TIPOS_CONTA_BANCARIA } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

const CAMINHO = "/financeiro/contas-bancarias";

export async function salvarConta(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const texto = (campo: string) => String(form.get(campo) ?? "").trim() || null;
  const empresa = texto("empresa_id");
  const nome = texto("nome");
  const tipo = String(form.get("tipo") ?? "corrente");
  const bancoCodigo = somenteDigitos(form.get("banco_codigo")) || null;
  const saldo = lerNumero(form.get("saldo_inicial"));
  const data = texto("data_saldo_inicial");

  if (!empresa) return { erro: "Escolha a empresa (CNPJ) dona da conta." };
  if (!nome) return { erro: "Dê um nome para a conta, ex.: Itaú movimento." };
  if (!(tipo in TIPOS_CONTA_BANCARIA)) return { erro: "Escolha o tipo de conta." };
  if (bancoCodigo && bancoCodigo.length !== 3) return { erro: "O código do banco tem 3 números (ex.: 341 Itaú, 001 Banco do Brasil)." };
  if (Number.isNaN(saldo)) return { erro: "O saldo inicial precisa ser um número." };
  if (!data) return { erro: "Informe a data do saldo inicial." };

  const dados = {
    empresa_id: empresa,
    nome,
    tipo,
    banco_codigo: bancoCodigo,
    banco_nome: texto("banco_nome"),
    agencia: texto("agencia"),
    conta: texto("conta"),
    saldo_inicial: saldo,
    data_saldo_inicial: data,
    ativa: form.get("ativa") === "on",
  };
  const supabase = criarClienteNavegador();
  const { data: linhas, error } = id
    ? await supabase.from("contas_bancarias").update(dados).eq("id", id).select("id")
    : await supabase.from("contas_bancarias").insert(dados).select("id");
  if (error) {
    if (error.code === "23505") return { erro: "Já existe uma conta com esse nome nesta empresa, ou com o mesmo banco, agência e conta." };
    return { erro: mensagemErro(error) };
  }
  const bloqueado = semLinhas(linhas);
  if (bloqueado) return bloqueado;

  revalidatePath(CAMINHO);
  redirect(CAMINHO);
}
