# Venner Gestão

Sistema de gestão do Grupo Venner: produção e PCP, estoque unificado, compras e financeiro por CNPJ, visão consolidada, RH e indicadores rastreáveis.

O plano completo de arquitetura está no documento do projeto (mapa lógico, módulos, integrações e fases).

## Como o sistema é montado

| Parte | Onde fica |
| --- | --- |
| Telas | `src/` (Next.js + React + Tailwind) |
| Mapa de telas e menu | `src/lib/menu.ts` |
| Banco de dados | `supabase/migrations/` (Postgres no Supabase) |
| Regras de acesso | Dentro do banco (Row Level Security), na mesma migração das tabelas |
| Testes do banco | `supabase/tests/` (rodam sozinhos em todo Pull Request) |

## Como uma alteração chega ao sistema

1. Toda mudança é feita num ramo separado e vira um Pull Request, com a descrição do que muda e o SQL completo.
2. O GitHub roda as verificações (telas e banco). Elas precisam ficar verdes.
3. Quem aprova revisa e clica em **Merge**. Nada entra no ramo `main` sem isso.
4. Depois do merge, o fluxo **Publicar banco** aplica as migrações no Supabase de produção.

## Conexões (fazer uma vez)

### Segredos para publicar o banco (dono da conta do GitHub)

Gerar no Supabase da Venner, logado na conta da Venner:

1. **Token:** Supabase → ícone da conta → Account preferences → Access Tokens → Generate new token, nome `github-venner`.
2. **ID do projeto:** Project Settings → General → Project ID.
3. **Senha do banco:** a senha definida ao criar o projeto.

Cadastrar no GitHub: repositório → Settings → Secrets and variables → Actions → New repository secret:

| Nome | Valor |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | o token |
| `SUPABASE_PROJECT_ID` | o ID do projeto |
| `SUPABASE_DB_PASSWORD` | a senha do banco |

Nunca envie esses valores por conversa ou e-mail.

### Colocar o sistema no ar (GitHub Pages, gratuito)

As telas são um site estático publicado pelo GitHub Pages; os dados, o login e as integrações ficam no Supabase. O workflow `publicar-telas.yml` gera e publica o site a cada merge, usando os mesmos segredos da publicação do banco (não precisa cadastrar nada novo).

Feito uma vez, na conta dona do repositório:

1. **Settings → General → Danger Zone → Change visibility → Make public.** O GitHub Pages gratuito exige repositório público. O código não tem senhas nem dados: os dados ficam no Supabase, protegidos pelo login e pelas regras de acesso do banco.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Actions → Publicar telas → Run workflow** (ou o próximo merge). O endereço fica `https://<conta>.github.io/VENNER-GESTAO/`.
4. No Supabase, **Authentication → URL Configuration**: em **Site URL**, colar esse endereço; em **Redirect URLs**, adicionar `https://<conta>.github.io/VENNER-GESTAO/**` (links de recuperar senha).

### Integrações (Edge Functions do Supabase)

As funções em `supabase/functions` são publicadas pelo `publicar-banco.yml`. As chaves dos aplicativos ficam no Supabase, em **Edge Functions → Secrets**: `ML_APP_ID`, `ML_SECRET_KEY` (Mercado Livre), `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` (Shopee). O endereço de retorno para cadastrar em cada aplicativo (Tiny, Mercado Livre, Shopee) aparece na tela **Configurações → Integrações**.

### Primeiro acesso da diretoria

1. Supabase → Authentication → Users → Add user, com o e-mail e uma senha.
2. No SQL Editor, liberar o usuário como Diretoria:

```sql
update public.usuarios
set ativo = true,
    perfil_id = (select id from public.perfis where nome = 'Diretoria')
where email = 'email@da-diretoria';
```

Os demais usuários: o login é criado no Supabase (Authentication → Users → Add user) e liberado na tela Configurações → Usuários, com perfil e CNPJs.

## Rodar no computador (desenvolvimento)

```bash
cp .env.example .env.local   # preencher com URL e chave pública do Supabase
npm install
npm run dev
```

Sem o `.env.local`, as telas abrem em modo de demonstração, sem login.
