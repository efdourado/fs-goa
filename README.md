# Goa

Plataforma web para desafios privados e personalizáveis. O participante registra;
o sistema organiza e calcula; o administrador revisa e transforma o resultado em
memória do grupo.

Next.js 16 (App Router) + React 19 + TypeScript, API REST no mesmo runtime e
PostgreSQL como fonte de verdade. O MVP está completo e verificado por testes
automatizados.

## Rodar localmente

Pré-requisito: Docker com o plugin `docker compose`.

```bash
docker compose up --build
```

Abra [http://localhost:3000](http://localhost:3000). O Compose sobe o PostgreSQL,
aplica as migrações, cria a conta de administração e inicia a aplicação.

Encerrar sem apagar dados: `docker compose down`.

## Conta de administração

Os papéis do produto (`owner` > `admin` > `participant`) valem por grupo, e quem
cria um grupo vira `owner` dele. Além disso, a conta criada pelo `db:seed` recebe
`platform_admin` e enxerga `/admin` — um painel privado do desenvolvedor com uso,
armazenamento, lixeira do banco (purga definitiva), auditoria e moderação de
contas. Nenhuma outra conta vê essa área (respostas `404`).

| Ambiente   | Usuário | Senha                                    |
| ---------- | ------- | ---------------------------------------- |
| Local      | `admin` | `goa-admin-local` (definida no compose)  |
| Produção   | `admin` | valor do segredo `ADMIN_PASSWORD`        |

Depois de entrar, use a interface para criar um grupo e convidar as demais pessoas.
Rode `npm run db:seed` de novo a qualquer momento para redefinir a senha.

As contas fazem login por **nome de usuário ou e-mail** + senha. O e-mail é
opcional no cadastro, mas é o que permite recuperar o acesso: quem esquece a senha
pede em "Esqueci a senha" e o administrador gera um link de uso único na aba
*Contas* do `/admin`. Ver [docs/product.md](docs/product.md) para o funcionamento
completo e [docs/api.md](docs/api.md) para a lista de endpoints.

## Desenvolvimento sem Docker

Node.js `22.20.0` (ver `.nvmrc`).

```bash
cp .env.example .env.local          # ajuste DATABASE_URL / ADMIN_PASSWORD
docker compose up -d postgres       # ou aponte para outro PostgreSQL
npm ci
npm run db:setup                    # migração + conta de administração
npm run dev
```

Verificações:

```bash
npm run lint
npm run typecheck
npm test                            # unidade + build + smoke
DATABASE_URL=postgresql://goa:goa_local_only@127.0.0.1:5433/goa_test \
  npm run db:migrate && npm run test:integration
```

O teste de integração se recusa a limpar qualquer banco que não se chame `goa_test`.

## Produção (Vercel + Neon)

O banco de produção é o PostgreSQL do Neon (`sa-east-1`); nenhum banco local é
exposto.

1. **Vercel → Project Settings**: Framework Preset = **Next.js**, Build Command e
   Output padrão (não sobrescreva).
2. **Environment Variables** (Production): `DATABASE_URL` (URL do Neon com
   `sslmode=require`), `APP_ORIGIN` (origem pública exata, ex.: `https://goa.vercel.app`),
   `ADMIN_PASSWORD` (mínimo 10 caracteres). Opcional: `ADMIN_USERNAME`, `ADMIN_NAME`,
   `MAX_GROUPS_PER_OWNER` / `MAX_CHALLENGES_PER_GROUP` (padrão 6).
3. **`git push`** dispara o build e o deploy.
4. **Migração + conta de administração** (uma vez, e a cada nova migração) — rode
   contra o Neon a partir da sua máquina:

   ```bash
   set -a; . ./.env.production.local; set +a
   npm run db:setup
   ```

   `.env.production.local` (fora do Git) guarda `DATABASE_URL`/`ADMIN_PASSWORD` de
   produção; ou exporte as variáveis manualmente.

### Contêiner (alternativa à Vercel)

`Dockerfile` + `compose.yaml` sobem aplicação, migração/seed e um PostgreSQL local.
Em outro provedor de contêiner, defina os mesmos segredos e rode `npm run db:setup`
no deploy.

## Estrutura

```text
app/        interface, API REST (app/api) e vitrine pública (app/results)
db/         schema Drizzle do PostgreSQL
drizzle/    migrações versionadas
lib/        autenticação, domínio, validação e métricas
scripts/    migração e seed da conta de administração
tests/      unidade, smoke e integração
compose.yaml   PostgreSQL + setup + aplicação
docs/       arquitetura, produto (docs/product.md) e endpoints (docs/api.md)
```

## O que o MVP entrega

Cadastro e login por usuário ou e-mail com sessão HTTP-only e CSRF, mais
redefinição de senha por link de uso único; grupos privados com papéis e convites
expiráveis; desafios em `draft`/`active`/`closed`; presets
**Cine** e **90 dias de leitura**; campos de texto, número, nota, opção, booleano e
data; itens e checkpoints diários; registros persistentes com edição autorizada e
histórico; revisão administrativa, auditoria append-only e exportação CSV segura;
soma, média, contagem, mínimo, máximo e taxa de conclusão; curadoria e página
pública de resultados por token rotacionável; duplicação exclusivamente estrutural.

Ver [docs/architecture.md](docs/architecture.md) para o modelo de domínio, o
desenho de segurança e as decisões, e a lista do que ficou fora do MVP.
