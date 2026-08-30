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

Toda resposta é JSON `no-store` com `x-content-type-options: nosniff` e
`x-frame-options: DENY`. Erros seguem `{ "error": "<código>", "message": "<texto>" }`.

## Páginas

| Rota | Acesso | O que é |
| --- | --- | --- |
| `GET /` | público | SPA (`app/GoaApp.tsx`). `?invite=<token>` abre um convite; `?reset=<token>` abre a criação de nova senha |
| `GET /admin` | admin | Console privado do desenvolvedor (`app/admin/`). Componente de servidor: sem `platform_admin` responde `notFound()` |
| `GET /results/[token]` | público (por token) | Vitrine pública de um desafio encerrado; o banco guarda só o hash do token |

## Saúde e bootstrap

| Método · rota | Acesso | Corpo | Retorna |
| --- | --- | --- | --- |
| `GET /api/health` | público | — | `{ ok, database }` (ping no PostgreSQL) |
| `GET /api/bootstrap` | público | — | `{ csrfToken, user, limits, groups, challenges }`. `user` é `null` quando deslogado |

## Autenticação e conta

| Método · rota | Acesso | Corpo | Retorna / efeito |
| --- | --- | --- | --- |
| `POST /api/auth/register` | origem | `{ name, username, password, email? }` | `201 { user, csrfToken }` + `Set-Cookie`. `409 username_taken` / `409 email_taken` |
| `POST /api/auth/login` | origem | `{ username, password }` — `username` aceita nome de usuário **ou** e-mail | `200 { user, csrfToken }` + `Set-Cookie`. `401 invalid_credentials`, `429 login_limited` |
| `POST /api/auth/logout` | sessão+csrf | — | `200 { ok }` + cookie limpo; revoga a sessão atual |
| `POST /api/auth/forgot` | origem | `{ email }` | `202 { ok }` **sempre** (não revela se a conta existe). Registra o pedido; o admin gera o link em `/admin` |
| `POST /api/auth/reset` | origem | `{ token, password }` | `200 { user, csrfToken }` + `Set-Cookie` (login automático). Marca o token usado e revoga todas as sessões antigas da conta. `400 invalid_reset_token` |
| `PATCH /api/account` | sessão+csrf | `{ name?, currentPassword?, newPassword? }` | `200 { user }`. Só o nome e a senha são editáveis; passar `email` ou `username` dá `403 email_locked` / `403 username_locked`. Trocar a senha exige `currentPassword` e revoga as outras sessões |

## Grupos

| Método · rota | Acesso | Corpo | Retorna / efeito |
| --- | --- | --- | --- |
| `POST /api/groups` | sessão+csrf | `{ name, description? }` | `201 { id, name, role: "owner", memberCount }`. `403 group_limit` ao passar de `MAX_GROUPS_PER_OWNER` (6) |
| `PATCH /api/groups/:id` | sessão+csrf (owner/admin) | `{ name?, description? }` | `200 { id, name, description }` |
| `DELETE /api/groups/:id` | sessão+csrf (owner) | — | `200 { id, deleted: true }` — vai para a lixeira (`deleted_at`), some do app até ser purgado no `/admin` |
| `POST /api/groups/:id/members` | sessão+csrf (owner/admin) | `{ username }` | `200 { groupId, member, added, restored, idempotent }` — busca exata e normalizada; adiciona ou restaura como participante e preserva admin restaurado. `403 group_full` ao passar de `MAX_MEMBERS_PER_GROUP` (62) |
| `POST /api/groups/:id/invites` | sessão+csrf (owner/admin) | `{ expiresInDays?, maxUses?, challengeId? }` | `201 { id, token, url, kind, groupId, groupName, challengeId, challengeTitle, expiresAt, maxUses }`. Com `challengeId`, o alvo deve pertencer ao grupo e não pode estar encerrado |
| `POST /api/groups/:id/challenges` | sessão+csrf (owner/admin) | ver "criar desafio" abaixo | `201 { id, challengeId, status: "draft" }`. `403 challenge_limit` ao passar de `MAX_CHALLENGES_PER_GROUP` (6) |

Criar desafio: `{ title, description?, ruleSections?: [{ title, description }], startsOn, endsOn, submissionMode:
"item"|"daily"|"free", template?, fields[], items[], generateDaily?, participantIds[] }`.

## Convites

| Método · rota | Acesso | Corpo | Retorna |
| --- | --- | --- | --- |
| `GET /api/invites/:token` | público (sensível à sessão) | — | `{ kind, groupId, groupName, challengeId, challengeTitle, invitedBy, expiresAt, accepted, status }`. Com sessão, `accepted/status` reconhecem o aceite anterior da conta |
| `POST /api/invites/:token` | sessão+csrf | `{}` | `{ kind, groupId, groupName, challengeId, challengeTitle, accepted, idempotent }` — sempre associa ao grupo; convite de desafio também cria `challenge_participants`, na mesma transação. `403 group_full` quando o grupo já tem `MAX_MEMBERS_PER_GROUP` (62) pessoas |

## Desafios

| Método · rota | Acesso | Corpo | Retorna / efeito |
| --- | --- | --- | --- |
| `GET /api/challenges/:id` | sessão (membro do grupo) | — | Detalhe completo: campos, itens, participantes, métricas, resultado. Rascunho só para owner/admin |
| `PATCH /api/challenges/:id` | sessão+csrf (owner/admin) | `{ title?, description?, ruleSections?: [{ title, description }], startsOn?, endsOn? }` | desafio atualizado |
| `DELETE /api/challenges/:id` | sessão+csrf (owner/admin) | — | `200 { id, deleted: true }` — lixeira |
| `POST /api/challenges/:id/participants` | sessão+csrf (owner/admin) | `{ replace: true, participantIds[] }` | participantes ativos |
| `POST /api/challenges/:id/fields` | sessão+csrf (owner/admin) | `{ replace, archiveMissing, fields[] }` | `201` — campos em uso são arquivados, nunca apagados |
| `POST /api/challenges/:id/items` | sessão+csrf (owner/admin) | itens (por objeto) ou `{ generate: { frequency, startsOn, endsOn } }` (por dia) | `201` |
| `PATCH /api/challenges/:id/items/:itemId` | sessão+csrf (owner/admin) | `{ title?, description? }` | item/checkpoint atualizado sem trocar o identificador; bloqueado após o encerramento |
| `POST /api/challenges/:id/metrics` | sessão+csrf (owner/admin) | `{ operation, fieldKey?, label, ... }` | `201` — só enums (`sum`, `average`, `count`, `min`, `max`, `completion_rate`) |
| `POST /api/challenges/:id/entries` | sessão+csrf (participante) | `{ itemId?/checkpointId?, values }` | `201` — um registro ativo por item/dia |
| `POST /api/challenges/:id/transition` | sessão+csrf (owner/admin) | `{ status: "active" \| "closed" }` | `draft→active→closed`; encerrar congela os dados e gera blocos de resultado |
| `POST /api/challenges/:id/duplicate` | sessão+csrf (owner/admin nos dois grupos) | `{ title?, targetGroupId }` | `201` — cria um rascunho estrutural em outro grupo; nunca copia participantes, registros, resultados, convites ou tokens |
| `POST /api/challenges/:id/results` | sessão+csrf (owner/admin) | `{ headline?, summary?, metricIds[], commentKeys[], publish? }` | curadoria da vitrine; ao publicar retorna `url` pública |
| `GET /api/challenges/:id/entries` | sessão (owner/admin) | — | `{ entries: [...] }` para a revisão |
| `GET /api/challenges/:id/export.csv` | sessão (owner/admin) | — | `text/csv`; células que virariam fórmula são neutralizadas |

## Registros

| Método · rota | Acesso | Corpo | Efeito |
| --- | --- | --- | --- |
| `PATCH /api/entries/:id` | sessão+csrf | `{ values, reason? }` | Correção. Participante só altera o próprio; owner/admin corrigem com `reason` que vai para a auditoria |

## Resultados

| Método · rota | Acesso | Retorna |
| --- | --- | --- |
| `GET /api/results/:token` | público (por token) | `{ challenge: { title, participants, result } }` — só desafios encerrados e publicados |

## Administração (`/api/admin/*`)

Todas exigem **admin** (`platform_admin`); qualquer outra conta recebe `404`.
Só expõem metadados — nunca o conteúdo de grupos ou desafios.

| Método · rota | Corpo | Retorna / efeito |
| --- | --- | --- |
| `GET /api/admin/overview` | — | contadores de contas/grupos/desafios/registros/lixeira + `pg_database_size` e tamanho por tabela |
| `GET /api/admin/users` | — | por conta: cadastro, última sessão, grupos, sessões ativas, `pendingReset` |
| `GET /api/admin/trash` | — | grupos/desafios/registros soft-deletados: rótulo, quando, por quem, itens embutidos |
| `GET /api/admin/audit?groupId=&entityId=&limit=` | — | eventos de `audit_events` com autor, antes/depois; filtro por grupo/entidade |
| `POST /api/admin/trash/purge` | `{ kind: "group"\|"challenge"\|"entry", id }` | apaga de vez, em ordem de dependência (o schema é cheio de `RESTRICT`) |
| `POST /api/admin/users/disable` | `{ userId, disabled }` | liga/desliga `disabled_at`; ao desativar revoga as sessões. Admins e a própria conta são protegidos |
| `POST /api/admin/users/set-admin` | `{ userId, platformAdmin }` | liga/desliga `platform_admin`. Não permite mudar a própria conta (`400 self_target`) |
| `POST /api/admin/users/revoke-sessions` | `{ userId }` | revoga todas as sessões ativas da conta |
| `POST /api/admin/users/reset-link` | `{ userId }` | `{ url, expiresAt }` — link de uso único (`/?reset=<token>`) para o admin repassar |
