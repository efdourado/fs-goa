# API

`app/api/[...path]/route.ts` é a fonte de verdade: um roteador fino que delega para
`lib/`. Ao mexer numa rota, atualize aqui.

## Convenções

| Acesso | Exigência |
| --- | --- |
| público | nada |
| origem | header `Origin` igual a `APP_ORIGIN` |
| sessão | cookie `__Host-goa_session` |
| mutação | sessão + `x-csrf-token` ligado a ela + `Origin` exata |
| admin | conta `platform_admin`; as demais recebem `404` |

Corpo sempre JSON e `no-store`. Erros: `{ error, message, details? }`, a interface
traduz pelo `error` (`errors.byCode`); erros inesperados trazem `requestId`.
Mutações de conta desativada respondem `403 account_deactivated`. Papéis de grupo:
`owner` > `admin` > `participant`; "dono" abaixo é quem gerencia o espaço.

## Páginas

Todas montam a SPA (`GoaApp`), salvo as marcadas **servidor**.

| Rota | O que abre |
| --- | --- |
| `/` | Início (deslogado: a capa com os modelos em destaque) |
| `/start` | criação guiada por toques (`?personal=1`, `?group=:id`) |
| `/sobre` · `/feedback` | Sobre · sugestões |
| `/invites/:token` | convite de grupo ou desafio |
| `/modelos` · `/modelos/:id` | galeria de modelos · prévia de um |
| `/personal` · `/personal/trash` | Início · lixeira pessoal |
| `/catalog[/:itemId]` · `/groups/:id/catalog[/:itemId]` | acervo pessoal · do grupo |
| `/groups/:id` · `/groups/:id/trash` | grupo · lixeira do grupo |
| `/challenges/new` · `/challenges/:id` · `/challenges/:id/manage` | criar · participar · gerenciar |
| `/challenges/:id/export` | **servidor**, o documento imprimível (salvar como PDF) |
| `/results/:token` | **servidor**, o fio público, anônimo por padrão |
| `/admin` | **servidor**, console do `platform_admin` |

## Conta

| Rota | Acesso | |
| --- | --- | --- |
| `GET /api/health` | público | ping no banco |
| `GET /api/bootstrap` | público | `{ csrfToken, user, limits, groups, challenges, memberRequests, personalWorkspaceId, homeView }` |
| `POST /api/auth/register` · `login` | origem | login aceita usuário **ou** e-mail; `429 login_limited` |
| `POST /api/auth/logout` | mutação | revoga a sessão atual |
| `PATCH /api/account` | mutação | nome e senha (a troca exige a senha atual) |
| `PATCH /api/account/home-view` | mutação | `{ layout, order, hidden }` do Início |
| `POST /api/account/deactivate` · `reactivate` | mutação | reversível |
| `GET /api/account/deletion-preview` · `POST /api/account/delete` | sessão · mutação | exclusão definitiva, com `{ password }` |
| `POST /api/feedback` | origem | aceita anônimo |

Sem redefinição por link: `/api/auth/forgot` e `/reset` respondem `404` até haver e-mail.

## Grupos e convites

| Rota | Acesso | |
| --- | --- | --- |
| `POST /api/groups` · `PATCH` · `DELETE /api/groups/:id` | mutação (owner/admin; excluir: owner) | excluir manda para a lixeira |
| `POST /api/groups/:id/members` | mutação (owner/admin) | `{ username }` abre um pedido que a pessoa aceita |
| `PATCH /api/groups/:id/members/:userId` | mutação (owner) | `{ role }` |
| `POST /api/member-requests/:id/accept` · `decline` · `cancel` | mutação | responder ou retirar um pedido |
| `POST /api/groups/:id/leave` | mutação | o owner não sai |
| `GET /api/groups/:id/taste` | sessão (membro) | mapa de gosto: concordância 0–100 por pessoa, só com notas já visíveis |
| `POST /api/groups/:id/invites` | mutação (owner/admin) | link expirável, opcionalmente para um desafio |
| `GET` · `POST /api/invites/:token` | público · mutação | prévia · aceitar |

## Desafios

| Rota | Acesso | |
| --- | --- | --- |
| `POST /api/groups/:id/challenges` · `POST /api/personal/challenges` | mutação | `{ recipe, title, participantIds, items?, fields?, startsOn?, endsOn?, libraries?, … }` → rascunho (lista viva pessoal nasce ativa) |
| `GET /api/challenges/:id` | sessão (membro) | detalhe completo, com `metrics` e `itemScores` (pontuação Goa do que você pode ver) |
| `PATCH` · `DELETE /api/challenges/:id` | mutação (owner/admin) | editar · lixeira |
| `GET /api/challenges/:id/preflight` | sessão (owner/admin) | erros que bloqueiam a ativação e avisos |
| `POST /api/challenges/:id/transition` | mutação (owner/admin) | `{ status: "active" \| "closed" }`; reabrir é permitido |
| `POST /api/challenges/:id/participants` | mutação (owner/admin) | `{ replace, participantIds }` |
| `POST /api/challenges/:id/duplicate` | mutação | `{ targetGroupId, mode }`, só estrutura, nunca registros |
| `PATCH /api/challenges/:id/prefs` · `/api/challenges/prefs/order` | mutação | fixar, cor e ordem no **seu** Início |
| `PATCH /api/challenges/:id/consent` | mutação (participante) | `{ nameConsent }` |
| `PATCH /api/challenges/:id/expectation` | mutação (owner/admin) | liga a expectativa (rascunho) |

**Estrutura** (owner/admin, mutação):

| Rota | |
| --- | --- |
| `POST …/fields` | campos de um tipo de registro; em uso são arquivados |
| `POST …/entry-types` · `PATCH` · `DELETE …/entry-types/:typeId` | resposta compartilhada · visibilidade/edição · arquivar (`?deleteAnswers=1&archiveMetrics=1`) |
| `POST …/metrics` · `PATCH` · `DELETE …/metrics/:id` | métricas por enum; combinações incoerentes dão `409` |
| `POST …/items` · `PATCH` · `DELETE …/items/:itemId` | itens (ou geração diária) |
| `POST …/items/preview` | prévia de uma lista colada, sem gravar |
| `POST …/items/assign` · `POST …/checkpoints` | etapas e itens nelas |
| `POST …/libraries` · `DELETE …/libraries/:id` | a biblioteca do desafio (uma só; trocar só enquanto não há itens, `409 one_library`) |

**Registros e revelação**:

| Rota | Acesso | |
| --- | --- | --- |
| `GET …/entries` | sessão | filtrados pela visibilidade de cada tipo |
| `POST …/entries` | mutação (participante) | `{ itemId?, entryTypeId?, occurredOn?, values, expectedUpdatedAt? }`; `409 shared_conflict`, `expectation_locked` |
| `PATCH` · `DELETE /api/entries/:id` | mutação (autor) | ninguém edita o registro de outra pessoa |
| `POST …/items/:itemId/reveal` | mutação (quem já respondeu, ou owner/admin) | abre as notas seladas do item |

**Publicação e modelos**:

| Rota | Acesso | |
| --- | --- | --- |
| `POST …/results` | mutação (owner/admin) | curadoria (anonimato, destaques), nunca publica sozinha |
| `PATCH …/results/blocks` | mutação (owner/admin) | ordem e visibilidade dos blocos |
| `POST …/results/publish` · `DELETE …/results` | mutação (owner/admin) | ligar (ou `rotateLink`) · desligar o link |
| `GET /api/results/:token` | público | o fio público: nomes mascarados, sem comentários |
| `POST` · `DELETE …/template` · `POST …/template/featured` | mutação (`platform_admin`) | publicar como modelo · destacar na capa |
| `GET /api/templates` · `/api/templates/:id` | público | galeria · prévia (com o fio, se encerrado) |
| `POST /api/templates/:id/duplicate` | mutação | copia a estrutura para um grupo seu |

## Acervo

Um espaço é um grupo (`/api/groups/:id/…`) ou o pessoal (`/api/personal/…`), com as
mesmas rotas; rotas por objeto (`/api/catalog/…`) derivam o espaço do objeto.

| Rota | |
| --- | --- |
| `GET …/catalog` · `…/catalog/shelf` | acervo inteiro · a prateleira (bibliotecas, contagens, últimos de cada uma), `ratingAvg` é a pontuação Goa de 0 a 5 |
| `GET …/catalog/:itemId` · `…/catalog/search` | ficha com o histórico nas rodadas · busca para "usar o existente" |
| `POST …/catalog/items` · `PATCH` · `DELETE /api/catalog/:itemId` | criar · editar · lixeira (`409` se um desafio ativo usa) |
| `POST …/catalog/remove` | remoção em lote, pulando o que está em uso |
| `GET` · `POST …/catalog/libraries` · `PATCH` · `DELETE /api/catalog/libraries/:id` | bibliotecas (Screens/Pages não saem) |
| `GET` · `PATCH /api/catalog/libraries/:id/properties[/:key]` | rótulo, ocultar e ordem de cada propriedade |
| `GET` · `POST …/catalog-attributes` · `DELETE …/:id` | propriedades personalizadas tipadas |
| `GET` · `POST …/catalog/recommenders` · `PATCH /api/catalog/recommenders/:id` | quem indicou, de fora do Goa |

## Lixeira

`/api/personal/trash`, `/api/groups/:id/trash` e `/api/challenges/:id/archive`
listam; `…/trash/preview`, `restore`, `purge` (`{ kind, id, … }`) e `…/trash/empty`
agem. Restaurar mantém o id (`409 parent_trashed`, `name_conflict`); excluir de vez
só a partir da lixeira, com confirmação proporcional.

## Admin

`GET /api/admin/{overview,insights,users,feedback,audit,system-audit}` e
`POST /api/admin/users/{disable,set-admin,revoke-sessions}`, só metadados, nunca
conteúdo de grupos ou desafios.
