// Acesso à API v3 do Tiny (Olist ERP): autorização da conta (OAuth) e
// leituras com orçamento de chamadas. O Cloudflare gratuito permite 50
// chamadas externas por acesso e o Tiny, 60 leituras por minuto por conta.

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
