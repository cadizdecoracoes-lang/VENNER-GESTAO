"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { cpfValido, lerNumero, somenteDigitos } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

const texto = (form: FormData, campo: string) => String(form.get(campo) ?? "").trim() || null;

export async function salvarFuncionario(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const nome = texto(form, "nome");
  if (!nome) return { erro: "Informe o nome do funcionário." };
  const cpf = somenteDigitos(form.get("cpf"));
  if (cpf && !cpfValido(cpf)) return { erro: "CPF inválido. Confira os números." };
  const cbo = somenteDigitos(form.get("cbo"));
  if (cbo && cbo.length !== 6) return { erro: "O CBO tem 6 números." };
  const salario = String(form.get("salario_base") ?? "").trim() ? lerNumero(form.get("salario_base")) : null;
  if (salario !== null && !(salario >= 0)) return { erro: "Salário base inválido." };
  const admissao = texto(form, "admissao");
  const desligamento = texto(form, "desligamento");
  if (admissao && desligamento && desligamento < admissao) return { erro: "O desligamento não pode ser antes da admissão." };

  const dados: Record<string, unknown> = {
    nome,
    cpf: cpf || null,
    cargo: texto(form, "cargo"),
    cbo: cbo || null,
    salario_base: salario,
    admissao,
    desligamento,
    telefone: texto(form, "telefone"),
    observacao: texto(form, "observacao"),
    ativo: form.get("ativo") === "on" && !desligamento,
  };
  if (!id) {
    dados.empresa_id = texto(form, "empresa_id");
    dados.matricula = texto(form, "matricula");
    if (!dados.empresa_id) return { erro: "Escolha a empresa empregadora." };
    if (!dados.matricula || /\s/.test(String(dados.matricula))) return { erro: "Informe a matrícula (o código do funcionário na folha), sem espaços." };
  }

  const supabase = await criarClienteServidor();
  const { data, error } = id
    ? await supabase.from("funcionarios").update(dados).eq("id", id).select("id")
    : await supabase.from("funcionarios").insert(dados).select("id");
  if (error) {
    if (error.code === "23505") return { erro: "Já existe um funcionário com essa matrícula nesta empresa." };
    return { erro: mensagemErro(error) };
  }
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath("/rh/funcionarios");
  redirect(`/rh/funcionarios/${data![0].id}`);
}

type Lote = { empresa_id: string; recibos: unknown[]; desligar: string[] };

export async function importarHolerites(_: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  let lotes: Lote[];
  try {
    lotes = JSON.parse(String(form.get("dados") ?? ""));
  } catch {
    return { erro: "Não foi possível ler os recibos. Escolha os arquivos de novo." };
  }
  if (!Array.isArray(lotes) || !lotes.length) return { erro: "Nenhum recibo para gravar." };

  const supabase = await criarClienteServidor();
  let gravados = 0;
  for (const lote of lotes) {
    const { error } = await supabase.rpc("importar_holerites", { empresa: lote.empresa_id, recibos: lote.recibos, desligar: lote.desligar });
    if (error) {
      return {
        erro: `${gravados ? `${gravados} recibos foram gravados, mas o resto parou: ` : ""}${mensagemErro(error)}`,
      };
    }
    gravados += lote.recibos.length;
  }

  revalidatePath("/rh/funcionarios");
  redirect(`/rh/funcionarios?importados=${gravados}`);
}
