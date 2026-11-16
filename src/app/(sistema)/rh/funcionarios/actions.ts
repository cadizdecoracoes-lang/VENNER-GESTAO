import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { cpfValido, lerNumero, somenteDigitos } from "@/lib/formato";
import { ROTULO_SETOR } from "@/lib/holerite";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

const texto = (form: FormData, campo: string) => String(form.get(campo) ?? "").trim() || null;

export async function salvarFuncionario(atual: { id: string; admissao: string | null } | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const nome = texto(form, "nome");
  if (!nome) return { erro: "Informe o nome do funcionário." };
  const cpf = somenteDigitos(form.get("cpf"));
  if (cpf && !cpfValido(cpf)) return { erro: "CPF inválido. Confira os números." };
  const cbo = somenteDigitos(form.get("cbo"));
  if (cbo && cbo.length !== 6) return { erro: "O CBO tem 6 números." };
  const salario = String(form.get("salario_base") ?? "").trim() ? lerNumero(form.get("salario_base")) : null;
  if (salario !== null && !(salario >= 0)) return { erro: "Salário base inválido." };
  const setor = texto(form, "setor");
  if (setor && !(setor in ROTULO_SETOR && setor !== "sem_setor")) return { erro: "Escolha um setor da lista." };
  const admissao = texto(form, "admissao");
  const desligamento = texto(form, "desligamento");
  if (admissao && desligamento && desligamento < admissao) return { erro: "O desligamento não pode ser antes da admissão." };

  const dados: Record<string, unknown> = {
    nome,
    cpf: cpf || null,
    cargo: texto(form, "cargo"),
    cbo: cbo || null,
    setor,
    salario_base: salario,
    admissao,
    desligamento,
    telefone: texto(form, "telefone"),
    observacao: texto(form, "observacao"),
    ativo: form.get("ativo") === "on" && !desligamento,
  };
  // Mudou a admissão na ficha: deixa de ser a estimada pelo holerite.
  if (!atual || atual.admissao !== admissao) dados.admissao_estimada = false;
  if (!atual) {
    dados.empresa_id = texto(form, "empresa_id");
    dados.matricula = texto(form, "matricula");
    if (!dados.empresa_id) return { erro: "Escolha a empresa empregadora." };
    if (!dados.matricula || /\s/.test(String(dados.matricula))) return { erro: "Informe a matrícula (o código do funcionário na folha), sem espaços." };
  }

  const supabase = criarClienteNavegador();
  const { data, error } = atual
    ? await supabase.from("funcionarios").update(dados).eq("id", atual.id).select("id")
    : await supabase.from("funcionarios").insert(dados).select("id");
  if (error) {
    if (error.code === "23505") return { erro: "Já existe um funcionário com essa matrícula nesta empresa." };
    return { erro: mensagemErro(error) };
  }
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath("/rh/funcionarios");
  redirect(`/rh/funcionarios/ficha?id=${data![0].id}`);
}

// A admissão estimada pelo holerite está certa: tira a marca de estimada.
export async function confirmarAdmissao(id: string): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.from("funcionarios").update({ admissao_estimada: false }).eq("id", id).select("id");
  if (error) return { erro: mensagemErro(error) };
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;
  revalidatePath("/rh/funcionarios");
  return { ok: Date.now() };
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

  const supabase = criarClienteNavegador();
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
