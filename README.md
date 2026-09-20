# Goa

Plataforma web para desafios privados e personalizáveis. O participante registra;
o sistema organiza e calcula; o administrador revisa e transforma o resultado em
memória do grupo.

Next.js 16 (App Router) + React 19 + TypeScript, API REST no mesmo runtime e
PostgreSQL como fonte de verdade. A V1 está implementada e coberta por testes
automatizados; o produto continua evoluindo (bibliotecas, respostas compartilhadas,
datas de evento e o espaço pessoal vieram depois — ver "O que o Goa faz").

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
npm run db:migrate:prod          # = node --env-file=.env.production.local scripts/migrate.mjs
#   migrate.mjs fala com o Neon por WSS/443, então funciona mesmo em redes que
#   bloqueiam a 5432. Local (Docker) continua na 5432 via `pg`. Idempotente:
#   sem nada a aplicar, só imprime "nada a fazer" e sai 0.

# migração + conta de administração de uma vez
npm run db:setup                                        # local
node --env-file=.env.production.local scripts/seed-admin.mjs   # depois do migrate, em prod

# dados de demonstração (um desafio pessoal de leitura rico: 90 dias, 6 livros, encerrado e publicado)
npm run db:seed-reading -- --dry-run          # local: valida a conta/ambiente, não grava
npm run db:seed-reading                       # local: cria o desafio para @dudupizzas
npm run db:seed-reading -- --reset            # local: purga o desafio e recria
npm run db:seed-reading:prod -- --dry-run     # prod (Neon), via .env.production.local
npm run db:seed-reading:prod                  # prod: pede a frase "seed reading" (ou SEED_READING_CONFIRM)
#   Precisa da conta `dudupizzas` já criada (o script só a procura, nunca a cria).
#   `--reset` acha o desafio pelo título "90 dias de leitura" na área pessoal da conta,
#   purga e recria. O desafio gerado é um desafio comum — sem marcação. --dry-run nunca grava.
#   Atenção: em prod, se a conta for platform_admin o modelo entra na galeria pública /modelos
#   e o link /results/<token> fica no ar.

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

1. **Vercel → Project Settings**: Framework Preset = **Next.js**, Output padrão.
   O **Build Command** fica no `vercel-build` do `package.json`
   (`bash scripts/deploy.sh`) — Vercel o usa automaticamente, não sobrescreva no
   painel. `scripts/deploy.sh` aplica as migrações pendentes e então builda.
2. **Environment Variables** (Production): `DATABASE_URL` (use a URL **pooled** do
   Neon — host com `-pooler` — com `sslmode=require`, para reaproveitar conexões
   entre invocações), `APP_ORIGIN` (origem pública exata, ex.: `https://goa.vercel.app`),
   `ADMIN_PASSWORD` (mínimo 10 caracteres). Opcional: `ADMIN_USERNAME`, `ADMIN_NAME` e
   os limites de criação — `MAX_GROUPS_PER_OWNER` / `MAX_CHALLENGES_PER_GROUP`
   (padrão 6), `MAX_CHALLENGES_PER_PERSONAL_SPACE` (30), `MAX_MEMBERS_PER_GROUP`
   (62), `MAX_GROUPS_PER_MEMBER` (186), `MAX_PENDING_INVITES_PER_USER` (31); ver `.env.example`.
3. **`git push`** dispara o build e o deploy. No deploy de **produção**
   (`VERCEL_ENV=production`) o `deploy.sh` roda `scripts/migrate.mjs` antes do
   build; deploys de preview pulam a migração (defina `RUN_MIGRATIONS=1` na env
   do preview para forçar). Sem migração pendente, o passo é um no-op.
4. **Migração manual** (se quiser aplicar fora de um deploy), da sua máquina:

   ```bash
   npm run db:migrate:prod
   ```

   A conta de administração já existe — só rode `scripts/seed-admin.mjs` do mesmo
   jeito se precisar redefinir a senha. As migrações são aditivas e idempotentes;
   as que corrigem dados (por exemplo a `0051`, que tira dos Screens os livros que
   uma versão antiga guardou como filme) rodam junto, sem passo manual.

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
scripts/    migração, deploy, seed da conta de administração e seed de demonstração (scripts/seed-reading)
tests/      unidade, smoke (HTML renderizado) e integração (tests/integration/mvp.test.ts)
docs/       arquitetura (docs/architecture.md), endpoints (docs/api.md), Fase 2 e releases
messages/   textos da interface em pt-BR, en e es (mesmo conjunto de chaves nos três)
```

## O que o Goa faz

- **Contas** — cadastro e login por usuário **ou** e-mail, sessão HTTP-only + CSRF;
  troca de senha nas Configurações (com a senha atual). O e-mail é opcional e por
  ora serve só para login: a redefinição por link está fora do ar até haver um
  canal de e-mail (ver "Recuperação de senha").
- **Grupos, papéis e Meu espaço** — o grupo é duradouro e reúne pessoas entre
  rodadas. `owner` > `admin` > `participant`. Convites por link expirável / código
  curto, ou por @usuário com aceite de quem é convidado. **Meu espaço** (`/personal`,
  link no cabeçalho) é o espaço só seu — desafios, acervo e lixeira próprios, sem
  grupo nem convites. Quem ainda não tem nada vê, no Início, uma tela de boas-vindas
  com as partes de uma rodada e três formas de começar.
- **Rodadas por receita** — seis criáveis: `cinema` (nota 0–5 + comentário, com
  expectativa opcional que trava ao avaliar), `library` (livros, progresso por dia +
  conclusão + nota), `bookshelf` (só avaliação, sem período), `habit` (check-in sem
  catálogo), `tables` (restaurantes e afins, uma nota por dimensão) e `custom`
  (qualquer biblioteca; você decide o que registrar). As quatro chaves antigas
  (`cine_free`, `cine_curated`, `reading_club`, `reading_daily`) continuam legíveis
  no banco mas não criam mais estrutura. Estados `draft → active → closed`; período
  opcional; campos semânticos estáveis; itens em **etapas**; cronograma, campos e
  itens seguem editáveis com o desafio ativo.
- **Bibliotecas e acervo** — cada espaço organiza o que acompanha em bibliotecas:
  Screens (filmes, séries…), Pages (livros e leituras), Tables (lugares) e as suas
  próprias (Jogos, Séries…), renomeáveis, com propriedades que você mostra, oculta e
  reordena. Um item tem identidade estável e reaparece em outra rodada sem perder o
  histórico; uma rodada pode tirar itens de várias bibliotecas. O acervo mostra o que
  está em nenhum desafio e remove em lote; uma biblioteca criada por você pode ser
  excluída (os itens vão para a lixeira junto). Um item pode ter **data de evento**
  (um dia ou horário com fuso) e um **indicador** — membro, nome guardado de quem
  está fora do Goa, ou uma nota.
- **Registros e respostas compartilhadas** — cada pessoa edita o próprio registro.
  Uma resposta pode ser **do grupo** (um placar final, um veredito), gravada uma vez
  por item, com política de quem preenche e aviso quando duas pessoas salvam ao
  mesmo tempo. Um registro aponta item + dia + etapa conforme a receita.
- **Análise** — `group_by` calculado: ranking com nota ajustada (bayesiana, com
  mínimo de amostra), polarização (desvio), surpresa × decepção (avaliação −
  expectativa), viés do indicador. As receitas já semeiam as métricas certas.
- **Vitrine** — o Goa monta a história (hero, KPIs, ranking, perfis, melhores
  comentários) e tudo se recalcula a cada leitura, sem passo de "regenerar";
  owner/admin curam manchete, resumo e destaques a qualquer momento e publicam em
  `/results/<token>` depois de encerrar (desde a migração `0035`, o banco guarda
  hash e token completo para reapresentar o link aos autorizados). Nomes só
  aparecem com o consentimento de cada pessoa, e sair do grupo ou revogar o
  consentimento esconde a identidade na hora.
- **Modelos** — desafios que um `platform_admin` publica em `/modelos`; qualquer
  pessoa copia a estrutura (com ou sem os itens) para um grupo seu.
- **`/admin`** — painel só de metadados para a conta `platform_admin`: uso,
  tamanho do banco, auditoria (sem textos privados), moderação de contas. **Não**
  tem lixeira global nem redefine senha — a lixeira é sempre do dono do conteúdo.
  Qualquer outra conta recebe `404`.

Ver [docs/architecture.md](docs/architecture.md) para o modelo de domínio, a
segurança e as decisões; [docs/api.md](docs/api.md) para os endpoints.

## Para onde vai

[ROADMAP.md](ROADMAP.md) — escopo e histórico da V1.
[Plano da Fase 2](docs/phase-2.md) — o que falta: descoberta pública e beta.
[Releases](docs/releases.md) — versionamento e checklist de lançamento no GitHub.

## Licença

[Functional Source License 1.1](LICENSE.md) com licença futura Apache 2.0
(`FSL-1.1-ALv2`). O código é **fonte disponível** (não open source durante a
janela): você pode ler, usar, modificar e redistribuir para qualquer fim que
**não** seja oferecer a terceiros um produto ou serviço comercial concorrente. A
licença protege este código, não a ideia nem uma reimplementação independente.
Cada versão passa a Apache 2.0 dois anos depois de publicada.
