// Acesso à API v3 do Tiny (Olist ERP): autorização da conta (OAuth) e
// leituras com orçamento de chamadas. O Tiny permite 60 leituras por minuto
// por conta, e o robô roda a cada 5 minutos.

const API = "https://api.tiny.com.br/public-api/v3";
const CONTAS = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect";

export type TokensTiny = { access_token: string; refresh_token: string | null; expira_em: string; apelido: string | null };

export function urlAutorizacaoTiny(clientId: string, retorno: string, estado: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: retorno, scope: "openid", response_type: "code", state: estado });
  return `${CONTAS}/auth?${q}`;
}

// Nome de quem autorizou, lido do próprio token (só para exibir).
function apelidoDoToken(token: string): string | null {
  try {
    const parte = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const dados = JSON.parse(atob(parte.padEnd(Math.ceil(parte.length / 4) * 4, "=")));
    return dados.preferred_username ?? dados.email ?? dados.name ?? null;
  } catch {
    return null;
  }
}

async function pedirToken(corpo: Record<string, string>): Promise<TokensTiny> {
  const r = await fetch(`${CONTAS}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    const motivo = d.error_description ?? d.error ?? r.status;
    throw new Error(`O Tiny recusou a autorização (${motivo}). Confira as chaves do aplicativo e ligue de novo.`);
  }
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? null,
    expira_em: new Date(Date.now() + Number(d.expires_in ?? 14400) * 1000).toISOString(),
    apelido: apelidoDoToken(d.access_token),
  };
}

export const trocarCodigoTiny = (codigo: string, retorno: string, clientId: string, segredo: string) =>
  pedirToken({ grant_type: "authorization_code", client_id: clientId, client_secret: segredo, code: codigo, redirect_uri: retorno });

export const renovarTiny = (renovacao: string, clientId: string, segredo: string) =>
  pedirToken({ grant_type: "refresh_token", client_id: clientId, client_secret: segredo, refresh_token: renovacao });

// Acabou o orçamento desta leitura (continua na próxima).
export class SemOrcamento extends Error {}

// Recusa do Tiny ou da SEFAZ numa gravação, com o texto para a tela.
export class ErroTiny extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

// Junta a mensagem geral e as dos campos de uma resposta de erro do Tiny
// ({ mensagem, detalhes: [{ campo, mensagem }] }), sem repetir.
export function textoErroTiny(corpo: unknown, padrao: string): string {
  const d = (corpo && typeof corpo === "object" ? corpo : {}) as { mensagem?: unknown; detalhes?: unknown };
  const partes: string[] = [];
  if (typeof d.mensagem === "string" && d.mensagem.trim()) partes.push(d.mensagem.trim());
  for (const x of Array.isArray(d.detalhes) ? d.detalhes : []) {
    const m = typeof x?.mensagem === "string" ? x.mensagem.trim() : "";
    if (!m) continue;
    const campo = typeof x?.campo === "string" && x.campo.trim() ? `${x.campo.trim()}: ` : "";
    if (!partes.some((p) => p.includes(m))) partes.push(campo + m);
  }
  return partes.length ? partes.join(" · ") : padrao;
}

// Gravações no Tiny (gerar e autorizar nota, lançar contas, cancelar) e
// download de arquivos. Só para as ações das telas, uma de cada vez.
export class GravacaoTiny {
  private token: string;
  constructor(token: string) {
    this.token = token;
  }

  private async pedir(metodo: string, caminho: string, corpo?: unknown, aceita = "application/json"): Promise<Response> {
    let r: Response;
    try {
      r = await fetch(`${API}${caminho}`, {
        method: metodo,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: aceita,
          ...(corpo === undefined ? {} : { "content-type": "application/json" }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      throw new ErroTiny(0, "O Tiny não respondeu (sem conexão). Tente de novo em alguns minutos.");
    }
    if (r.ok) return r;
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) throw new ErroTiny(401, "O Tiny recusou o acesso. Ligue a conta de novo em Configurações › Integrações.");
    if (r.status === 403)
      throw new ErroTiny(
        403,
        textoErroTiny(d, "") ||
          `O aplicativo do Tiny não tem permissão para ${caminho.split("/")[1]}. Libere no aplicativo "Venner Gestão" do Tiny e clique em Ligar de novo em Configurações › Integrações.`,
      );
    if (r.status === 429) throw new ErroTiny(429, "O Tiny pediu para esperar (muitas chamadas por minuto). Tente de novo em um minuto.");
    if (r.status === 502 || r.status === 503) throw new ErroTiny(r.status, textoErroTiny(d, "A SEFAZ ou o Tiny não responderam. Tente de novo em alguns minutos."));
    throw new ErroTiny(r.status, textoErroTiny(d, `O Tiny respondeu ${r.status} em ${caminho}.`));
  }

  // null quando a resposta não tem corpo (204).
  async json<T = Record<string, unknown>>(metodo: string, caminho: string, corpo?: unknown): Promise<T | null> {
    const r = await this.pedir(metodo, caminho, corpo);
    const texto = await r.text();
    if (!texto.trim()) return null;
    try {
      return JSON.parse(texto) as T;
    } catch {
      return null;
    }
  }

  async arquivo(caminho: string, tipo: string): Promise<Uint8Array> {
    const r = await this.pedir("GET", caminho, undefined, tipo);
    return new Uint8Array(await r.arrayBuffer());
  }
}

export class ApiTiny {
  usadas = 0;
  private token: string;
  private limite: number;
  constructor(token: string, limite: number) {
    this.token = token;
    this.limite = limite;
  }

  restantes() {
    return this.limite - this.usadas;
  }

  // null = não existe (404).
  async ler<T = unknown>(caminho: string, filtros: Record<string, string | number | undefined> = {}): Promise<T | null> {
    if (this.usadas >= this.limite) throw new SemOrcamento();
    this.usadas++;
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== "") q.set(k, String(v));
    let r: Response;
    try {
      r = await fetch(`${API}${caminho}${q.size ? `?${q}` : ""}`, {
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
      });
    } catch {
      throw new Error("O Tiny não respondeu (sem conexão). A próxima leitura tenta de novo.");
    }
    // Perto do limite por minuto do Tiny: para por aqui e segue na próxima leitura.
    const sobra = Number(r.headers.get("x-ratelimit-remaining") ?? "99");
    if (sobra <= 2) this.limite = this.usadas;
    if (r.status === 404) return null;
    if (r.status === 429) {
      this.limite = this.usadas;
      throw new SemOrcamento();
    }
    if (r.status === 401) throw new Error("O Tiny recusou o acesso. Ligue a conta de novo em Configurações › Integrações.");
    if (r.status === 403) throw new Error(`O aplicativo do Tiny não tem permissão de leitura em ${caminho.split("/")[1]}.`);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(`Tiny respondeu ${r.status} em ${caminho}: ${d.mensagem ?? r.statusText}`);
    }
    return (await r.json()) as T;
  }
}
