# Arquitetura

Como o Goa está organizado hoje. A superfície HTTP está em [api.md](api.md); onde
este texto e o código divergirem, vale o código.

## Visão geral

```text
navegador ──JSON + cookie HTTP-only──▶ Next.js (route handlers) ──SQL parametrizado──▶ PostgreSQL
   SPA única (GoaApp)                    um roteador fino → lib/      fonte única de verdade
```

- **Uma SPA, várias URLs.** Toda página (`app/**/page.tsx`) monta `app/GoaApp.tsx`;
  a URL só decide a tela inicial (`app/goa/navigation.ts`). Voltar sobe para a tela
  pai, nomeada no botão. Exceções renderizadas no servidor: `/admin`,
  `/results/:token` e o documento de exportação (`/challenges/:id/export`).
- **Um roteador.** `app/api/[...path]/route.ts` casa caminhos e delega para `lib/`;
  nenhuma regra de acesso mora nele.
- **Tudo dinâmico, nada no build.** Route handlers Node com `force-dynamic`; o
  cliente guarda respostas num cache SWR leve (`app/goa/cache.ts`).

## Organização do código

```text
app/
  GoaApp.tsx            estado global, navegação e orquestração da SPA
  api/[...path]/        o roteador REST
  goa/                  interface: api.ts (contrato), types.ts, ui.tsx (kit), telas e componentes
    screens/            uma tela por arquivo (início, grupo, desafio, gestão, acervo, modelos…)
    story/              o fio: model.ts (puro) → thread-*.tsx (desenho) + almanac.tsx (páginas) + pages.tsx (PNG)
    export/             o documento imprimível de um desafio (PDF pelo navegador)
    score.ts            a pontuação Goa — matemática pura
  admin/ results/       páginas renderizadas no servidor (as demais montam GoaApp)
lib/
  auth.ts security.ts http.ts db.ts limits.ts   contas, sessões, CSRF, respostas, pool, limites
  goa/domain/           grupos, convites, criação de desafios, acesso, auditoria
  goa/challenges/       tudo de um desafio: receitas, tipos e campos, itens, etapas, registros,
                        revelação, métricas, pontuação, publicação, modelos, cópia
  goa/catalog*.ts       bibliotecas, acervo, propriedades, indicadores
  goa/analysis.ts       estatística pura (bayes, mediana, desvio, consenso, afinidade)
  goa/trash.ts purge.ts lixeira e exclusão definitiva
  goa/taste.ts          mapa de gosto do grupo
db/schema/              schema Drizzle por área · drizzle/ migrações versionadas
messages/               pt-BR · en · es, sempre com o mesmo conjunto de chaves
scripts/                migração, deploy e seeds
tests/                  unidade (*.test.ts[x]) · smoke do HTML · integração (tests/integration)
```

Regra prática: matemática e modelos de tela são **funções puras** testadas sem
banco (`analysis.ts`, `score.ts`, `story/model.ts`, `export/model.ts`); SQL fica em
`lib/`; componentes só formatam.

## Modelo de domínio

```text
Espaço — um grupo, ou o espaço pessoal (groups.kind = 'personal', oculto, de uma pessoa)
├── Bibliotecas (catalog_libraries) — Screens (film), Pages (book), Tables, personalizadas
│   └── Acervo (catalog_items) — identidade estável entre rodadas; propriedades nativas + atributos tipados
└── Desafio (challenges) — receita, período opcional, draft → active → closed
    ├── challenge_libraries — de quais bibliotecas tira itens
    ├── challenge_items — o item nesta rodada (+ quem indicou, etapa, revelado em)
    ├── challenge_checkpoints — etapas (dia, semana, sessão, marco)
    ├── entry_types — o que se registra, em eixos independentes:
    │     purpose (rating · progress · completion · expectation · checkin)
    │     cardinality · target_policy · schedule_policy
    │     visibility_policy (group_realtime · after_own · after_close · author_only · until_reveal)
    │     answer_scope (individual · shared — uma resposta do grupo, como um placar)
    ├── challenge_fields — campos semânticos (número, nota, texto, escolha…)
    ├── challenge_metrics — métricas declarativas (operação × campo × agrupamento)
    └── entries + entry_values — o registro de uma pessoa (item, dia, etapa, valores)
```

- **Receitas** (`recipes.ts`) montam a estrutura inicial: `cinema` (Screens),
  `bookshelf` (Pages), `library` (leitura por dia), `habit`, `tables` e `custom`.
  Depois de criada, a estrutura é do desafio — a receita não manda mais.
- **Identidade do acervo**: filme e livro casam por título (+autor/ano); outras
  bibliotecas nunca fundem por título, a pessoa escolhe.
- **Visibilidade** é por tipo de registro e aplicada em `listEntries`: autor e
  admin sempre veem o seu; `after_own` abre quando você respondeu o mesmo tipo no
  mesmo item; `until_reveal` sela até alguém que já respondeu revelar o item
  (`reveal.ts`) — admins esperam como todo mundo. Agregados novos **precisam**
  usar `unsealedEntrySql`.
- **Conclusão** é inferida dos registros, nunca um status manual.
- **Números** são inteiros escalados (`number_scaled` + `number_scale`).

## Números do desafio

- **Métricas** (`results.ts`, `analysis.ts`): contagem, soma, média, mediana,
  mín/máx, média bayesiana, desvio, consenso, surpresa (nota − expectativa), viés de
  quem indicou — agrupadas por item, pessoa, etapa, ano, autor ou gênero.
  Combinações incoerentes são recusadas. **Auto-métricas** (`auto-metrics.ts`):
  todo campo de número ou nota ganha as métricas óbvias uma vez; apagadas, não
  voltam.
- **"A nota"** de um desafio (`rating.ts`): uma métrica marcada `isRating` diz quais
  campos formam a nota de cada registro; sem ela, a média dos campos de nota.
- **Rankings pessoais e afinidade** (`rankings.ts`): por pessoa e por par, sempre ao
  vivo.

### Pontuação Goa

A ordem de rankings e pódios. As notas guardadas nunca mudam, e as médias exibidas
continuam sendo médias reais; só a ordenação usa a pontuação. A fórmula está em
`app/goa/score.ts`; o servidor (`lib/goa/challenges/goa-score.ts`) lê o grupo uma vez,
normaliza cada nota para 0–1 pela escala do próprio campo e pontua cada título
**dentro do seu contexto** (a biblioteca do grupo, ou do espaço pessoal).

Para cada pessoa que avaliou, com o título fora do próprio histórico:

- **Escala pessoal** — um 5 de quem quase nunca dá 5 pesa um pouco mais
  (`α = n/(n+8)`, até 15% da nota vem de compará-la com o costume da pessoa).
- **Gosto** — o que ela costuma amar (gênero .4, diretor/autor .3, década .15,
  duração .15) forma uma expectativa que entra como um prior pequeno (força até 0,4).
- **Quem indicou** pesa 0,8 num grupo.

Sem histórico, vira a média simples; sem notas, não há pontuação. Privacidade: tudo —
histórico incluído — passa por `visibleTo(viewer)` antes do cálculo, então uma nota
que você ainda não pode ver nunca mexe num número que você vê. O acervo mostra
sempre de 0 a 5. Onde aparece: o fio (pódio, ranking, gêneros, anos), métricas de
ranking por item que leem exatamente a nota do desafio, e a nota do acervo.

## O fio

`app/goa/story/model.ts` transforma detalhe + registros num `Story` puro: **rated**
(uma linha por pessoa atravessando os títulos, notas fixadas e um almanaque — pódio,
gêneros, anos, críticos, pares, terreno comum, surpresas, citações, duo e solo com
leituras próprias) ou **dated** (raias de dias, sequências, constância, recordes).
`almanac.tsx` vira páginas paginadas; `pages.tsx` gera PNG 1600×2000 por
`html-to-image`. O mesmo modelo serve o desafio, o link público e o modelo — a versão
pública é montada no servidor (`public-story.ts`) com nomes mascarados, chaves
opacas e **nenhum** comentário.

## Regras do produto

### Edição e integridade

Cronograma, campos e itens seguem editáveis com o desafio ativo; só o que
deixaria respostas órfãs é bloqueado (`409`): campo com respostas não sai, métrica
que lê um campo precisa ser resolvida antes, limites não podem invalidar valores
existentes, receita e cardinalidade não mudam depois de ativar.

### Publicação e consentimento

Nada é público por padrão. Owner/admin publica o link (`/results/:token`, `noindex`)
de um desafio encerrado ou lista viva; o banco guarda hash e token (desde `0035`),
rotacionar invalida o anterior, despublicar limpa os dois. A publicação é anônima
por padrão ("Participante N"); cada pessoa autoriza o próprio nome por desafio, e
revogar, sair ou ser removido esconde a identidade **na hora**, sem republicar.
Publicar não cria modelo — modelos são da plataforma.

### Lixeira e recuperação

Quatro ações distintas: **arquivar** (fica no histórico), **mover para a lixeira**
(`trash_items`), **revogar** relações e tokens (nunca vão para a lixeira) e **excluir
definitivamente** — só a partir da lixeira, depois do preview de dependências. A
lixeira é do dono e não expira; um item nela ainda ocupa vaga nos limites. Filho
não restaura sem pai ativo; conflito de nome se resolve antes. Conta não usa
lixeira: **desativar** é reversível; **excluir** pede a senha, apaga o que é só
seu, transfere grupos compartilhados e anonimiza contribuições (o texto livre
continua — a tela avisa).

### Administração e privacidade

`platform_admin` só abre `/admin`: contas, sessões, uso agregado, limites, erros,
feedback e auditoria **sem conteúdo**. Não vê títulos pessoais, comentários,
notas ou respostas; não tem lixeira global, não apaga conteúdo de terceiros e não
redefine senhas. A auditoria guarda ator, ação, entidade e campos alterados, com
texto longo redigido.

### Fora de escopo

E-mail (por isso a redefinição de senha por link está desligada; a tabela
`password_reset_tokens` fica dormente), integrações externas, importar XLSX/PDF,
app nativo, feed social, fórmulas livres.

## Segurança

- Senhas PBKDF2-HMAC-SHA256 (600 000 iterações); tokens de sessão e convite de 256
  bits, guardados só como SHA-256.
- Cookie `__Host-goa_session` (`HttpOnly`, `Secure`, `SameSite=Lax`); toda mutação
  exige `Origin` exata + token CSRF ligado à sessão.
- Todo acesso parte da associação ativa ao grupo — um ID nunca concede acesso.
- Validação estrita dos valores de campo; métricas são enums, nunca SQL.
- Cabeçalhos de segurança em `next.config.ts` (frame, nosniff, CSP sem scripts —
  nonces de script ainda pendentes); páginas públicas sem dados privados.

## Testes

- **Unidade** (`npm run test:unit`): matemática, modelos de tela, navegação,
  validação, segurança e um render de componente (`story-ranking-display.test.tsx`).
- **Smoke** (`npm test`): build + HTML renderizado das páginas públicas.
- **Integração** (`tests/integration/mvp.test.ts`): a API inteira contra `goa_test`,
  com contas reais — acesso entre grupos, visibilidade, revelação, privacidade do
  fio público e da pontuação, lixeira, cópia, publicação.
