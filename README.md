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

### Colocar o sistema no ar (Cloudflare, plano gratuito)

Feito uma vez, na conta da Venner. Depois disso, cada Pull Request aprovado atualiza o sistema sozinho.

1. Criar a conta em [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) com o e-mail da Venner e confirmar o e-mail.
2. **Workers & Pages → Create → Import a repository**. Conectar o GitHub da conta dona do repositório e escolher `VENNER-GESTAO`.
3. Preencher:
   - **Project name:** `venner-gestao`
   - **Build command:** `npx opennextjs-cloudflare build`
   - **Deploy command:** `npx opennextjs-cloudflare deploy`
4. Em **Advanced settings → Build variables**, adicionar (os dois valores ficam no Supabase, em Project Settings → API Keys e Data API):

| Nome | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, `https://<id>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key, começa com `sb_publishable_` |

   Esses dois valores são públicos por natureza (o navegador usa). A proteção dos dados é o login e as regras de acesso do banco. Nunca use aqui a chave `secret`.
5. **Deploy**. Ao terminar, o Cloudflare mostra o endereço do sistema (`https://venner-gestao.<conta>.workers.dev`).
6. No Supabase, **Authentication → URL Configuration → Site URL**: colar esse endereço.

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
