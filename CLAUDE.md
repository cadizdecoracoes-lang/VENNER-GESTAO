# Venner Gestão

Sistema de gestão do Grupo Venner (produção, estoque, compras, vendas, financeiro por CNPJ, RH). Next.js 16 + React 19 + Tailwind 4 nas telas, Supabase (Postgres com Row Level Security) no banco, hospedado no Cloudflare Workers via `@opennextjs/cloudflare`.

## Quem usa e como falar

- Tudo em português do Brasil: telas, mensagens de erro, comentários, nomes de tabelas, funções e commits.
- O Alexandre não é técnico. Explique em passos simples, clique a clique, e chame Pull Request de "pacote".

## Regras de entrega

- Nunca faça push direto na `main`. Toda mudança vai num ramo próprio e vira um pacote (PR). O Alexandre faz o merge quando as verificações estão verdes.
- O merge na `main` publica sozinho: o workflow `publicar-banco.yml` aplica as migrações no Supabase de produção e o Cloudflare publica as telas. Não rode deploy nem `supabase db push` à mão.
- Nunca leia, copie nem peça por chat valores de `.env*`, `.dev.vars` ou segredos (Supabase, Tiny, Mercado Livre, Shopee).
- A integração com Tiny, Mercado Livre e Shopee é só leitura. Não crie nada que escreva nessas plataformas sem pedido explícito.

## Comandos

| O que | Comando |
| --- | --- |
| Tipos | `npm run typecheck` |
| Testes das regras de cálculo (`tests/*.test.ts`) | `npm test` |
| Migrações + testes do banco num Postgres temporário | `npm run test:banco` |
| Build das telas | `npm run build` |
| Build para o Cloudflare | `npm run cf:build` |

O GitHub (`.github/workflows/ci.yml`) roda tudo isso em cada pacote. Rode `typecheck`, `npm test` e `test:banco` antes de entregar.

## Onde fica cada coisa

- `src/app/(sistema)/<modulo>/...`: telas, uma pasta por módulo (vendas, financeiro, estoque, producao, compras, rh, config).
- `src/lib/menu.ts`: mapa de telas. O `codigo` de cada tela (ex.: `financeiro.receber`) é o mesmo da tabela `telas` e das permissões por perfil no banco.
- `src/lib/`: regras puras (planejamento, parcelas, nfe, formato) e clientes do Supabase em `src/lib/supabase/`.
- `src/lib/tiny`, `src/lib/plataformas`: leitura do Tiny e de Mercado Livre/Shopee. `src/app/integracoes/robo` é chamado pelo próprio banco (pg_cron + pg_net) a cada 5 minutos.
- `supabase/migrations/`: uma migração por pacote, nome `AAAAMMDD0000NN_assunto.sql`, com cabeçalho explicando o que muda.
- `supabase/tests/`: testes SQL numerados (`00_stub_supabase.sql` simula o Supabase; os demais rodam em ordem depois das migrações).

## Banco de dados

- Nunca edite uma migração que já está na `main` (já foi aplicada em produção). Crie uma nova.
- Toda tabela nova: `enable row level security` e políticas usando `tem_permissao('<codigo.tela>', 'ver'|'criar'|'editar'|...)` e `pode_ver_empresa(empresa_id)`, na mesma migração.
- O Supabase da Venner não dá GRANT automático ao papel `authenticated`: conceda explicitamente o que as telas precisam. Dados sensíveis (chaves de integração) ficam em tabelas sem acesso direto, lidas só por funções `security definer` que conferem o perfil.
- Cada migração nova ganha um arquivo de teste em `supabase/tests/`, no estilo dos existentes (`pg_temp.esperar` / `pg_temp.esperar_erro`, trocando de usuário com `set request.jwt.claim.sub`).
- O CI usa Postgres 17; `npm run test:banco` usa o Postgres instalado na máquina.

## Telas

- Sem `.env.local`, as telas abrem em modo de demonstração, sem login.
- Valores e datas no formato brasileiro (helpers em `src/lib/formato.ts` e `src/lib/datas.ts`).
- Cada empresa (CNPJ) é separada; a empresa escolhida fica em cookie (`src/lib/empresa-cookie.ts`).

## Visual das telas (regra para toda tela nova ou revisada)

O destaque é dos lançamentos. O que fica acima da lista tem de ser fino e discreto; a lista deve aparecer já na primeira tela, sem rolar.

- Cabeçalho numa linha só: `CabecalhoTela` (módulo / título, botões à direita). Não escreva subtítulo nem parágrafo explicativo: a descrição da tela aparece ao passar o mouse no título e textos longos vão em `ajuda` (ícone ⓘ).
- Telas separadas por CNPJ passam `empresa={selecionada}` ao `CabecalhoTela`, que mostra a etiqueta pequena "Grupo (consolidado)" ou o nome da empresa. Não use faixa colorida de aviso.
- Números de resumo numa faixa fina, nunca em cartões altos. Em listas com situação (pagar, receber, pedidos), use `Filtro` com `situacoes`: a mesma faixa mostra valor e quantidade e filtra a lista ao clicar. Fora disso, `Indicador` (compacto; a origem do número vai em `fonte`, que vira dica).
- Período (`FiltroPeriodo`) vai na linha da busca, pelo `ferramentas` do `Filtro`; as datas livres ficam recolhidas em "Outras datas…".
- Quadros secundários (ex.: `ResumoPorEmpresa`) ficam recolhidos numa linha.
- Linhas de tabela de uma linha só sempre que der (complementos em texto pequeno na mesma linha, não embaixo). Use `Tabela`, `Celula`, `Cartao`, `estiloCampo`, `estiloBotao` de `src/components/ui.tsx`, que já têm os espaçamentos enxutos; não reponha `p-5`, `p-6`, `space-y-6`, `text-2xl` ou `rounded-2xl` nas telas.
- Formulários: o "Cancelar" vai ao lado do "Salvar" (`FormAcao` com `extra`).
