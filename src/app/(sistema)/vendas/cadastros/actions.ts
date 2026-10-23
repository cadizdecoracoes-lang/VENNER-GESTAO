"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CADASTROS_COMERCIAL, ehCadastro, lerDias } from "@/lib/cadastros-comercial";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { lerNumero, somenteDigitos } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function salvarCadastroComercial(aba: string, id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  if (!ehCadastro(aba)) return { erro: "Cadastro desconhecido." };
  const cad = CADASTROS_COMERCIAL[aba];

  const dados: Record<string, unknown> = { [cad.ativo]: form.get("ativo") === "on" };
  for (const c of cad.campos) {
    const bruto = String(form.get(c.nome) ?? "").trim();
    if ("obrigatorio" in c && c.obrigatorio && !bruto) return { erro: `Informe ${c.rotulo.toLowerCase()}.` };
    if (c.tipo === "texto") dados[c.nome] = bruto || null;
    else if (c.tipo === "numero") {
      const n = bruto ? lerNumero(bruto) : 0;
      if (Number.isNaN(n)) return { erro: `${c.rotulo}: use números como 10 ou -5,5.` };
      dados[c.nome] = n;
    } else if (c.tipo === "dias") {
      const dias = lerDias(bruto);
      if (!dias) return { erro: "Dias das parcelas: números separados por barra, como 28/56." };
      dados[c.nome] = dias;
    } else {
      const doc = somenteDigitos(bruto);
      if (doc && doc.length !== 11 && doc.length !== 14) return { erro: "O CNPJ tem 14 números e o CPF, 11." };
      dados[c.nome] = doc || null;
    }
  }

  const supabase = await criarClienteServidor();
  const { data, error } = id
    ? await supabase.from(cad.tabela).update(dados).eq("id", id).select("id")
    : await supabase.from(cad.tabela).insert(dados).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath("/vendas/cadastros");
  redirect(`/vendas/cadastros?aba=${aba}`);
}
