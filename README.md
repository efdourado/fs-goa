# Goa

Plataforma web para desafios privados e personalizáveis. O participante registra;
o sistema organiza e calcula; o administrador revisa e transforma o resultado em
memória do grupo.

React 19 + TypeScript sobre Vinext/Vite, API REST no mesmo runtime e PostgreSQL
como fonte de verdade. O MVP está completo e verificado por testes automatizados.

## Rodar localmente

Pré-requisito: Docker com o plugin `docker compose`.

```bash
docker compose up --build
```

Abra [http://localhost:3000](http://localhost:3000). O Compose sobe o PostgreSQL,
aplica as migrações, cria a conta de administração e inicia a aplicação.

Encerrar sem apagar dados: `docker compose down`.

## Conta de administração

O Goa não tem "superadmin" global: os papéis (`owner` > `admin` > `participant`)
valem por grupo, e quem cria um grupo vira `owner` dele. O `db:seed` cria/atualiza
uma conta comum para o primeiro acesso.

| Ambiente   | Usuário | Senha                                    |
| ---------- | ------- | ---------------------------------------- |
| Local      | `admin` | `goa-admin-local` (definida no compose)  |
| Produção   | `admin` | valor do segredo `ADMIN_PASSWORD`        |

Depois de entrar, use a interface para criar um grupo e convidar as demais pessoas.
Rode `npm run db:seed` de novo a qualquer momento para redefinir a senha.

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

## Produção

Precisa apenas de um PostgreSQL acessível e dos segredos do runtime — nenhum banco
local é exposto.

1. Configure os segredos: `DATABASE_URL`, `APP_ORIGIN` (origem pública exata),
   `ADMIN_PASSWORD` (mínimo 10 caracteres).
2. Build e deploy da imagem (`Dockerfile`) no seu provedor de contêiner.
3. A cada deploy, rode `npm run db:setup` para aplicar migrações e garantir a conta
   de administração.

O deploy atual usa o PostgreSQL do Neon (`sa-east-1`). A `DATABASE_URL` completa
vive só nos segredos do provedor e no `.env.local` (fora do Git).

## Estrutura

```text
app/        interface, API REST (app/api) e vitrine pública (app/results)
db/         schema Drizzle do PostgreSQL
drizzle/    migrações versionadas
lib/        autenticação, domínio, validação e métricas
scripts/    migração e seed da conta de administração
tests/      unidade, smoke e integração
compose.yaml   PostgreSQL + setup + aplicação
docs/       arquitetura e decisões
```

## O que o MVP entrega

Cadastro e login por usuário com sessão HTTP-only e CSRF; grupos privados com
papéis e convites expiráveis; desafios em `draft`/`active`/`closed`; presets
**Cine** e **90 dias de leitura**; campos de texto, número, nota, opção, booleano e
data; itens e checkpoints diários; registros persistentes com edição autorizada e
histórico; revisão administrativa, auditoria append-only e exportação CSV segura;
soma, média, contagem, mínimo, máximo e taxa de conclusão; curadoria e página
pública de resultados por token rotacionável; duplicação exclusivamente estrutural.

Ver [docs/architecture.md](docs/architecture.md) para o modelo de domínio, o
desenho de segurança e as decisões, e a lista do que ficou fora do MVP.
