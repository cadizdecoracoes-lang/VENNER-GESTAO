// Adaptador que roda o Next.js no Cloudflare Workers (plano gratuito).
// Sem cache incremental em R2: as telas são todas dinâmicas e o R2 exigiria
// ativar cobrança na conta.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
