// Nota fiscal de venda pelo Tiny: gera a nota do pedido, manda autorizar na
// SEFAZ, guarda o DANFE e o XML no Storage e pede ao Tiny que lance as contas
// a receber. Chamado pela Edge Function integracoes com o login de quem
// clicou; o banco (nf_venda_*) confere o perfil em cada passo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ErroTiny, GravacaoTiny, renovarTiny } from "./api.ts";
import { data } from "./normalizar.ts";

export type SituacaoNota = "gerada" | "enviada" | "autorizada" | "rejeitada" | "denegada" | "cancelada";

// Mesma tabela da função situacao_nf_tiny do banco.
export function situacaoNota(codigo: unknown): SituacaoNota | null {
  switch (Number(codigo)) {
    case 1:
      return "gerada";
    case 3:
      return "cancelada";
    case 5:
      return "rejeitada";
    case 6:
    case 7:
      return "autorizada";
    case 10:
      return "denegada";
    case 2:
    case 4:
    case 8:
    case 9:
      return "enviada";
    default:
      return null;
  }
}

// O Tiny devolve a nota do pedido em notaFiscal.id ou em idNotaFiscal.
export function notaDoPedido(pedido: unknown): number | null {
  const p = (pedido && typeof pedido === "object" ? pedido : {}) as { idNotaFiscal?: unknown; notaFiscal?: { id?: unknown } | null };
  const id = Number(p.notaFiscal?.id ?? p.idNotaFiscal ?? 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type NotaAtual = {
  id: string;
  tiny_id: number;
  situacao: SituacaoNota;
  numero: string | null;
  contas_lancadas: boolean;
  danfe_arquivo: string | null;
  xml_arquivo: string | null;
};

type Acesso = {
  empresa_id: string;
  pedido_tiny: number;
  access_token: string;
  refresh_token: string | null;
  expira_em: string | null;
  client_id: string | null;
  client_secret: string | null;
  lendo: boolean;
  nota: NotaAtual | null;
};

export type ResultadoNota = { situacao: SituacaoNota; numero: string | null; mensagem: string | null };

type Bruto = Record<string, unknown>;
const BUCKET = "notas-venda";
const texto = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

async function abrir(supabase: SupabaseClient, pedido: string) {
  const r = await supabase.rpc("nf_venda_acesso", { pedido });
  if (r.error) throw new Error(r.error.message);
  const acesso = r.data as Acesso;
  let token = acesso.access_token;
  // A leitura automática renova o acesso a cada 4 horas; só renova aqui se faltar pouco.
  if (!acesso.expira_em || Date.parse(acesso.expira_em) < Date.now() + 2 * 60_000) {
    if (acesso.lendo) throw new Error("O sistema está lendo o Tiny agora. Tente de novo em um minuto.");
    if (!acesso.refresh_token || !acesso.client_id || !acesso.client_secret)
      throw new Error("O acesso ao Tiny venceu. Ligue a conta de novo em Configurações › Integrações.");
    const novo = await renovarTiny(acesso.refresh_token, acesso.client_id, acesso.client_secret).catch(() => {
      throw new Error("O acesso ao Tiny venceu. Ligue a conta de novo em Configurações › Integrações.");
    });
    const salvo = await supabase.rpc("nf_venda_tokens", {
      pedido,
      acesso: novo.access_token,
      renovacao: novo.refresh_token,
      expira: novo.expira_em,
    });
    if (salvo.error) throw new Error(salvo.error.message);
    token = novo.access_token;
  }
  const nota = acesso.nota && !["cancelada", "denegada"].includes(acesso.nota.situacao) ? acesso.nota : null;
  return { acesso, nota, tiny: new GravacaoTiny(token) };
}

async function gravar(supabase: SupabaseClient, pedido: string, dados: Bruto): Promise<string> {
  const r = await supabase.rpc("nf_venda_gravar", { pedido, dados });
  if (r.error) throw new Error(r.error.message);
  return r.data as string;
}

async function guardar(supabase: SupabaseClient, caminho: string, conteudo: Uint8Array | string, tipo: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, conteudo, { contentType: tipo, upsert: true });
  if (error) throw new Error(`não foi possível guardar o arquivo (${error.message})`);
  return caminho;
}

// Situação atual da nota no Tiny, com os dados que vão para a tela.
async function lerNota(tiny: GravacaoTiny, id: number): Promise<Bruto> {
  const d = await tiny.json("GET", `/notas/${id}`);
  if (!d) throw new Error("O Tiny não encontrou a nota deste pedido.");
  return {
    tiny_id: id,
    situacao_tiny: Number(d.situacao) || null,
    numero: texto(d.numero),
    serie: texto(d.serie),
    chave_acesso: texto(d.chaveAcesso),
    valor: d.valorNotaComImpostos ?? d.valor ?? null,
    emitida_em: data(d.dataEmissao),
  };
}

// Nota autorizada: DANFE, XML e contas a receber. Cada parte que falhar fica
// escrita na mensagem; o botão Atualizar tenta de novo só o que faltou.
async function completar(
  supabase: SupabaseClient,
  tiny: GravacaoTiny,
  pedido: string,
  empresa: string,
  notaId: string,
  atual: Partial<NotaAtual>,
  dados: Bruto,
  xmlPronto: string | null,
): Promise<Bruto> {
  const id = Number(dados.tiny_id);
  const faltas: string[] = [];
  if (!atual.xml_arquivo) {
    try {
      const xml = xmlPronto ?? texto((await tiny.json("GET", `/notas/${id}/xml`))?.xmlNfe);
      if (!xml) throw new Error("o Tiny ainda não entregou o XML");
      dados.xml_arquivo = await guardar(supabase, `${empresa}/${notaId}.xml`, xml, "application/xml");
    } catch (e) {
      faltas.push(`XML: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!atual.danfe_arquivo) {
    try {
      const pdf = await tiny.arquivo(`/notas/${id}/comprovante?format=pdf`, "application/pdf");
      dados.danfe_arquivo = await guardar(supabase, `${empresa}/${notaId}.pdf`, pdf, "application/pdf");
    } catch (e) {
      faltas.push(`DANFE: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!dados.link) {
    dados.link = texto((await tiny.json("GET", `/notas/${id}/link`).catch(() => null))?.link);
  }
  if (!atual.contas_lancadas) {
    try {
      await tiny.json("POST", `/notas/${id}/lancar-contas`);
      dados.contas_lancadas = true;
    } catch (e) {
      // Contas já lançadas (pelo pedido ou na mão, no Tiny) não são erro.
      if (e instanceof ErroTiny && e.status === 400 && /lan[çc]ad/i.test(e.message)) dados.contas_lancadas = true;
      else faltas.push(`Contas a receber: ${e instanceof Error ? e.message : e}`);
    }
  }
  dados.mensagem = faltas.length ? `Nota autorizada, mas faltou: ${faltas.join(" · ")}. Clique em Atualizar.` : null;
  await gravar(supabase, pedido, dados);
  return dados;
}

const resultado = (d: Bruto): ResultadoNota => ({
  situacao: situacaoNota(d.situacao_tiny) ?? "gerada",
  numero: texto(d.numero),
  mensagem: texto(d.mensagem),
});

// Emitir (autorizar = true) ou só trazer do Tiny a situação, o DANFE e o XML.
export async function emitirNota(
  supabase: SupabaseClient,
  pedido: string,
  opcoes: { autorizar: boolean; enviarEmail?: boolean },
): Promise<ResultadoNota> {
  const { acesso, nota, tiny } = await abrir(supabase, pedido);
  let tinyId = nota?.tiny_id ?? null;
  let notaId = nota?.id ?? null;

  if (!tinyId) {
    // Nota já gerada no próprio Tiny para este pedido: adota em vez de gerar outra.
    const p = await tiny.json("GET", `/pedidos/${acesso.pedido_tiny}`);
    if (!p) throw new Error("O Tiny não encontrou este pedido (foi excluído lá?).");
    tinyId = notaDoPedido(p);
    // Nota cancelada ou denegada no pedido do Tiny: para emitir, gera outra.
    if (tinyId && opcoes.autorizar) {
      const anterior = situacaoNota((await tiny.json("GET", `/notas/${tinyId}`))?.situacao);
      if (anterior === "cancelada" || anterior === "denegada") tinyId = null;
    }
    if (!tinyId) {
      if (!opcoes.autorizar) throw new Error("O Tiny ainda não tem nota para este pedido.");
      const g = await tiny.json("POST", `/pedidos/${acesso.pedido_tiny}/gerar-nota-fiscal`, { modelo: 55 });
      tinyId = Number(g?.id) || null;
      if (!tinyId) throw new Error("O Tiny não devolveu a nota gerada. Confira o pedido no Tiny.");
      notaId = await gravar(supabase, pedido, { tiny_id: tinyId, numero: texto(g?.numero), serie: texto(g?.serie), modelo: 55, situacao_tiny: 1 });
    }
  }

  let dados = await lerNota(tiny, tinyId);
  notaId = await gravar(supabase, pedido, { ...dados, mensagem: null });
  let xml: string | null = null;

  const sit = situacaoNota(dados.situacao_tiny);
  if (opcoes.autorizar && (sit === "gerada" || sit === "rejeitada")) {
    try {
      const r = await tiny.json("POST", `/notas/${tinyId}/emitir`, { enviarEmail: Boolean(opcoes.enviarEmail) });
      xml = texto(r?.xml);
      dados = {
        ...dados,
        situacao_tiny: Number(r?.situacao) || dados.situacao_tiny,
        chave_acesso: texto(r?.chaveAcesso) ?? dados.chave_acesso,
        link: texto(r?.linkAcesso),
      };
      // Número e data saem na autorização.
      if (situacaoNota(dados.situacao_tiny) === "autorizada") dados = { ...dados, ...(await lerNota(tiny, tinyId)), link: dados.link };
    } catch (e) {
      if (!(e instanceof ErroTiny) || e.status === 401 || e.status === 403 || e.status === 429 || e.status === 0) throw e;
      // Rejeição da SEFAZ ou dado faltando no Tiny: guarda o motivo e a situação real.
      const depois = await lerNota(tiny, tinyId).catch(() => dados);
      await gravar(supabase, pedido, { ...depois, mensagem: e.message });
      return resultado({ ...depois, mensagem: e.message });
    }
  }

  if (situacaoNota(dados.situacao_tiny) === "autorizada") {
    const atual = opcoes.autorizar || !nota ? {} : nota;
    return resultado(await completar(supabase, tiny, pedido, acesso.empresa_id, notaId, atual, dados, xml));
  }
  if (situacaoNota(dados.situacao_tiny) === "enviada") {
    dados.mensagem = "A SEFAZ ainda está processando. Clique em Atualizar em alguns instantes.";
  }
  await gravar(supabase, pedido, dados);
  return resultado(dados);
}

export async function cancelarNota(supabase: SupabaseClient, pedido: string, justificativa: string): Promise<ResultadoNota> {
  const motivo = justificativa.trim().replace(/\s+/g, " ");
  if (motivo.length < 15 || motivo.length > 255) throw new Error("A justificativa do cancelamento precisa ter de 15 a 255 letras.");
  const { acesso, nota, tiny } = await abrir(supabase, pedido);
  if (!nota || nota.situacao !== "autorizada") throw new Error("Só uma nota autorizada pode ser cancelada.");

  let r: Bruto | null;
  try {
    r = await tiny.json("POST", `/notas/${nota.tiny_id}/cancelar`, {
      justificativa: motivo,
      estornarContas: true,
      estornarEstoque: true,
      cancelarVenda: false,
    });
  } catch (e) {
    if (!(e instanceof ErroTiny) || ![400, 409, 422].includes(e.status)) throw e;
    // 409 = já cancelada na SEFAZ: segue para trazer a situação.
    if (e.status !== 409) {
      await gravar(supabase, pedido, { tiny_id: nota.tiny_id, situacao_tiny: 6, mensagem: `Cancelamento recusado: ${e.message}` });
      return { situacao: "autorizada", numero: nota.numero, mensagem: `Cancelamento recusado: ${e.message}` };
    }
    r = { situacao: 3 };
  }
  const situacao = situacaoNota(r?.situacao) ?? "autorizada";
  const dados: Bruto = { tiny_id: nota.tiny_id, situacao_tiny: Number(r?.situacao) || 6 };
  if (situacao !== "cancelada") {
    dados.mensagem = `Cancelamento não aceito pela SEFAZ: ${texto(r?.motivo) ?? "sem motivo informado"}${r?.cStat ? ` (código ${r.cStat})` : ""}`;
  } else {
    dados.justificativa_cancelamento = motivo;
    try {
      const xml = texto((await tiny.json("GET", `/notas/${nota.tiny_id}/xml`))?.xmlCancelamento);
      if (xml) dados.xml_cancelamento_arquivo = await guardar(supabase, `${acesso.empresa_id}/${nota.id}-cancelamento.xml`, xml, "application/xml");
    } catch {
      // O XML do cancelamento continua no Tiny.
    }
  }
  await gravar(supabase, pedido, dados);
  return { situacao, numero: nota.numero, mensagem: texto(dados.mensagem) };
}
