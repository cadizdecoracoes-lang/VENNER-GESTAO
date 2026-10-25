// Robô do Tiny: chamado pelo próprio banco a cada 5 minutos (pg_cron + pg_net)
// com a chave que ele gerou para a conta. Sem login: quem confere a chave é o banco.
// Com {"registrar": true}, aponta o agendamento para esta função (feito pela
// publicação no GitHub depois de cada deploy).
import { lerTiny } from "../_shared/tiny/robo.ts";
import { clientePublico, clienteServico, json, mensagem, SUPABASE_URL } from "../_shared/supabase.ts";

Deno.serve(async (pedido) => {
  if (pedido.method !== "POST") return json({ erro: "Use POST" }, 405);
  const corpo = await pedido.json().catch(() => ({}));

  if (corpo?.registrar === true) {
    // O endereço é o do próprio projeto, nunca o que veio no pedido.
    const { data, error } = await clienteServico().rpc("registrar_endereco_robo", { endereco: SUPABASE_URL });
    return error ? json({ erro: error.message }, 500) : json({ contas: data });
  }

  const chave = pedido.headers.get("x-chave-robo") ?? "";
  const integracao = String(corpo?.integracao ?? "");
  if (!/^[0-9a-f-]{36}$/.test(integracao) || chave.length < 32) return json({ erro: "Pedido inválido" }, 400);
  try {
    return json(await lerTiny(clientePublico(), integracao, chave));
  } catch (e) {
    const texto = mensagem(e);
    return json({ erro: texto }, /não confere/.test(texto) ? 403 : 500);
  }
});
