// Ações das telas com o Tiny, o Mercado Livre e a Shopee que precisam das
// chaves dos aplicativos (segredos desta função) ou falam com as plataformas.
// Cada chamada usa o login de quem clicou: o banco confere o perfil.
// Corpo: { acao: "situacao" | "conectar" | "concluir" | "sincronizar" | "ler_tiny"
//   | "emitir_nf" | "atualizar_nf" | "cancelar_nf", ... }.
import type { SupabaseClient } from "@supabase/supabase-js";
import { aleatorio, CANAIS, type CanalLigacao, desafioPkce, enderecoRetorno } from "../_shared/plataformas/ligacao.ts";
import { chavesML, mlConfigurado, type Tokens, trocarCodigoML, urlAutorizacaoML } from "../_shared/plataformas/mercado-livre.ts";
import { shopeeConfigurado, trocarCodigoShopee, urlAutorizacaoShopee } from "../_shared/plataformas/shopee.ts";
import { sincronizarConta } from "../_shared/plataformas/sincronizar.ts";
import { trocarCodigoTiny, urlAutorizacaoTiny } from "../_shared/tiny/api.ts";
import { cancelarNota, emitirNota } from "../_shared/tiny/notas.ts";
import { lerTiny } from "../_shared/tiny/robo.ts";
import { clienteDoPedido, CORS, json, mensagem, SUPABASE_URL } from "../_shared/supabase.ts";

type Corpo = Record<string, unknown>;
const UUID = /^[0-9a-f-]{36}$/;

// Erros esperados voltam com status 200 e { erro }, para a tela mostrar o texto.
class Recusa extends Error {}

async function credenciaisTiny(supabase: SupabaseClient, empresa: string) {
  const { data, error } = await supabase.rpc("credenciais_tiny", { empresa });
  if (error) throw new Recusa(error.message);
  const app = (data as { client_id: string; client_secret: string }[] | null)?.[0];
  if (!app) throw new Recusa("Cole antes as chaves do aplicativo do Tiny desta empresa.");
  return app;
}

function canalValido(v: unknown): CanalLigacao {
  if (!(CANAIS as readonly unknown[]).includes(v)) throw new Recusa("Plataforma desconhecida.");
  return v as CanalLigacao;
}

const acoes: Record<string, (supabase: SupabaseClient, corpo: Corpo) => Promise<unknown>> = {
  // Quais plataformas já têm as chaves do aplicativo e os endereços para cadastrar nelas.
  async situacao() {
    return {
      mercado_livre: mlConfigurado(),
      shopee: shopeeConfigurado(),
      retorno: Object.fromEntries(CANAIS.map((c) => [c, enderecoRetorno(SUPABASE_URL, c)])),
    };
  },

  // Clique em "Ligar conta": devolve o endereço de autorização da plataforma.
  async conectar(supabase, corpo) {
    const canal = canalValido(corpo.canal);
    const empresa = String(corpo.empresa ?? "");
    if (!UUID.test(empresa)) throw new Recusa("Escolha a empresa dona da conta.");
    if (canal === "mercado_livre" && !mlConfigurado()) throw new Recusa("O Mercado Livre ainda não tem as chaves do aplicativo no Supabase.");
    if (canal === "shopee" && !shopeeConfigurado()) throw new Recusa("A Shopee ainda não tem as chaves do aplicativo no Supabase.");
    const app = canal === "tiny" ? await credenciaisTiny(supabase, empresa) : null;

    const estado = aleatorio();
    const verificador = aleatorio();
    const { error } = await supabase.rpc("iniciar_ligacao", { canal, empresa, voltar: String(corpo.voltar ?? ""), estado, verificador });
    if (error) throw new Recusa(error.message);

    const retorno = enderecoRetorno(SUPABASE_URL, canal);
    if (canal === "tiny") return { url: urlAutorizacaoTiny(app!.client_id, retorno, estado) };
    if (canal === "mercado_livre") return { url: urlAutorizacaoML(chavesML().appId, retorno, estado, await desafioPkce(verificador)) };
    return { url: await urlAutorizacaoShopee(`${retorno}?${new URLSearchParams({ state: estado })}`) };
  },

  // Volta da plataforma: troca o código pelo acesso e grava a conta.
  async concluir(supabase, corpo) {
    const canal = canalValido(corpo.canal);
    if (corpo.error) throw new Recusa(`A plataforma não autorizou a ligação (${String(corpo.error_description ?? corpo.error)}).`);
    const codigo = String(corpo.code ?? "");
    if (!codigo) throw new Recusa("A plataforma não autorizou a ligação.");
    const { data, error } = await supabase.rpc("concluir_ligacao", { estado: String(corpo.state ?? ""), canal });
    if (error) throw new Recusa(error.message);
    const ligacao = (data as { empresa_id: string; verificador: string }[] | null)?.[0];
    if (!ligacao) throw new Recusa("A autorização não confere. Clique em Ligar de novo.");

    const retorno = enderecoRetorno(SUPABASE_URL, canal);
    let tokens: Tokens;
    try {
      if (canal === "tiny") {
        const app = await credenciaisTiny(supabase, ligacao.empresa_id);
        const t = await trocarCodigoTiny(codigo, retorno, app.client_id, app.client_secret);
        tokens = { ...t, conta: "tiny", apelido: t.apelido ?? "Tiny" };
      } else if (canal === "mercado_livre") {
        tokens = await trocarCodigoML(codigo, retorno, ligacao.verificador);
      } else {
        const loja = String(corpo.shop_id ?? "");
        if (!/^\d+$/.test(loja)) throw new Recusa("A Shopee não informou a loja autorizada.");
        tokens = await trocarCodigoShopee(codigo, loja);
      }
    } catch (e) {
      throw new Recusa(mensagem(e));
    }

    const salvo = await supabase.rpc("salvar_integracao", {
      empresa: ligacao.empresa_id,
      canal_conta: canal,
      conta: tokens.conta,
      nome: tokens.apelido,
      acesso: tokens.access_token,
      renovacao: tokens.refresh_token,
      expira: tokens.expira_em,
    });
    if (salvo.error) throw new Recusa(salvo.error.message);
    if (canal === "tiny") {
      // Leitura automática: o banco passa a chamar a função robo-tiny deste projeto.
      const robo = await supabase.rpc("preparar_robo_tiny", { integracao: salvo.data, endereco_publico: SUPABASE_URL });
      if (robo.error) throw new Recusa(robo.error.message);
    }
    return { canal };
  },

  // "Buscar vendas agora" de uma conta do Mercado Livre ou da Shopee.
  async sincronizar(supabase, corpo) {
    const integracao = String(corpo.integracao ?? "");
    const desde = String(corpo.desde ?? "");
    const dias = Math.max(0, Math.min(120, Number(corpo.dias) || 0));
    if (!UUID.test(integracao)) throw new Recusa("Conta inválida.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new Recusa("Informe a data de início.");
    try {
      return await sincronizarConta(supabase, integracao, desde, dias);
    } catch (e) {
      throw new Recusa(mensagem(e) || "A plataforma não respondeu. Tente de novo em alguns minutos.");
    }
  },

  // Nota fiscal do pedido de venda pelo Tiny: emitir, trazer a situação
  // (DANFE, XML e contas) ou cancelar.
  async emitir_nf(supabase, corpo) {
    const pedido = String(corpo.pedido ?? "");
    if (!UUID.test(pedido)) throw new Recusa("Pedido inválido.");
    try {
      return await emitirNota(supabase, pedido, { autorizar: true, enviarEmail: corpo.enviar_email === true });
    } catch (e) {
      throw new Recusa(mensagem(e));
    }
  },

  async atualizar_nf(supabase, corpo) {
    const pedido = String(corpo.pedido ?? "");
    if (!UUID.test(pedido)) throw new Recusa("Pedido inválido.");
    try {
      return await emitirNota(supabase, pedido, { autorizar: false });
    } catch (e) {
      throw new Recusa(mensagem(e));
    }
  },

  async cancelar_nf(supabase, corpo) {
    const pedido = String(corpo.pedido ?? "");
    if (!UUID.test(pedido)) throw new Recusa("Pedido inválido.");
    try {
      return await cancelarNota(supabase, pedido, String(corpo.justificativa ?? ""));
    } catch (e) {
      throw new Recusa(mensagem(e));
    }
  },

  // "Ler agora" do Tiny: a mesma leitura do robô, com orçamento menor.
  async ler_tiny(supabase, corpo) {
    const integracao = String(corpo.integracao ?? "");
    if (!UUID.test(integracao)) throw new Recusa("Conta inválida.");
    const chave = await supabase.rpc("chave_robo_tiny", { integracao });
    if (chave.error) throw new Recusa(chave.error.message);
    try {
      return await lerTiny(supabase, integracao, chave.data as string, 30);
    } catch (e) {
      throw new Recusa(mensagem(e) || "O Tiny não respondeu. Tente de novo em alguns minutos.");
    }
  },
};

Deno.serve(async (pedido) => {
  if (pedido.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (pedido.method !== "POST") return json({ erro: "Use POST" }, 405);
  const corpo = (await pedido.json().catch(() => ({}))) as Corpo;
  const acao = acoes[String(corpo.acao ?? "")];
  if (!acao) return json({ erro: "Ação desconhecida" }, 400);
  try {
    return json(await acao(clienteDoPedido(pedido), corpo));
  } catch (e) {
    if (e instanceof Recusa) return json({ erro: e.message });
    console.error(e);
    return json({ erro: "Falha inesperada na integração. Tente de novo em alguns minutos." }, 500);
  }
});
