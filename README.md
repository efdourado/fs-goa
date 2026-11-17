# Goa

Desafios privados para grupos de amigos, e para você sozinho. Um clube de cinema,
30 dias de leitura, um hábito, os bares da cidade. Cada pessoa registra; o Goa
calcula, ranqueia e desenha o fio da rodada; no fim, o resultado vira memória.

Next.js 16 (App Router) · React 19 · TypeScript · PostgreSQL 16 (Drizzle) ·
next-intl (pt-BR, en, es). Deploy em Vercel + Neon; Docker Compose replica tudo
localmente.

## O que tem dentro

- **Grupos e Meu espaço**, grupos privados com convites; um espaço só seu para
  desafios pessoais e listas vivas.
- **Desafios por receita**, Screens (filmes e séries), Pages (livros), hábitos,
  Tables (lugares) e personalizados. Quem cria escolhe o que se registra; o sistema
  impede estruturas incoerentes.
- **Bibliotecas**, o acervo de cada espaço, com identidade estável entre rodadas,
  capas tipográficas e propriedades editáveis.
- **Revelação**, notas seladas até o grupo revelar o título; só revela quem já
  respondeu, então ninguém espia antes de se comprometer.
- **O fio**, a rodada desenhada (uma linha por pessoa) e um almanaque de páginas:
  pódio, gêneros, críticos, pares, surpresas, sequências e recordes, para baixar
  como imagem.
- **Pontuação Goa**, rankings que desempatam cinco estrelas pelo histórico de quem
  avaliou, sem reescrever nenhuma nota (ver [arquitetura](docs/architecture.md#pontuação-goa)).
- **Publicação e modelos**, link público anônimo por padrão, consentimento de nome
  por pessoa; modelos públicos em `/modelos` para copiar a estrutura.

## Rodar

```bash
docker compose up --build        # primeira execução, ou após mudar código/dependências
```

Abra **http://localhost:3000** quando o app terminar de iniciar. O comando mantém
os logs no terminal; `Ctrl+C` para os serviços. Para o uso diário, sem mudanças:

```bash
docker compose up -d             # inicia em segundo plano, sem reconstruir a imagem
docker compose logs -f app       # acompanha os logs (Ctrl+C sai dos logs)
docker compose stop             # para os serviços; os dados continuam no volume
```

Após atualizar o projeto, use `docker compose up -d --build`. O serviço `setup`
aplica as migrações antes de iniciar o app. Os dados ficam no volume do Postgres;
`docker compose down` preserva esse volume. `docker compose down -v` apaga os dados.
A imagem usa Node `26.13.1` LTS e npm `12.2.2`, com dependências fixadas no lockfile.
O Postgres continua na versão 16 para reutilizar o volume existente.

Para desenvolver com atualização automática ao salvar, rode o app fora do Docker
(Node `26.13.1`, ver `.nvmrc`):

```bash
cp .env.example .env.local       # só na primeira vez; preserve seu arquivo existente
nvm install && nvm use
npm install --global npm@12.2.2
docker compose stop app         # libera a porta 3000, se o app do Docker estiver rodando
docker compose up -d postgres
npm ci && npm run db:setup       # migrações + conta admin (admin / goa-admin-local)
npm run dev
```

Abra o mesmo **http://localhost:3000**. O modo Docker executa uma versão compilada;
as alterações nos arquivos aparecem depois de reconstruir a imagem.

## Comandos

| Comando | O quê |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript |
| `npm test` | unidade + build + smoke do HTML renderizado |
| `npm run test:integration` | API ponta a ponta contra `goa_test` (exporte `DATABASE_URL=…/goa_test`; o teste recusa qualquer outro banco) |
| `npm run db:generate` | nova migração a partir de `db/schema/` |
| `npm run db:migrate` · `db:migrate:prod` | aplica migrações local · no Neon (WSS/443, via `.env.production.local`) |
| `npm run db:seed-showcase` | dados de demonstração locais: um clube, um duo, um solo, hábitos |
| `npm run db:seed-local` | 11 desafios sintéticos para testar telas (só local) |
| `npm run db:seed-reading[:prod]` | um desafio de leitura rico para @dudupizzas |

O ESLint fica na última versão 9 compatível com os plugins de React/acessibilidade,
e o TypeScript na última versão 6 aceita pelo `typescript-eslint`. O override de
`esbuild` corrige a dependência antiga do loader do Drizzle Kit. O `allowScripts`
registra as versões das dependências nativas que precisam de scripts no npm 12.

## Produção

Vercel (região `gru1`) + Neon (`sa-east-1`). `git push` faz o deploy; o
`vercel-build` roda `scripts/deploy.sh`, que aplica as migrações pendentes antes do
build em produção. Variáveis: `DATABASE_URL` (pooled), `APP_ORIGIN`,
`ADMIN_PASSWORD`; limites opcionais em `.env.example`. A migração manual usa a URL
**direta** do Neon.

## Documentação

- [docs/architecture.md](docs/architecture.md), como o código está organizado,
  o modelo de domínio, as regras do produto e a segurança.
- [docs/api.md](docs/api.md), as páginas e os endpoints.
- [CONTRIBUTING.md](CONTRIBUTING.md), como contribuir.

## Licença

[Functional Source License 1.1](LICENSE.md) com licença futura Apache 2.0
(`FSL-1.1-ALv2`): fonte disponível para qualquer uso que **não** seja oferecer um
produto ou serviço comercial concorrente. Cada versão vira Apache 2.0 dois anos
depois de publicada.
