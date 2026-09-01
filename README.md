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
*Contas* do `/admin`.

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
exposto. `vercel.json` fixa as funções na região `gru1`, colada ao Neon, para
cortar a latência de cada consulta.

1. **Vercel → Project Settings**: Framework Preset = **Next.js**, Build Command e
   Output padrão (não sobrescreva).
2. **Environment Variables** (Production): `DATABASE_URL` (use a URL **pooled** do
   Neon — host com `-pooler` — com `sslmode=require`, para reaproveitar conexões
   entre invocações), `APP_ORIGIN` (origem pública exata, ex.: `https://goa.vercel.app`),
   `ADMIN_PASSWORD` (mínimo 10 caracteres). Opcional: `ADMIN_USERNAME`, `ADMIN_NAME`,
   `MAX_GROUPS_PER_OWNER` / `MAX_CHALLENGES_PER_GROUP` (padrão 6),
   `MAX_MEMBERS_PER_GROUP` (padrão 62).
3. **`git push`** dispara o build e o deploy.
4. **Migração + conta de administração** (uma vez, e a cada nova migração) — rode
   contra o Neon a partir da sua máquina:

   ```bash
   set -a; . ./.env.production.local; set +a
   npm run db:setup
   ```

   `.env.production.local` (fora do Git) guarda `DATABASE_URL`/`ADMIN_PASSWORD` de
   produção; ou exporte as variáveis manualmente. Para a migração, use a URL
   **direta** do Neon (sem `-pooler`); o pooled fica só para a aplicação.

   Algumas migrações vêm com um _backfill_ pontual e idempotente. Depois da
   `0010` (acervo do grupo), rode uma vez: `node scripts/backfill-catalog.mjs`.

### Contêiner (alternativa à Vercel)

`Dockerfile` + `compose.yaml` sobem aplicação, migração/seed e um PostgreSQL local.
Em outro provedor de contêiner, defina os mesmos segredos e rode `npm run db:setup`
no deploy.

## Estrutura

```text
app/        interface, API REST (app/api), vitrine (app/results), galeria de modelos (app/modelos)
db/         schema Drizzle do PostgreSQL
drizzle/    migrações versionadas
lib/        autenticação, domínio, receitas, análise e validação
scripts/    migração e seed da conta de administração
tests/      unidade, smoke e integração
docs/       arquitetura (docs/architecture.md) e endpoints (docs/api.md)
```

## O que o Goa faz

- **Contas** — cadastro e login por usuário **ou** e-mail, sessão HTTP-only + CSRF;
  redefinição de senha por link de uso único (hoje mediada pelo `/admin`). O
  e-mail é opcional mas é o que recupera o acesso.
- **Grupos e papéis** — o grupo é duradouro e reúne pessoas entre rodadas. `owner`
  > `admin` > `participant`. Convites por link expirável / código curto.
- **Rodadas por receita** — `cine_free`, `cine_curated` (expectativa + avaliação;
  a expectativa trava ao avaliar), `reading_club` (livros no acervo, progresso por
  dia + conclusão + nota) e `reading_daily` (check-in diário). Estados
  `draft → active → closed`; período opcional; campos semânticos estáveis.
- **Acervo** — filme/livro tem identidade estável no grupo (`catalog_items`), com
  atributos e gêneros; reaparece em outra rodada sem perder o histórico.
- **Registros** — cada pessoa edita o próprio; owner/admin corrigem com motivo
  (auditado). Um registro aponta item + dia + checkpoint conforme a receita.
- **Análise** — `group_by` calculado: ranking com nota ajustada (bayesiana, com
  mínimo de amostra), polarização (desvio), surpresa × decepção (avaliação −
  expectativa), viés do indicador. As receitas já semeiam as métricas certas.
- **Vitrine** — ao encerrar, o Goa gera a história (hero, KPIs, ranking, perfis,
  melhores comentários) e congela um snapshot; owner/admin ajustam manchete/
  resumo, regeneram e publicam em `/results/<token>` (o banco guarda só o hash).
- **`/admin`** — painel só de metadados para a conta `platform_admin`: uso,
  tamanho do banco, lixeira (purga definitiva), auditoria, moderação de contas.
  Qualquer outra conta recebe `404`.

Ver [docs/architecture.md](docs/architecture.md) para o modelo de domínio, a
segurança e as decisões; [docs/api.md](docs/api.md) para os endpoints.

## Para onde vai

[ROADMAP.md](ROADMAP.md) — o que já entrou e o que vem a seguir (afinidade entre
pessoas, cortes por gênero/década, automação).

## Licença

[Functional Source License 1.1](LICENSE.md) com licença futura Apache 2.0
(`FSL-1.1-ALv2`): uso livre para qualquer fim que não seja oferecer um produto ou
serviço concorrente; cada versão passa a Apache 2.0 dois anos depois de publicada.
