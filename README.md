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
global, não exclui conteúdo de terceiros e não gera links de redefinição de senha:
a lixeira é sempre do dono do conteúdo.

| Ambiente   | Usuário | Senha                                    |
| ---------- | ------- | ---------------------------------------- |
| Local      | `admin` | `goa-admin-local` (definida no compose)  |
| Produção   | `admin` | valor do segredo `ADMIN_PASSWORD`        |

Depois de entrar, use a interface para criar um grupo e convidar as demais pessoas.
Rode `npm run db:seed` de novo a qualquer momento para redefinir a senha.

As contas fazem login por **nome de usuário ou e-mail** + senha.

### Recuperação de senha

O e-mail é opcional no cadastro, mas é o que permite recuperar o acesso: quem
esquece a senha pede em "Esqueci a senha" (`POST /api/auth/forgot`) e recebe um
link de uso único.

O `/admin` deliberadamente **não** gera esse link. A garantia de "só se a pessoa
tiver pedido" seria circular — o administrador vê o e-mail no próprio painel,
`/api/auth/forgot` é público e ele mesmo pode fabricar o pedido que deveria estar
apenas atendendo; na prática seria poder assumir qualquer conta. Quando alguém
perde tanto a senha quanto o acesso ao e-mail, a recuperação é uma ação de
**operador**, não de administrador de plataforma:

```bash
DATABASE_URL=… node scripts/reset-password.mjs <usuario|email> '<nova senha>'
```

O script exige a `DATABASE_URL` — que a flag `platform_admin` não concede —,
revoga todas as sessões da conta e invalida os pedidos de redefinição pendentes.

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
scripts/    migração e seed da conta de administração
tests/      unidade, smoke e integração
docs/       arquitetura (docs/architecture.md) e endpoints (docs/api.md)
```

## O que o Goa faz

- **Contas** — cadastro e login por usuário **ou** e-mail, sessão HTTP-only + CSRF;
  redefinição de senha por link de uso único, pedida pela própria pessoa em
  `/api/auth/forgot`. O e-mail é opcional mas é o que recupera o acesso — o
  `/admin` **não** gera links de redefinição (ver "Recuperação de senha").
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
  tamanho do banco, lixeira (purga definitiva), auditoria, moderação de contas.
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
