import { redirect, revalidatePath } from "@/lib/navegacao";
import { mensagemErro, SEM_BANCO, type Estado } from "@/lib/erros";
import { sugerirConciliacao, type LinhaExtrato } from "@/lib/extrato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { carregarCandidatos, carregarContas, carregarLinhas } from "./dados";

const CAMINHO = "/financeiro/conciliacao";
const ORIGENS = ["ofx", "planilha", "pdf"] as const;

export type ExtratoParaGravar = {
  conta: string;
  origem: (typeof ORIGENS)[number];
  arquivo: string;
  saldoFinal: number | null;
  // "banco|agência|conta" lido do arquivo: a tela reconhece a conta da próxima vez.
  contaNoArquivo: string | null;
  linhas: LinhaExtrato[];
};

// Grava um arquivo lido (a tela já mostrou e a pessoa conferiu). Lançamento
// que já está no sistema não entra de novo (regra do banco, importar_extrato).
export async function gravarExtrato(dados: ExtratoParaGravar): Promise<{ importadas: number; repetidas: number } | { erro: string }> {
  if (!supabaseConfigurado) return { erro: SEM_BANCO.erro ?? "Sem banco de dados." };
  if (!dados.conta) return { erro: "Escolha a conta bancária do extrato." };
  if (!ORIGENS.includes(dados.origem)) return { erro: "Formato de arquivo não reconhecido." };
  if (!dados.linhas?.length) return { erro: "O arquivo não tem lançamentos para importar." };
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase.rpc("importar_extrato", {
    conta_bancaria: dados.conta,
    origem: dados.origem,
    arquivo: dados.arquivo,
    linhas: dados.linhas.map(({ data, descricao, documento, valor, saldo, id_banco }) => ({ data, descricao, documento, valor, saldo, id_banco })),
    saldo_final: dados.saldoFinal,
    conta_no_arquivo: dados.contaNoArquivo,
  });
  if (error) return { erro: mensagemErro(error) };
  const r = data as { importadas: number; repetidas: number };
  return { importadas: r.importadas, repetidas: r.repetidas };
}

// Depois de gravar todos os arquivos: o que casa sem dúvida com um título já
// sai conciliado (na lista ficam só as divergências) e vai para a conciliação.
export async function terminarImportacao(contas: string[], arquivos: number, importadas: number, repetidas: number) {
  let auto = 0;
  for (const c of contas) auto += await conciliarCertas(c);
  revalidatePath(CAMINHO);
  const busca = new URLSearchParams({
    conta: contas[0] ?? "",
    importadas: String(importadas),
    repetidas: String(repetidas),
    automaticas: String(auto),
    ...(arquivos > 1 ? { arquivos: String(arquivos), contas: String(contas.length) } : {}),
  });
  redirect(`${CAMINHO}?${busca}`);
}

async function chamar(funcao: string, args: Record<string, unknown>): Promise<Estado> {
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = criarClienteNavegador();
  const { error } = await supabase.rpc(funcao, args);
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function conciliar(lancamento: string, pagar: string[], receber: string[]): Promise<Estado> {
  return chamar("conciliar_lancamento", { lancamento, pagar, receber });
}

// Várias linhas do extrato com vários títulos de uma vez (ex.: um título
// recebido em duas entradas). Só liga extrato e títulos; não dá baixa.
export async function conciliarVarios(lancamentos: string[], pagar: string[], receber: string[]): Promise<Estado> {
  return chamar("conciliar_lancamentos", { lancamentos, pagar, receber });
}

// Aceita todas as sugestões da tela de uma vez; para na primeira que der erro.
export async function conciliarSugestoes(_: Estado, form: FormData): Promise<Estado> {
  let pares: { linha: string; tipo: "pagar" | "receber"; titulos: string[] }[];
  try {
    pares = JSON.parse(String(form.get("pares") ?? "[]"));
  } catch {
    return { erro: "Sugestões inválidas. Recarregue a tela." };
  }
  let feitas = 0;
  for (const p of pares) {
    const r = await chamar("conciliar_lancamento", {
      lancamento: p.linha,
      pagar: p.tipo === "pagar" ? p.titulos : [],
      receber: p.tipo === "receber" ? p.titulos : [],
    });
    if (r.erro) return { erro: `${feitas} conciliada(s). Parou numa linha: ${r.erro}` };
    feitas++;
  }
  return { ok: Date.now() };
}

export async function ignorar(lancamento: string, _: Estado, form: FormData): Promise<Estado> {
  const motivo = String(form.get("motivo") ?? "").trim();
  if (!motivo) return { erro: "Escreva o motivo para ignorar." };
  return chamar("marcar_lancamento", { lancamento, situacao: "ignorado", observacao: motivo });
}

// Mesmo lançamento que outra importação trouxe com a data trocada (a tela
// aponta; a pessoa confirma). Motivo próprio: a regra automática de repetidos
// (mesma data) não mexe nestas.
export const MOTIVO_REPETIDA_DATA = "Repetido de outra importação (data diferente)";
export async function marcarRepetida(lancamento: string): Promise<Estado> {
  return chamar("marcar_lancamento", { lancamento, situacao: "ignorado", observacao: MOTIVO_REPETIDA_DATA });
}

export async function marcarRepetidas(_: Estado, form: FormData): Promise<Estado> {
  let ids: string[];
  try {
    ids = JSON.parse(String(form.get("linhas") ?? "[]"));
  } catch {
    return { erro: "Linhas inválidas. Recarregue a tela." };
  }
  if (!supabaseConfigurado) return SEM_BANCO;
  const supabase = criarClienteNavegador();
  let feitas = 0;
  for (const id of ids) {
    const { error } = await supabase.rpc("marcar_lancamento", { lancamento: id, situacao: "ignorado", observacao: MOTIVO_REPETIDA_DATA });
    if (error) {
      revalidatePath(CAMINHO);
      return { erro: `${feitas} marcada(s). Parou numa linha: ${mensagemErro(error)}` };
    }
    feitas++;
  }
  revalidatePath(CAMINHO);
  return { ok: Date.now() };
}

export async function desfazer(lancamento: string): Promise<Estado> {
  return chamar("desfazer_conciliacao", { lancamento });
}

// Apaga uma importação inteira (linhas do extrato), desfazendo as baixas que a
// conciliação fez nos títulos.
export async function excluirImportacao(importacao: string): Promise<Estado> {
  return chamar("excluir_importacao_extrato", { importacao });
}

// Concilia as linhas pendentes da conta que casam sem dúvida com um título
// (ver Sugestao.certa). Devolve quantas foram conciliadas; erro numa linha não
// para as outras (ela só continua pendente).
export async function conciliarCertas(contaId: string): Promise<number> {
  const conta = (await carregarContas(null)).find((c) => c.id === contaId);
  if (!conta) return 0;
  const pend = await carregarLinhas(conta.id, "pendente", null, null);
  if (!pend.length) return 0;
  const candidatos = await carregarCandidatos(conta, pend[0].data, pend[pend.length - 1].data);
  const tipo = new Map(candidatos.map((t) => [t.id, t.tipo]));
  const supabase = criarClienteNavegador();
  let feitas = 0;
  for (const [linha, s] of sugerirConciliacao(pend, candidatos)) {
    if (!s.certa) continue;
    const pagar = tipo.get(s.titulos[0]) === "pagar";
    const { error } = await supabase.rpc("conciliar_lancamento", { lancamento: linha, pagar: pagar ? s.titulos : [], receber: pagar ? [] : s.titulos });
    if (!error) feitas++;
  }
  return feitas;
}

