# Endpoints

`app/api/[...path]/route.ts` é a fonte de verdade — um roteador fino que só delega
para `lib/`. Esta tabela reflete o que existe; ao mexer numa rota, atualize aqui.

## Níveis de acesso

| Nível | Exigência |
| --- | --- |
| **público** | nada |
| **origem** | header `Origin` exato (`APP_ORIGIN`); sem sessão |
| **sessão** | cookie `__Host-goa_session` válido |
| **sessão+csrf** | sessão + header `x-csrf-token` ligado a ela + `Origin` exato |
| **admin** | sessão de conta com `platform_admin = true`; respostas `404` para as demais |

Toda resposta é `no-store` com `x-content-type-options: nosniff` e
`x-frame-options: DENY`, e o corpo é sempre JSON. Erros seguem
`{ "error": "<código>", "message": "<texto>", "details"? }`; erros inesperados
trazem um `requestId` (corpo e header `x-request-id`). As mensagens do servidor
são em português; a interface traduz por `error` (`errors.byCode` nas mensagens).

## Páginas

Todas as páginas abaixo montam a mesma SPA (`app/GoaApp.tsx`); a rota só decide
a tela inicial (`app/goa/navigation.ts`), e o botão Voltar sobe sempre para a tela
pai, nomeada no botão.

| Rota | Acesso | O que abre |
| --- | --- | --- |
| `/` | público | Início (ou o login). `?invite=<token>` abre um convite |
| `/sobre` · `/feedback` | público | Sobre o Goa · formulário de sugestões |
| `/invites/:token` | público | Convite de grupo ou desafio |
| `/modelos` · `/modelos/:id` | público | Galeria de modelos e a prévia somente leitura de um deles |
| `/results/:token` | público (por token) | Vitrine pública; a busca é pelo hash do token, e desde a migração `0035` o token completo também fica no banco para reapresentar o link a quem pode gerenciar |
| `/personal` | sessão | **Meu espaço** — os desafios pessoais (link no cabeçalho) |
| `/personal/trash` · `/groups/:id/trash` | sessão | Lixeira do espaço pessoal / do grupo |
| `/catalog` · `/catalog/:itemId` | sessão | Acervo pessoal e um item dele |
| `/groups/:id` · `/groups/:id/catalog[/:itemId]` | sessão (membro) | Grupo e o acervo dele |
| `/challenges/new` · `/challenges/:id` · `/challenges/:id/manage` | sessão | Criar desafio; participar; gerenciar (owner/admin) |
| `/admin` | admin | Console privado do desenvolvedor (`app/admin/`); componente de servidor: sem `platform_admin` responde `notFound()` |

## Saúde e bootstrap

| Método · rota | Acesso | Corpo | Retorna |
| --- | --- | --- | --- |
| `GET /api/health` | público | — | `{ ok, database }` (ping no PostgreSQL) |
| `GET /api/bootstrap` | público | — | `{ csrfToken, user, limits, groups, challenges, memberRequests, personalWorkspaceId }`. `user` é `null` quando deslogado |
| `POST /api/feedback` | público (aceita anônimo) | `{ message, … }` | grava a sugestão sem conteúdo de grupos; `429 feedback_throttled` |

## Autenticação e conta

| Método · rota | Acesso | Corpo | Retorna / efeito |
| --- | --- | --- | --- |
| `POST /api/auth/register` | origem | `{ name, username, password, email? }` | `201 { user, csrfToken }` + `Set-Cookie`. `409 username_taken` / `409 email_taken` |
| `POST /api/auth/login` | origem | `{ username, password }` — `username` aceita nome de usuário **ou** e-mail | `200 { user, csrfToken }` + `Set-Cookie`. `401 invalid_credentials`, `429 login_limited` (10 falhas em 15 min) |
| `POST /api/auth/logout` | sessão+csrf | — | `200 { ok }` + cookie limpo; revoga a sessão atual |
| `PATCH /api/account` | sessão+csrf | `{ name?, currentPassword?, newPassword? }` | `200 { user }`. Só o nome e a senha são editáveis; passar `email` ou `username` dá `403 email_locked` / `403 username_locked`. Trocar a senha exige `currentPassword` e revoga as outras sessões |
| `POST /api/account/deactivate` | sessão+csrf | `{}` | `200 { ok }` + cookie limpo — reversível; revoga sessões, o conteúdo fica. Relogar cai na tela de reativação; toda mutação responde `403 account_deactivated` |
| `POST /api/account/reactivate` | sessão+csrf | `{}` | `200 { user }` — limpa `deactivated_at` |
| `GET /api/account/deletion-preview` | sessão | — | `{ ownedGroups[], memberships, publishedChallenges }` — o que a exclusão permanente vai fazer |
| `POST /api/account/delete` | sessão+csrf | `{ password }` | `200 { ok }` + cookie limpo — **irreversível**. Apaga de vez espaço pessoal e grupos solo; transfere grupos compartilhados; anonimiza contribuições; despublica vitrines; `403 invalid_password` |

Não há redefinição de senha por link. `POST /api/auth/forgot` e
`POST /api/auth/reset` foram retirados (respondem `404`) até existir um canal de
e-mail para entregar o link — e-mail está fora do escopo da V1 (`ROADMAP.md` §1).
Quem está logado troca a senha em `PATCH /api/account` com a senha atual. A
tabela `password_reset_tokens` fica no banco, dormente.

## Grupos, pessoas e convites

| Método · rota | Acesso | Corpo | Retorna / efeito |
| --- | --- | --- | --- |
| `POST /api/groups` | sessão+csrf | `{ name, description? }` | `201 { id, name, role: "owner", memberCount }`. `403 group_limit` ao passar de `MAX_GROUPS_PER_OWNER` (6) |
| `PATCH /api/groups/:id` | sessão+csrf (owner/admin) | `{ name?, description?, recommendationsEnabled? }` | `200` com o grupo atualizado. `recommendationsEnabled: false` desliga os indicadores (ver Acervo) |
| `DELETE /api/groups/:id` | sessão+csrf (owner) | — | `200 { id, deleted: true }` — vai para a lixeira (`trash_items`); restaura/exclui em definitivo via `/api/personal/trash/*`. Vitrines publicadas do grupo saem do ar |
| `POST /api/groups/:id/members` | sessão+csrf (owner/admin) | `{ username }` | convida uma conta existente **por @usuário**. Nunca adiciona direto: abre um pedido `pending` que a pessoa aceita ou recusa. Idempotente para membro ativo ou pedido aberto |
| `PATCH /api/groups/:id/members/:userId` | sessão+csrf (owner) | `{ role: "admin" \| "participant" }` | promove/rebaixa; o papel do owner e de quem saiu não mudam |
| `POST /api/member-requests/:id/accept` · `…/decline` | sessão+csrf (quem foi convidado) | `{}` | responde ao pedido; aceitar associa ao grupo. `403 group_full` acima de `MAX_MEMBERS_PER_GROUP` (62) |
| `POST /api/member-requests/:id/cancel` | sessão+csrf (owner/admin) | `{}` | retira o pedido antes da resposta |
| `POST /api/groups/:id/leave` | sessão+csrf (membro; o owner não sai) | `{}` | saída voluntária: a pessoa some das listas e passa a aparecer como "quem já saiu", e qualquer vitrine pública deixa de mostrar o nome dela na hora |
| `POST /api/groups/:id/invites` | sessão+csrf (owner/admin) | `{ expiresInDays?, maxUses?, challengeId? }` | `201 { id, token, url, kind, groupId, groupName, challengeId, challengeTitle, expiresAt, maxUses }`. Com `challengeId`, o alvo deve pertencer ao grupo e não pode estar encerrado |
| `GET /api/invites/:token` | público (sensível à sessão) | — | `{ kind, groupId, groupName, challengeId, challengeTitle, invitedBy, expiresAt, accepted, status }`. Com sessão, `accepted/status` reconhecem o aceite anterior da conta |
| `POST /api/invites/:token` | sessão+csrf | `{}` | `{ kind, groupId, groupName, challengeId, challengeTitle, accepted, idempotent }` — sempre associa ao grupo; convite de desafio também cria `challenge_participants`, na mesma transação. `403 group_full` |

## Desafios

Criar: `POST /api/groups/:id/challenges` (owner/admin, `403 challenge_limit` acima de
`MAX_CHALLENGES_PER_GROUP`, 6) ou `POST /api/personal/challenges` (o espaço pessoal),
ambos `201 { id, challengeId, status: "draft" }`. Corpo:

```text
{ recipe: "cinema"|"library"|"bookshelf"|"habit"|"tables"|"custom",
  title, description?, ruleSections?: [{ title, description }],
  startsOn?, endsOn?, timeZone?, expectation?, generateDaily?,
  fields[]?, items[]?, participantIds[],
  libraries?: [{ libraryId | libraryKind }],   // além das da própria receita
  libraryId?, libraryKind?,                     // biblioteca única de uma receita custom
  collectsEntryDate?,                           // a data opcional de cada registro
  itemDates?,                                   // "cada item tem data e hora"
  answerScope?, sharedEditPolicy? }             // resposta principal compartilhada
```

A receita abre os tipos de registro, os campos e as métricas de análise; `fields`
sobrescreve os campos do tipo primário. Cinema liga a biblioteca Screens, Tables a
biblioteca Tables do espaço (criada na primeira vez), Library/Bookshelf a Pages e
`custom` só o que for nomeado. Cada item pode trazer `scheduledAt` (ver Acervo) e
`libraryId|libraryKind` quando há mais de uma biblioteca (`409 library_required`).
As quatro chaves antigas (`cine_free`, `cine_curated`, `reading_club`,
`reading_daily`) continuam sendo **lidas** de desafios existentes, mas são recusadas
na criação; clientes antigos ainda podem enviar `template: "cine"|"reading"` ou
`submissionMode` cru.

`startsOn` e `endsOn` formam um período opcional: enviados juntos ou omitidos
juntos (`null` também remove ambos no rascunho). Aceita datas passadas; a única
relação obrigatória é `endsOn >= startsOn`. Sem período o desafio não expira e é
encerrado manualmente (um desafio pessoal sem datas é uma **lista viva** e nasce
ativo).

| Método · rota | Acesso | Corpo | Retorna / efeito |
| --- | --- | --- | --- |
| `GET /api/challenges/:id` | sessão (membro do grupo) | — | Detalhe: `recipeKey`, `libraries[]`, `entryTypes[]` (cada um com `purpose`/`fields`/`answerScope`), `fields` (do tipo primário), `items`, `checkpoints`, `participants`, `metrics` (com `series` quando `groupBy != none`), `result`. Rascunho só para owner/admin |
| `PATCH /api/challenges/:id` | sessão+csrf (owner/admin) | `{ title?, description?, ruleSections?, startsOn?, endsOn?, timeZone?, … }` | desafio atualizado; a agenda só muda no rascunho e início/término devem ser enviados ou removidos em par. Cronograma, campos e itens continuam editáveis com o desafio ativo; só o que deixaria dados órfãos dá `409` |
| `DELETE /api/challenges/:id` | sessão+csrf (owner/admin) | — | `200 { id, deleted: true }` — lixeira |
| `GET /api/challenges/:id/preflight` | sessão+csrf (owner/admin) | — | prontidão: erros que bloqueiam e avisos; o mesmo cálculo é o portão do `transition` para `active` |
| `POST /api/challenges/:id/transition` | sessão+csrf (owner/admin) | `{ status: "active" \| "closed" }` | `draft→active→closed`; um encerrado pode ser reaberto. Encerrar monta a vitrine inicial |
| `POST /api/challenges/:id/participants` | sessão+csrf (owner/admin) | `{ replace: true, participantIds[] }` | participantes ativos |
| `PATCH /api/challenges/:id/prefs` · `PATCH /api/challenges/prefs/order` | sessão+csrf | `{ pinned?, colorTag? }` · `{ ids[] }` | preferências **do próprio usuário** para a tela Início (fixar, cor, ordem) |
| `PATCH /api/challenges/:id/consent` | sessão+csrf (participante) | `{ nameConsent }` | autoriza/revoga o próprio nome numa vitrine pública |
| `PATCH /api/challenges/:id/expectation` | sessão+csrf (owner/admin) | `{ enabled }` | liga/desliga a expectativa (só no rascunho; sair bloqueia se já há registros) |
| `POST /api/challenges/:id/duplicate` | sessão+csrf (owner/admin nos dois grupos) | `{ targetGroupId, title?, mode? }` | `201 { challengeId, skippedProperties[] }` — rascunho estrutural em outro grupo. `mode`: `structure_and_items` (padrão) ou `structure`. Nunca copia participantes, registros, resultados, convites ou tokens |
| `POST /api/challenges/:id/template` · `DELETE …/template` | sessão+csrf (platform_admin + owner/admin do desafio) | `{ summary? }` | publica/retira o desafio na galeria de modelos |

### Campos, tipos de registro, métricas

| Método · rota | Acesso | Corpo | Retorna / efeito |
| --- | --- | --- | --- |
| `POST /api/challenges/:id/fields` | sessão+csrf (owner/admin) | `{ entryTypeId?, replace, archiveMissing, fields[] }` | `201` — `entryTypeId` escolhe o tipo de registro (default: o primário); campos em uso são arquivados, nunca apagados |
| `POST /api/challenges/:id/entry-types` | sessão+csrf (owner/admin) | `{ name, sharedEditPolicy, field }` | adiciona uma **resposta compartilhada** (uma por item para o grupo) |
| `PATCH /api/challenges/:id/entry-types/:typeId` | sessão+csrf (owner/admin) | `{ visibilityPolicy?, sharedEditPolicy? }` | muda quem vê as respostas e, nas compartilhadas, quem edita |
| `DELETE /api/challenges/:id/entry-types/:typeId` | sessão+csrf (owner/admin) | query `deleteAnswers=1`, `archiveMetrics=1` | arquiva o tipo. `409 entry_type_has_entries` (`details.count`) e `409 entry_type_has_metrics` (`details.metrics`) pedem confirmação; com as flags apaga as respostas e arquiva as métricas junto |
| `POST /api/challenges/:id/metrics` · `PATCH …/metrics/:metricId` · `DELETE …/metrics/:metricId` | sessão+csrf (owner/admin) | `{ operation, fieldId?, groupBy?, label, minSample?, bayesPriorWeight?, ... }` | só enums: `sum` `average` `count` `min` `max` `completion_rate` `bayesian_average` `spread` `surprise` `indicator_bias`; combinações incoerentes dão `409 invalid_metric_grouping` |

### Itens, etapas e bibliotecas do desafio

| Método · rota | Acesso | Corpo | Retorna / efeito |
| --- | --- | --- | --- |
| `POST /api/challenges/:id/items` | sessão+csrf (owner/admin) | itens (por objeto, com `libraryId\|libraryKind`) ou `{ generate: { frequency, startsOn, endsOn } }` (diário com período) | `201`; no diário sem prazo os check-ins são criados sob demanda pelo endpoint de registros |
| `POST /api/challenges/:id/items/preview` | sessão+csrf (owner/admin) | `{ items[] }` (JSON colado) | prévia sem gravar: linhas inválidas, chaves desconhecidas, duplicatas no acervo e no desafio |
| `PATCH /api/challenges/:id/items/:itemId` | sessão+csrf (owner/admin) | `{ title?, description?, author?, checkpointId?, recommendedByUserId?, recommendedByExternalId?, originNote? }` | item atualizado sem trocar o identificador; bloqueado após o encerramento |
| `DELETE /api/challenges/:id/items/:itemId` | sessão+csrf (owner/admin) | — | arquiva um item sem registros; `409 item_has_data` se já houver registros |
| `POST /api/challenges/:id/checkpoints` | sessão+csrf (owner/admin) | `{ checkpoints: [{ id?, title, description?, kind, startsAt?, dueAt? }] }` | monta a lista de **etapas** numa transação; uma com registros não sai (`409 checkpoint_has_entries`) |
| `POST /api/challenges/:id/items/assign` | sessão+csrf (owner/admin) | `{ assignments: [{ itemId, checkpointId \| null }] }` | liga itens a etapas em massa |
| `POST /api/challenges/:id/libraries` · `DELETE …/libraries/:libraryId` | sessão+csrf (owner/admin) | `{ libraryId \| libraryKind }` | liga/desliga uma biblioteca do desafio; desligar com itens dela dá `409 library_in_use` |

### Registros

| Método · rota | Acesso | Corpo | Efeito |
| --- | --- | --- | --- |
| `POST /api/challenges/:id/entries` | sessão+csrf (participante) | `{ itemId?/checkpointId?, entryTypeId?, occurredOn?, values, expectedUpdatedAt? }` | `201` — cardinalidade e alvo vêm do tipo de registro; `entryTypeId` escolhe o tipo (default: o primário). `409 expectation_locked` ao editar a expectativa depois de avaliar; `409 watch_in_future` para data futura; `409 item_not_open` antes de `opens_at`; em resposta compartilhada, `409 shared_conflict` com o valor atual quando outra pessoa salvou antes |
| `GET /api/challenges/:id/entries` | sessão (membro) | — | `{ entries: [...] }` filtrados pela visibilidade de cada tipo (`visibility_policy`); cada pessoa vê só o que a política permite |
| `PATCH /api/entries/:id` | sessão+csrf | `{ values, expectedUpdatedAt? }` | Só o autor altera o próprio registro (owner/admin **não** mexem em registros de outra pessoa). Numa resposta compartilhada vale a política: `members_fill_admin_corrects` (depois de preenchida só owner/admin corrigem, `403 shared_locked`) ou `members_can_edit`. `409 expectation_locked` se a expectativa já foi travada |
| `DELETE /api/entries/:id` | sessão+csrf | — | manda o registro para a lixeira (soft delete), com as mesmas regras de autoria/política do `PATCH` |

### Vitrine e publicação

| Método · rota | Acesso | Corpo | Efeito |
| --- | --- | --- | --- |
| `POST /api/challenges/:id/results` | sessão+csrf (owner/admin) | `{ headline?, summary?, metricIds[], comments[], allComments?, includeRankings?, includeAffinity?, anonymizeParticipants?, showSchedule? }` | cura a vitrine **a qualquer momento**; nunca publica. `metricIds: []` inclui todas as métricas |
| `PATCH /api/challenges/:id/results/blocks` | sessão+csrf (owner/admin) | `{ blocks: [{ id, visible }] }` na ordem desejada | reordena/oculta blocos sem mudar valores |
| `POST /api/challenges/:id/results/publish` | sessão+csrf (owner/admin) | `{ rotateLink? }` | liga o link público (`409 challenge_not_closed` antes do encerramento, exceto lista viva pessoal); `rotateLink` invalida o anterior. Retorna `url` |
| `DELETE /api/challenges/:id/results` | sessão+csrf (owner/admin) | — | despublica (limpa hash e token) |
| `GET /api/results/:token` | público (por token) | — | `{ challenge: { title, participants, result } }` — conteúdo e mascaramento de identidades calculados **ao vivo** |

## Acervo, bibliotecas e indicadores

Um espaço é um grupo (`/api/groups/:id/…`) ou o espaço pessoal (`/api/personal/…`);
as duas famílias têm o mesmo formato. Nas rotas por item e por biblioteca o servidor
deriva o espaço do próprio objeto (`/api/catalog/…`).

| Método · rota | Acesso | Corpo / retorna |
| --- | --- | --- |
| `GET …/catalog` | membro / dono | `{ items: [{ id, kind, title, year, author?, genres, roundCount, challengeCount, ratingAvg, ratingCount, recommendedBy?, scheduledAt? }] }`. `challengeCount` = em quantos desafios o item está (0 = solto) |
| `GET …/catalog/:itemId` | membro / dono | o item + `rounds: [{ challengeId, title, status, startsOn, endsOn, recommendedBy, ratingAvg, ratingCount }]` |
| `GET …/catalog/search?title=&kind=\|libraryId=` | membro / dono | candidatos a "usar o existente" ao criar um item |
| `POST …/catalog/items` | owner/admin / dono | `{ libraryId \| kind, title, year?, author?, scheduledAt?, attributes?, recommendedBy… }` — filme/livro casam por título(+autor); outras bibliotecas nunca fundem sozinhas |
| `PATCH /api/catalog/:itemId` · `PATCH /api/personal/catalog/:itemId` | owner/admin / dono | `{ title?, year?, runtimeMinutes?, pageCount?, genres?, scheduledAt?, attributes?, recommender… }` — afeta todas as rodadas |
| `DELETE /api/catalog/:itemId` · `DELETE /api/personal/catalog/:itemId` | owner/admin / dono | vai para a lixeira; `409 catalog_item_in_use` enquanto um desafio em andamento o usa |
| `POST …/catalog/remove` | owner/admin / dono | `{ itemIds[] }` (até 500) → `{ removed, removedIds[], skipped: [{ id, title, reason: "in_use" \| "not_found" }] }` — remoção em lote |
| `GET …/catalog/libraries` · `POST …/catalog/libraries` | membro; owner/admin / dono | lista as bibliotecas · cria `{ label, source?: "tables" \| "custom" }` |
| `PATCH /api/catalog/libraries/:id` | owner/admin / dono | `{ label }` — renomear nunca muda `kind` |
| `DELETE /api/catalog/libraries/:id` | owner/admin / dono | `?deleteItems=1`. Arquiva a biblioteca e manda os itens para a lixeira. `409 library_builtin` (Screens/Pages), `409 library_has_items` (`details.count`), `409 library_busy` (`details.challenges`) |
| `GET /api/catalog/libraries/:id/properties` · `PATCH …/properties/:key` | membro; owner/admin / dono | o editor único de propriedades nativas + personalizadas · `{ label?, hidden?, position? }` |
| `GET/POST …/catalog-attributes` · `DELETE …/catalog-attributes/:id` | membro; owner/admin / dono | propriedades personalizadas tipadas de uma biblioteca (arquivar recusa se já há valor) |
| `GET/POST …/catalog/recommenders` · `PATCH /api/catalog/recommenders/:id` | membro; owner/admin / dono | indicadores externos (nome guardado do espaço; nunca públicos) · renomear |

`scheduledAt` (data do evento de um item): `{ startsOn, endsOn?, timeZone }` para
dias inteiros ou `{ startsAt, endsAt?, timeZone }` para um instante; só é devolvido
quando a propriedade está visível na biblioteca. Com `groups.recommendations_enabled =
false`, `recommendedBy`/`originNote` somem das leituras e defini-los dá
`409 recommendations_disabled` (limpar continua permitido).

## Lixeira (`/api/{personal|groups/:id|challenges/:id}/trash/*`)

Lixeira **permanente e do usuário** — nada expira. O serviço deriva o papel do
objeto, não da URL. `kind ∈ {group, challenge, catalog_item, entry,
challenge_item, checkpoint, entry_type, field, field_option, metric,
catalog_attribute_def}`.

| Método · rota | Retorna / efeito |
| --- | --- |
| `GET /api/personal/trash` · `GET /api/groups/:id/trash` | `{ items: [{ kind, id, label, deletedAt, deletedBy, dependencies[], parentTrashed, blocked }] }` |
| `GET /api/challenges/:id/archive` | estrutura arquivada do desafio + registros removidos (participante vê só os próprios) |
| `POST …/trash/preview` `{ kind, id }` | `{ dependencies[], blocked, confirmation: "simple"\|"count"\|"name" }` |
| `POST …/trash/restore` `{ kind, id, rename? }` | `409 parent_trashed` / `409 name_conflict`; restaura mantendo o id. Restaurar um item de uma biblioteca excluída traz a biblioteca de volta |
| `POST …/trash/purge` `{ kind, id, confirmation, reason? }` | irreversível; `409 not_in_trash` se o objeto não estiver na lixeira; `409` de confirmação; `reason` obrigatório p/ registro de terceiro |
| `POST /api/personal/trash/empty` · `POST /api/groups/:id/trash/empty` | esvazia o que a lixeira permite excluir em definitivo |

## Modelos

Projeções só-leitura de desafios que um `platform_admin` publicou. Nunca expõem
participantes, registros, resultados nem o grupo de origem.

| Método · rota | Acesso | Retorna |
| --- | --- | --- |
| `GET /api/templates` | público | `{ templates: [{ id, title, summary, submissionMode, ruleCount, fieldCount, itemCount, metricCount, participantCount, publishedAt }] }` |
| `GET /api/templates/:id` | público | `{ id, title, description, summary, ruleSections, submissionMode, durationDays, fields, items, metrics }` — `404` se não for um modelo publicado. A prévia é montada com as mesmas regras de mascaramento da vitrine |
| `POST /api/templates/:id/duplicate` | sessão+csrf (owner/admin do grupo de destino) | `{ targetGroupId, title?, mode? }` → `201 { challengeId, skippedProperties[] }` com um rascunho estrutural no grupo escolhido |

## Administração (`/api/admin/*`)

Todas exigem **admin** (`platform_admin`); qualquer outra conta recebe `404`.
Só expõem metadados — nunca o conteúdo de grupos ou desafios.

| Método · rota | Corpo | Retorna / efeito |
| --- | --- | --- |
| `GET /api/admin/overview` | — | contadores agregados de contas/grupos/desafios/registros (e quantos na lixeira, via `trash_items`) + `pg_database_size` e tamanho por tabela |
| `GET /api/admin/insights?…` | — | uso do produto agregado (bibliotecas, respostas compartilhadas, datas, indicadores…) — só contagens |
| `GET /api/admin/users` | — | por conta: cadastro, última sessão, grupos, sessões ativas, `deactivatedAt` |
| `GET /api/admin/feedback` | — | sugestões recebidas pelo formulário |
| `GET /api/admin/audit?groupId=&entityId=&limit=` | — | eventos de `audit_events` — só valores **estruturais** (`redactForPlatformAdmin`); linhas de espaço pessoal vêm sem `before`/`after`/ids |
| `GET /api/admin/system-audit?limit=` | — | rastro operacional de purgas e exclusão de conta: ator, ação, `entityKind`, **hash** do id, contagens — sem conteúdo |
| `POST /api/admin/users/disable` | `{ userId, disabled }` | liga/desliga `disabled_at`; ao desativar revoga as sessões. Admins e a própria conta são protegidos |
| `POST /api/admin/users/set-admin` | `{ userId, platformAdmin }` | liga/desliga `platform_admin`. Não permite mudar a própria conta (`400 self_target`) |
| `POST /api/admin/users/revoke-sessions` | `{ userId }` | revoga todas as sessões ativas da conta |

O `/admin` não redefine senha e não mostra pedidos de redefinição pendentes: um
link emitido pelo administrador seria assumir a conta (ele vê o e-mail aqui), e o
fluxo público depende de um canal de e-mail que a V1 não tem (ver "Autenticação e conta").
