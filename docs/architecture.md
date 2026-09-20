# Arquitetura

Este documento descreve como o código está organizado **hoje**. O escopo original
da V1 (e a numeração de seções citada nos comentários do código) está em
[`ROADMAP.md`](../ROADMAP.md); a superfície HTTP está em [`api.md`](api.md).

## Visão geral

Next.js 16 (App Router) + React 19 + TypeScript. A API REST são route handlers no
mesmo runtime da interface, todos Node e dinâmicos (`force-dynamic`). PostgreSQL
16+ é a única fonte de verdade. Deploy padrão: Vercel + Neon; Docker Compose
replica tudo localmente.

```text
navegador ──JSON + cookie HTTP-only──▶ Next.js / route handlers ──SQL parametrizado──▶ PostgreSQL
                                        ├── autenticação, CSRF e autorização
                                        ├── grupos, convites, bibliotecas e acervo
                                        ├── rodadas: receitas, tipos de registro, registros
                                        ├── análise, vitrine e auditoria
```

## Limites de módulo

| Arquivo | Responsabilidade |
| --- | --- |
| `app/GoaApp.tsx` | estado global, navegação e orquestração da SPA cliente |
| `app/goa/` | contrato REST (`api.ts`), tipos, telas e componentes |
| `app/api/[...path]/route.ts` | roteamento HTTP fino; nenhuma decisão de autorização |
| `app/admin/` | página `/admin` (server component com guarda) + console |
| `lib/auth.ts` | contas, sessões, rate limit, papéis, troca de senha autenticada |
| `lib/admin.ts` | serviços do `/admin` — só metadados |
| `lib/security.ts` | PBKDF2, tokens, cookies, origem e CSRF |
| `lib/goa/domain/` | criação de grupos, convites e desafios; `event-schedule.ts` (data de evento de um item, com fuso) |
| `lib/goa/challenges/` | receitas, tipos de registro (inclusive compartilhados), campos, itens, etapas (checkpoints), bibliotecas do desafio (`libraries.ts`), indicadores (`recommender.ts`), importação de lista, registros, prontidão, análise, vitrine, duplicação e cópia (`copy.ts`) |
| `lib/goa/catalog.ts` | bibliotecas, propriedades, acervo do espaço, indicadores externos, remoção em lote e histórico de um item entre rodadas |
| `lib/goa/catalog-attributes.ts` | propriedades personalizadas (tipadas) de uma biblioteca |
| `lib/goa/analysis.ts` · `lib/metrics.ts` | matemática pura das métricas (bayes, mediana, desvio, consenso, afinidade) |
| `lib/goa/challenges/rankings.ts` | rankings pessoais + afinidade direta/composta (blocos derivados) |
| `lib/goa/trash.ts` · `lib/goa/purge.ts` | lixeira recuperável (registro `trash_items`, restauração, exclusão permanente) e deleção física da árvore |
| `lib/validation.ts` | validação tipada de valores de campo |
| `db/schema/` | schema Drizzle, dividido por área |
| `drizzle/` | única fonte de migrações reproduzíveis |

## Modelo de domínio

```
Espaço = grupo, ou o espaço pessoal (groups.kind = 'personal', oculto e de uma pessoa só)
├── Bibliotecas — catalog_libraries: Screens (`film`) · Pages (`book`) · Tables ·
│      personalizadas. `kind` é opaco (`lib_<uuid>`, exceto film/book) e o `label` é
│      renomeável; nunca são identidade. Propriedades = colunas nativas (título, ano,
│      gênero, duração, autor, páginas, data do evento — `catalog_native_property_configs`
│      só guarda rótulo/visibilidade/ordem) + atributos tipados (`catalog_attribute_defs`)
├── Acervo — catalog_items: identidade estável entre rodadas. Filme/livro casam por
│      título(+autor); qualquer outra biblioteca nunca funde por título (a pessoa
│      escolhe "usar o existente" ou "criar novo")
├── Indicadores externos — catalog_recommenders: nome guardado ("Ana do trabalho"),
│      por espaço, nunca público
└── Rodada (challenges) — recipe_key + recipe_version
    ├── challenge_libraries — de quais bibliotecas a rodada tira itens (uma ou várias)
    ├── entry_types — 4 eixos ortogonais (o submission_mode fica, derivado):
    │     purpose (progress·completion·expectation·rating·checkin)
    │     target_policy (required·optional·none)  — precisa de um round item?
    │     cardinality (once_per_item·once_per_item_day·once_per_day·repeatable)
    │     schedule_policy (free·while_active·checkpoint)
    │     visibility_policy (group_realtime·after_own·after_close·author_only)
    │        — quem vê a resposta dos outros deste tipo, e quando
    │     answer_scope (individual·shared) + shared_edit_policy — uma resposta do grupo
    ├── challenge_items — o item nesta rodada + catalog_item_id +
    │        recommended_by_user_id | recommended_by_external_id | origin_note +
    │        checkpoint_id (opens_at/due_at existem, mas nenhuma tela os define)
    ├── challenge_checkpoints — as **etapas**: kind (day·week·session·milestone),
    │        posição, janela; a interface só cria etapas genéricas (`session`), e
    │        `day` nasce automaticamente nas rodadas dia-a-dia
    ├── challenge_fields — campos semânticos por tipo de registro
    └── entries — participante + tipo + item/checkpoint + occurred_on + entry_values
```

- **Receitas** (`lib/goa/challenges/recipes.ts`): seis criáveis — `cinema`
  (avaliação: nota 0–5 + comentário até 500), `library` (progresso/dia +
  conclusão), `bookshelf` (só avaliação, sem período), `habit` (check-in sem
  catálogo), `tables` (restaurantes/bares: três notas por dimensão, sem nota
  combinada) e `custom` (qualquer biblioteca; quem cria decide o que se registra).
  As chaves são internas: na interface `cinema` se chama **Screens** e `bookshelf`,
  **Pages**, como as bibliotecas que alimentam. `tables` só sai depois que a pessoa
  criou a biblioteca Tables do espaço (`409 library_missing`) — o assistente
  oferece um botão para isso e nada é criado sozinho.
  As quatro antigas (`cine_free`/`cine_curated`/`reading_club`/`reading_daily`)
  continuam legíveis no banco mas não criam mais estrutura. A receita também decide
  se a rodada coleta a data opcional de cada registro (`challenges.collects_entry_date`,
  nulo = padrão da receita; `custom` nasce sem). Campos mínimos e invariantes das
  quatro originais: `ROADMAP.md` §3–4.
- **Bibliotecas e propriedades** (`catalog.ts`): cada espaço tem as suas. Screens e
  Pages são a evolução de filmes/livros (`kind` continua `film`/`book`, com colunas
  nativas e o casamento por título); Tables e as personalizadas nascem com `kind`
  opaco e **sem propriedades além das nativas** (título e data do evento) — quem
  cria acrescenta as suas. Renomear muda só o `label`. Um editor único (`GET/PATCH …/properties`)
  mexe em colunas nativas e atributos personalizados: rótulo, ocultar, ordem
  (`title` nunca se oculta). Uma biblioteca que uma pessoa criou pode ser
  **excluída** (`DELETE /api/catalog/libraries/:id?deleteItems=1`): ela é arquivada
  (`archived_at`), os itens vão para a lixeira junto e restaurar um deles traz a
  biblioteca de volta. Screens/Pages não saem (`library_builtin`); item ainda em
  desafio em andamento barra a exclusão (`library_busy`).
- **Acervo** — `GET …/catalog` devolve `challengeCount` por item (em quantos desafios
  ele está). A remoção em lote (`POST …/catalog/remove { itemIds }`, até 500) manda
  cada item para a lixeira e **pula** os que um desafio em andamento ainda usa
  (`skipped[].reason = in_use | not_found`).
- **Data do evento** (`event-schedule.ts`): propriedade nativa `scheduled_at` do
  item do acervo — um dia (`startsOn`/`endsOn`) ou um instante com fuso
  (`startsAt`/`endsAt` + `timeZone`). Nasce oculta; criar a rodada com `itemDates`
  (ou ligá-la na biblioteca) a torna visível e só então a API a devolve. É
  informação sobre o item: nunca abre nem fecha o registro (`due_at` é lembrete).
- **Respostas compartilhadas** (`entry_types.answer_scope = 'shared'`): uma resposta
  única por item para o grupo inteiro (um placar final), ao lado das individuais
  (nota, comentário). `shared_edit_policy` diz quem preenche (`members_fill_admin_corrects`
  ou `members_can_edit`); salvar envia `expectedUpdatedAt` e uma edição concorrente
  responde `409 shared_conflict` com o valor mais recente. "Feito", conclusão,
  métricas e rankings entendem respostas compartilhadas. Remover um tipo de resposta
  que já tem respostas avisa quantas (`409 entry_type_has_entries`) e só apaga com
  `?deleteAnswers=1`; métricas que o leem exigem `?archiveMetrics=1`.
- **Indicadores** (`recommender.ts`): quem trouxe o item pode ser um membro, um nome
  guardado do espaço ou uma nota — exclusivos entre si. `groups.recommendations_enabled
  = false` esconde tudo isso nas leituras e barra defini-lo (`409 recommendations_disabled`);
  os dados continuam guardados.
- **Cópia** (`copy.ts`, `duplicate.ts`, `templates.ts`): estrutura de um desafio ou
  modelo, com os modos `structure` (sem itens, mas recriando as bibliotecas e suas
  propriedades) e `structure_and_items`. Propriedades que não cabem no destino
  (outro tipo, ou arquivadas) são puladas e devolvidas em `skippedProperties`,
  nunca reinterpretadas.
- Um mesmo item aceita **mais de um tipo** de registro por pessoa (unicidade por
  item × tipo × pessoa; `once_per_item_day` inclui `occurred_on`).
- **Expectativa** (`purpose = 'expectation'`, `seedExpectationType`): tipo opcional
  do Cinema/Estante — nota 0–5 antes de assistir, `visibility_policy = 'after_own'`
  por padrão, uma por item. `saveEntry`/`updateEntry` a travam (409
  `expectation_locked`) assim que existe uma avaliação da mesma pessoa para o item.
  Liga/desliga com `PATCH /api/challenges/:id/expectation` (só no rascunho; sair
  bloqueado se já tem registros) ou `expectation: true` na criação.
- **Visibilidade** é por tipo (`visibility_policy`), aplicada em `listEntries`:
  `group_realtime` (todos, sempre), `after_own` (só depois de você responder o
  mesmo item), `after_close` (só autor + admin até encerrar), `author_only` (só
  autor + admin — métricas agregadas ainda contam). Admin e autor sempre veem
  tudo. A interface diz quem verá a resposta antes do primeiro envio; o preflight
  avisa (`expectation_visible_early`) se a expectativa ficar em `group_realtime`.
- **Conclusão** é inferida dos registros: a existência de um registro do tipo de
  conclusão (ou, na falta dele, do tipo principal — nunca da expectativa) conta
  como "feito"; `bootstrap` deriva `completedCount`/`totalCount` daí, sem status
  manual.
- Números e notas são inteiros escalados (nota fixa em 0–5 passo 0,5). Campos e
  opções em uso são arquivados, nunca apagados; um campo que alimenta uma
  métrica só sai depois de resolver a métrica.
- **Listas** (`lib/goa/challenges/list-import.ts` + `app/goa/ordering.ts`): item a
  item (só o título é obrigatório) ou colando um JSON. `previewListImport` analisa
  sem salvar — valida cada linha, mapeia campos conhecidos, avisa sobre chaves
  desconhecidas (nunca entram no banco sozinhas), aponta duplicatas no acervo e no
  desafio, resolve o indicador para um participante ou guarda a origem como texto.
  O commit reusa `saveChallengeItems`, numa transação (falha parcial não cria meia
  lista, limite de 200). Ordenação/sorteio são puros no cliente: manter, ordenar,
  sortear tudo, sortear por bloco, distribuir entre checkpoints — com prévia e
  re-sorteio antes de salvar.
- **Etapas / checkpoints** (`lib/goa/challenges/checkpoints.ts`; na interface são "etapas"): `saveCheckpoints` monta a
  lista numa transação; um checkpoint com registros não pode ser removido (409
  `checkpoint_has_entries`) e arquivar um vazio só solta os itens (`checkpoint_id
  = NULL`), nunca deixa registro órfão. `assignCheckpointItems` liga itens a
  checkpoints em massa. Rodadas dia-a-dia continuam derivando os checkpoints do
  período (`kind = 'day'`) e não abrem o planejador manual.
- **Prontidão** (`lib/goa/challenges/preflight.ts`): antes de ativar, uma revisão
  divide erros que bloqueiam (sem participantes, receita de item sem item,
  métrica apontando para campo morto, checkpoint fora do período…) e avisos que
  não bloqueiam. `GET /api/challenges/:id/preflight`; o mesmo cálculo é o portão
  do `transition` para `active`.
- **Métricas** (`results.ts` + `analysis.ts`) referenciam IDs de campos e são
  recalculadas sem tocar nos dados. Operações: contagem, soma, média, mediana,
  mín/máx, conclusão, média ajustada (bayes), polarização, consenso, surpresa,
  desempenho de indicação. `group_by` vira série: item, pessoa, `checkpoint`
  (com `cumulative`), ano/autor/gênero do acervo — combinações incoerentes são
  recusadas (409 `invalid_metric_grouping`, `metric_needs_checkpoints`,
  `metric_needs_expectation`…). Toda métrica calculada carrega `explanation`
  (fórmula) e `sample` (amostra usada, e como o total esperado foi contado).
- **Rankings pessoais + afinidade** (`rankings.ts`): blocos derivados, não
  `challenge_metrics`. Por pessoa: contagem, conclusão, média/mediana/faixa,
  consistência, top e piores itens, maior surpresa/decepção, desempenho das
  próprias indicações. Afinidade direta entre pares com ≥ 5 itens em comum
  (`100 × (1 − média |a−b| ÷ amplitude)`); afinidade composta (itens 50%, gênero
  25%, faixa de ano 15%, duração 10%, peso de dimensão sem amostra
  redistribuído) só aparece quando há amostra por dimensão. Vivo enquanto o
  desafio corre; `generateShowcase` congela em `result_blocks` (`kind ∈
  {ranking, affinity}`).
- **Vitrine** (`resultForChallenge` → `blocks[]`): o resultado é a lista ordenada de
  `result_blocks` (capa · resumo · total de registros · métricas · ranking ·
  afinidade · comentários). Métricas, rankings e afinidade **sempre** se recalculam
  ao ler (`value_snapshot` é nulo) — não existe "regenerar" nem rascunho; um
  comentário destacado lê o texto atual do registro. Curar (manchete, resumo,
  métricas em destaque, comentários, `allComments`, ocultar a grade de etapas)
  vale a qualquer momento e nunca publica nada sozinho; `PATCH …/results/blocks`
  reordena e esconde blocos sem mudar valores. Empates desempatam por rótulo.
- **Publicação** (§12): nada é público por padrão; só owner/admin, e só o link
  público (`POST …/results/publish`) exige desafio encerrado (ou lista viva
  pessoal). Desde a migração `0035`, o banco guarda **hash e token completo**
  para reapresentar o link aos usuários autorizados. A consulta pública usa o
  hash; rotacionar invalida o link anterior e despublicar limpa ambos. Um acesso
  ao banco também pode revelar esses links; esta é uma mudança em relação à
  decisão original de guardar apenas hash. A página pública é `noindex`.
  Publicar a vitrine **não** cria template (conceitos e rotas separados:
  `/results/:token` vs `/modelos/:id`).
- **Consentimento** (§12): `challenges.results_anon` nasce `true` (anônima por
  padrão). Cada participante autoriza o próprio nome por desafio
  (`challenge_participants.name_consent`, começa `false`, revogável, `PATCH
  …/consent`; reentrar nunca restaura o consentimento). O mascaramento
  (`maskShowcaseIdentities`: "Participante N", chave pública opaca por desafio,
  quem saiu sempre mascarado) é calculado **ao vivo** a cada leitura, pelo link e
  pelo modelo — sair, ser removido ou revogar o consentimento esconde a identidade
  na hora, sem despublicar nem republicar; só a atribuição muda, nunca o conteúdo
  ou as notas. Se o mascaramento não puder ser calculado, o conteúdo não é servido.
- **Duplicação** é só estrutural, em transação: desafio, tipos, campos, opções,
  itens e métricas ganham novos IDs; a receita carrega, a agenda zera, os itens
  re-resolvem contra o acervo do grupo de destino. As etapas manuais vêm sem datas
  (a cópia nasce sem período) e a data de evento de cada item acompanha; etapas
  dia-a-dia se regeneram do período. Participantes, registros, valores, blocos,
  tokens e indicadores **nunca** são copiados.
- **Lixeira e recuperação** (§13, `lib/goa/trash.ts`): quatro ações distintas —
  **arquivar** (`archived_at`, fica no histórico, some do dia a dia, sem exclusão
  possível enquanto a dependência existir); **mover para a lixeira** (linha
  explícita em `trash_items`); **remover/revogar** (relações e tokens —
  membresia, convite, sessão, publicação, template — nunca vão para a lixeira);
  **excluir permanentemente** (só da lixeira, com preview das dependências, só
  quando não corrompe histórico). A lixeira é **permanente e do usuário**: nada
  expira, não há varredura, `/api/health` continua só health check; um item
  binado ainda conta nos limites de criação. Lixeira principal (grupo, desafio,
  item de catálogo) em `GET /api/personal/trash` e `GET /api/groups/:id/trash`;
  estrutura removida do desafio (item, checkpoint, tipo, campo, opção, métrica) e
  registros removidos em `GET /api/challenges/:id/archive` — a exclusão física
  dessas peças acontece junto com o desafio, ou por confirmação simples enquanto
  ainda são rascunho vazio. Restaurar um pai revive todo filho que não foi
  binado à parte; filho não restaura sem pai ativo (409 `parent_trashed`);
  conflito de identidade é resolvido antes (409 `name_conflict`, `rename`).
  `system_audit_events` guarda o rastro operacional da purga (ator, ação, tipo,
  **hash** do id, contagens) — sem FK para conteúdo e sem texto privado.
- **Conta** (§13): duas ações separadas, não uma lixeira. **Desativar**
  (`users.deactivated_at`) é reversível — encerra sessões, o conteúdo fica; ao
  relogar, a SPA só mostra a tela de reativação e toda mutação responde 403
  `account_deactivated`. **Excluir permanentemente** (`POST /api/account/delete`,
  exige a senha) não deixa órfão: espaço pessoal e grupos só seus são apagados de
  vez, grupos compartilhados transferem a posse, contribuições preservadas ficam
  anônimas, publicações do usuário são despublicadas; a linha `users` fica
  (scrub de PII + `deleted_at`, nunca `DELETE` — as FKs `RESTRICT` de
  entries/audit impedem). **Limitação conhecida**: a anonimização troca o **nome**
  do autor por "Quem já saiu", mas não reescreve o **texto** que a pessoa digitou
  — um comentário livre que se autoidentifica ("sou o João…") continua no grupo.
  A exclusão avisa disso na tela (`account.consequenceContributions`); apagar
  esses textos é uma decisão do grupo (arquivar/binar o item ou o registro), não
  um efeito automático da exclusão de conta.

## Segurança

- senhas nunca persistidas nem retornadas; PBKDF2-HMAC-SHA256, 600.000 iterações,
  salt individual via Web Crypto;
- nome de usuário NFKC, minúsculo, restrito, único no PostgreSQL;
- tokens de sessão e convite de 256 bits; o banco guarda só SHA-256 base64url;
- cookie `__Host-goa_session` — `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`;
- toda mutação autenticada exige `Origin` exata + token CSRF ligado à sessão;
- toda consulta a recurso privado parte da associação ativa ao grupo — IDs não
  concedem acesso; participante só altera o próprio registro;
- payload JSON limitado, campos dinâmicos com validação estrita, métricas usam
  enums (nunca SQL nem fórmula arbitrária);
- auditoria append-only registra correções e transições — `before`/`after`
  passam por `redactAuditPayload`: texto longo (comentário, regra, manchete) vira
  `[texto omitido]`, só a identificação do campo e valores curtos ficam;
- `platform_admin` é um flag separado, sem poder sobre grupos — só abre `/admin`.
  **Pode ver** (§14): contas e estado operacional, sessões, eventos de
  autenticação, uso agregado, volume aproximado por conta, limites, erros,
  feedback, indicadores de abuso, datas e identificadores técnicos.
  **Não pode ver nem apagar**: título/descrição/regra de desafio pessoal,
  comentários, notas, respostas, catálogo privado, snapshots textuais completos.
  Não existe lixeira global — um objeto binado é do dono, para restaurar ou
  destruir; o `/admin` foi removido do poder de purgar conteúdo de terceiros.
  O `/admin` também **não redefine senha** de ninguém (um link emitido pelo
  admin seria assumir a conta): a redefinição por link está retirada até haver
  e-mail, e a tabela `password_reset_tokens` fica dormente.
  `adminAudit` traz eventos de espaço pessoal só como metadado (ator/ação/data),
  com `before`/`after`/`metadata` zerados e sem IDs de conteúdo;
- visibilidade de registro é por tipo (`visibility_policy`, ver Modelo de
  domínio): `listEntries` decide quem vê a resposta de quem; métricas agregadas
  leem os registros direto e não passam por esse filtro;
- publicação externa é anônima por padrão, com consentimento nominal por
  participante; token rotacionável (hash e token completo persistidos desde
  `0035`); página `/results/:token` é
  `noindex`; sair do grupo retira e regenera a vitrine (ver Modelo de domínio).

Cobertura: `tests/{security,validation,metrics,analysis}.test.ts` e
`tests/integration/mvp.test.ts` (contas distintas, convite, CSRF negativo,
isolamento entre grupos, o cenário dos dois livros no mesmo dia, Cine Curadoria,
motor de análise, vitrine gerada, memória do acervo, duplicação com texto-canário).

## Operação

`npm run db:setup` (migração + conta de administração) roda uma vez por schema
novo, contra o banco de destino. Nenhuma rota acessa o banco em build. No Compose,
o serviço `setup` roda antes de `app`. `GET /api/health` verifica processo e banco.

`DATABASE_URL`, `APP_ORIGIN` e `ADMIN_PASSWORD` são segredos do runtime — nunca no
repositório nem na imagem. A migração usa a URL **direta** do Neon; a aplicação, a
**pooled**.

## Decisões

- **Runtime** — Next.js 16 puro, sem Vite/adapters. Deploy por `git push`; a
  mesma imagem roda em qualquer contêiner Node.
- **Persistência** — Postgres + Drizzle; JSONB restrito a metadados e snapshots;
  FKs compostas garantem que participante, campo, item e opção pertençam ao mesmo
  escopo; transações cobrem convite, registro, encerramento e duplicação.
- **Identidade** — contas com usuário e senha, e-mail opcional (login por ambos).
  A redefinição de senha por link está retirada até haver e-mail (§1); só a troca
  autenticada, com a senha atual, funciona. Autorização sempre a partir da
  associação ativa ao grupo. Identidade de terceiros cabe depois sem mudar o
  domínio.
- **`submission_mode`** — mantido como coluna derivada por compatibilidade com o
  FK e os CHECKs de `entries`; os 4 eixos ortogonais é que mandam.

## Fora de escopo por enquanto

App mobile nativo; feed social entre grupos; import direto de `.xlsx`; editor
no-code genérico; afinidade nominal publicada sem consentimento; recalcular
retroativamente uma vitrine publicada.
