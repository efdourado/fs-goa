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
armazenamento, auditoria (sem textos privados) e moderação de contas. Nenhuma
outra conta vê essa área (respostas `404`). O `platform_admin` **não** tem lixeira
global, não exclui conteúdo de terceiros e não redefine a senha de ninguém:
a lixeira é sempre do dono do conteúdo.

| Ambiente   | Usuário | Senha                                    |
| ---------- | ------- | ---------------------------------------- |
| Local      | `admin` | `goa-admin-local` (definida no compose)  |
| Produção   | `admin` | valor do segredo `ADMIN_PASSWORD`        |

Depois de entrar, use a interface para criar um grupo e convidar as demais pessoas.
Rode `npm run db:seed` de novo a qualquer momento para redefinir a senha.

As contas fazem login por **nome de usuário ou e-mail** + senha.

### Recuperação de senha

**Fora do ar por enquanto.** A redefinição por link precisa de um canal de
e-mail para entregar o link, e conectar um provedor de e-mail está fora do
escopo da V1 (`ROADMAP.md` §1). Então todo o fluxo visível — a tela "Esqueci a
senha", as rotas `/api/auth/forgot` e `/api/auth/reset`, o indicador de pedido
pendente no `/admin` e o script de operador — foi retirado. O cadastro continua
aceitando e-mail opcional (usado só para login), com o aviso "as opções de
redefinição de senha chegam em breve".

Quem já está logado troca a senha normalmente em **Configurações** (exige a
senha atual). A tabela `password_reset_tokens` segue no banco, dormente, para
religar o fluxo como mudança só de código quando houver e-mail.

## Desenvolvimento sem Docker

Node.js `22.20.0` (ver `.nvmrc`). PostgreSQL local (o `postgres` do compose serve).

**Primeira vez:**

```bash
cp .env.example .env.local          # ajuste DATABASE_URL / ADMIN_PASSWORD uma vez
docker compose up -d postgres
npm ci
npm run db:setup                    # migração + conta de administração
npm run dev
```

**No dia a dia** (o `.env.local` já existe):

```bash
docker compose up -d postgres
npm run dev
```

## Comandos

```bash
# migração — local
npm run db:migrate

# migração — produção (Neon), da sua máquina
node --env-file=.env.production.local scripts/migrate.mjs

# migração + conta de administração de uma vez
npm run db:setup                                        # local
node --env-file=.env.production.local scripts/seed-admin.mjs   # depois do migrate, em prod

# dados de demonstração (grupo sintético, desafios preenchidos e encerrados)
npm run db:seed-demo -- --scenario=cinema --dry-run       # local: valida contas/ambiente, não grava
npm run db:seed-demo -- --scenario=cinema                 # local: cria o cenário Cinema
npm run db:seed-demo:prod -- --scenario=cinema --dry-run  # prod (Neon), via .env.production.local
npm run db:seed-demo:prod -- --scenario=cinema            # prod: pede a frase "seed demo" (ou SEED_DEMO_CONFIRM)
#   Precisa das contas `dudupizzas`, `teste` e `admin` já criadas (admin com platform_admin).
#   `--reset` remove só o grupo com o marcador ⟦seed-demo⟧ e recria. --dry-run nunca grava.
#   Atenção: em prod o modelo entra na galeria pública /modelos e o link /results/<token> fica no ar.

# verificações
npm run lint
npm run typecheck
npm test                            # unidade + build + smoke
DATABASE_URL=postgresql://goa:goa_local_only@127.0.0.1:5433/goa_test \
  npm run db:migrate && npm run test:integration
```

`.env.production.local` (fora do Git) guarda `DATABASE_URL`/`ADMIN_PASSWORD` de
produção. Para a **migração** use a URL **direta** do Neon (sem `-pooler`); o
pooled fica só para a aplicação. O teste de integração se recusa a limpar
qualquer banco que não se chame `goa_test`.

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
4. **Migração** (a cada nova migração), da sua máquina contra o Neon:

   ```bash
   node --env-file=.env.production.local scripts/migrate.mjs
   ```

   A conta de administração já existe — só rode `scripts/seed-admin.mjs` do mesmo
   jeito se precisar redefinir a senha. Algumas migrações vêm com um _backfill_
   pontual e idempotente: depois da `0010` (acervo do grupo), rode uma vez
   `node --env-file=.env.production.local scripts/backfill-catalog.mjs`.

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
scripts/    migração, seed da conta de administração e seed de demonstração (scripts/seed-demo)
tests/      unidade, smoke e integração
docs/       arquitetura (docs/architecture.md) e endpoints (docs/api.md)
```

## O que o Goa faz

- **Contas** — cadastro e login por usuário **ou** e-mail, sessão HTTP-only + CSRF;
  troca de senha nas Configurações (com a senha atual). O e-mail é opcional e por
  ora serve só para login: a redefinição por link está fora do ar até haver um
  canal de e-mail (ver "Recuperação de senha").
- **Grupos e papéis** — o grupo é duradouro e reúne pessoas entre rodadas. `owner`
  > `admin` > `participant`. Convites por link expirável / código curto.
- **Rodadas por receita** — quatro criáveis: `cinema` (nota 0–5 + comentário, com
  expectativa opcional que trava ao avaliar), `library` (livros do acervo, progresso
  por dia + conclusão + nota), `bookshelf` (só avaliação, sem período) e `habit`
  (check-in sem catálogo). As quatro chaves antigas (`cine_free`, `cine_curated`,
  `reading_club`, `reading_daily`) continuam legíveis no banco mas não criam mais
  estrutura. Estados `draft → active → closed`; período opcional; campos
  semânticos estáveis.
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
  tamanho do banco, auditoria (sem textos privados), moderação de contas. **Não**
  tem lixeira global nem redefine senha — a lixeira é sempre do dono do conteúdo.
  Qualquer outra conta recebe `404`.

Ver [docs/architecture.md](docs/architecture.md) para o modelo de domínio, a
segurança e as decisões; [docs/api.md](docs/api.md) para os endpoints.

## Para onde vai

[ROADMAP.md](ROADMAP.md) — o que já entrou e o que vem a seguir (afinidade entre
pessoas, cortes por gênero/década, automação).

## Licença

[Functional Source License 1.1](LICENSE.md) com licença futura Apache 2.0
(`FSL-1.1-ALv2`). O código é **fonte disponível** (não open source durante a
janela): você pode ler, usar, modificar e redistribuir para qualquer fim que
**não** seja oferecer a terceiros um produto ou serviço comercial concorrente. A
licença protege este código, não a ideia nem uma reimplementação independente.
Cada versão passa a Apache 2.0 dois anos depois de publicada.
