import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, semLinhas, SEM_BANCO, type Estado } from "@/lib/erros";
import { FORMAS_CALCULO, TIPOS_EVENTO_FOLHA } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";

const CAMINHO = "/rh/eventos";

export async function salvarEvento(id: string | null, _: Estado, form: FormData): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;

  const codigo = String(form.get("codigo") ?? "").trim();
  const descricao = String(form.get("descricao") ?? "").trim();
  const tipo = String(form.get("tipo") ?? "");
  const forma = String(form.get("forma_calculo") ?? "valor");
  if (!codigo) return { erro: "Informe o código do evento (o mesmo do holerite da contabilidade)." };
  if (!descricao) return { erro: "Informe a descrição do evento." };
  if (!(tipo in TIPOS_EVENTO_FOLHA)) return { erro: "Escolha se é provento, desconto ou informativo." };
  if (!(forma in FORMAS_CALCULO)) return { erro: "Escolha como o evento é informado." };

  // Informativo não entra em base de cálculo.
  const incide = (campo: string) => tipo !== "informativo" && form.get(campo) === "on";
  const dados = {
    codigo,
    descricao,
    tipo,
    forma_calculo: forma,
    incide_inss: incide("incide_inss"),
    incide_fgts: incide("incide_fgts"),
    incide_irrf: incide("incide_irrf"),
    observacao: String(form.get("observacao") ?? "").trim() || null,
    ativo: form.get("ativo") === "on",
  };
  const supabase = criarClienteNavegador();
  const { data, error } = id
    ? await supabase.from("eventos_folha").update(dados).eq("id", id).select("id")
    : await supabase.from("eventos_folha").insert(dados).select("id");
  if (error) {
    if (error.code === "23505") return { erro: "Já existe um evento com esse código." };
    return { erro: mensagemErro(error) };
  }
  const bloqueado = semLinhas(data);
  if (bloqueado) return bloqueado;

  revalidatePath(CAMINHO);
  redirect(CAMINHO);
}
