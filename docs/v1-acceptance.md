# GOA V1 — gate final (ROADMAP §15–17)

**Estado:** os componentes dos tópicos 1–17 existem em `main` e os gates técnicos
estão verdes, mas a V1 **ainda não está pronta para divulgação aberta**. Uma
revisão de código (setembro/2026) encontrou 5 bloqueadores P0 — já corrigidos e
cobertos por teste (ver "Correções P0" abaixo) — e uma lista de P1/P2 que precisa
ser tratada antes do beta ("Pendências"). Este documento mapeia o cenário do §16
e a definição de pronto do §17, e é honesto sobre o que falta.

Gates verdes na entrega: `npm run typecheck`, `npm run lint`,
`npm run test:unit` (114), `npm run test:integration` (84), `npm run build`,
`npx drizzle-kit check`. Ressalva: o teste de aceite chama o roteador da API
diretamente — não abre a interface nem percorre telas; falta um teste real de
navegador.

---

## §16 — cenário autossuficiente (23 passos)

Um único teste executa os 23 passos sem planilha:
`tests/integration/mvp.test.ts` → **"cenário de aceitação V1: grupo de 6, Cinema
com semanas, JSON, expectativa, métricas, Wrapped, publicação, lixeira"**.

| # | Passo | Onde no teste |
| --- | --- | --- |
| 1 | Grupo com 6 participantes | `register` ×6 + convites; `bootstrap` confirma `members.length === 6` |
| 2 | Desafio Cinema | `POST /groups/:id/challenges` `recipe: "cinema"` |
| 3 | Período com 8 checkpoints semanais e 2 pausas | `POST …/checkpoints` com 8 semanas em datas não consecutivas (semanas 4 e 8 vazias) |
| 4 | Colar lista JSON com 30 filmes | `POST …/items/preview` com 30 filmes + linha inválida + chave desconhecida |
| 5 | Revisar erros e duplicidades antes de salvar | assert `summary.invalid === 1`, `duplicatesInChallenge === 1`, `unknownKeys` listadas; `GET :id` mostra 1 item (a prévia não grava) |
| 6 | Indicação opcional a cada filme | commit com `recommendedByUserId` em alguns, `originNote` em outros; assert ambos presentes |
| 7 | Distribuir filmes entre os checkpoints | `POST …/items/assign` |
| 8 | Duração total de cada semana | assert `checkpoints[].totalRuntimeMinutes > 0` |
| 9 | Atributos editoriais opcionais | `POST …/catalog-attributes` "Diretor"; `attributes` no commit de itens. **Ressalva: só por API.** O backend está completo e testado, mas não existe tela para criar/mapear/ver atributos editoriais — este passo do cenário não é cumprível por uma pessoa usando a interface (ver "Pendências") |
| 10 | Expectativa, avaliação e comentário habilitados | `expectation: true` na criação; tipos `expectation` + `rating` |
| 11 | Visibilidade por tipo | `PATCH …/entry-types/:id` → `after_close`; expectativa já `after_own` |
| 12 | Ativar somente após o preflight | `GET …/preflight` `ready === true`, então `transition active` |
| 13 | Registrar expectativas e avaliações | 6 pessoas × 6 filmes (F só 4) |
| 14 | Impedir alteração de expectativa após avaliação | 409 `expectation_locked` |
| 15 | Progresso sem status manual redundante | assert: nenhum tipo `checkin`/`progress` na receita Cinema |
| 16 | Métricas gerais, pessoais e por checkpoint | `average` geral + `average groupBy checkpoint`; toda métrica com `explanation` + `sample` |
| 17 | Afinidade só para pares com amostra suficiente | bloco `affinity` após encerrar; "Aceite F" (4 filmes) fica de fora, os demais (≥5) entram |
| 18 | Encerrar o desafio | `transition closed` |
| 19 | Gerar um Wrapped organizado | `result.blocks` em ordem estável, com métrica + ranking + afinidade + `totalEntries` |
| 20 | Publicar anonimamente, rotacionar e despublicar | `publish` → token; `rotateLink: true` → token novo, antigo 404; `DELETE …/results` → token 404 |
| 21 | Anonimizar quem sai do grupo | membro sai → link publicado cai (404); republicação não traz o nome de volta |
| 22 | Excluir e restaurar um objeto pela lixeira | `DELETE …/items/:id` → some da listagem → aparece em `…/archive` → `…/trash/restore` → volta com o mesmo id |
| 23 | Abrir todas as telas por URL | `screenFromUrl` resolve cada rota; `page.tsx` de cada deep-link existe |

---

## §17 — definição final de pronto

| Item | Evidência |
| --- | --- |
| Os quatro modelos funcionam de ponta a ponta | `tests/recipes.test.ts`; `mvp.test.ts` cobre `cinema` (aceite), `library`/`bookshelf`/`habit` (testes dedicados "fase 1", "estante", "hábito") |
| Estruturas inválidas bloqueadas antes da ativação | `lib/goa/challenges/preflight.ts` + `mvp.test.ts` "preflight bloqueia…"; `transition→active` usa o mesmo cálculo |
| Listas grandes cadastradas rapidamente | `lib/goa/challenges/list-import.ts`; aceite passo 4–6 (32 linhas numa operação) |
| Checkpoints = dias, semanas, sessões e marcos | `challenge_checkpoints.kind ∈ {day, week, session, milestone}`; `mvp.test.ts` "checkpoints e semanas" |
| Expectativa e avaliação integradas | `lib/goa/challenges/entry-types.ts` `seedExpectationType`; aceite passos 13–14; teste "ciclo com expectativa" |
| Visibilidade configurável por tipo | `entry_types.visibility_policy` (4 políticas); `mvp.test.ts` "visibilidade por tipo de registro" |
| Métricas corretas, explicáveis e úteis | `lib/goa/analysis.ts` + `lib/metrics.ts` (`tests/analysis.test.ts`, `tests/metrics.test.ts`); toda métrica calculada tem `explanation` + `sample` |
| O Wrapped é a melhor tela | `resultForChallenge` → `blocks[]` ordenáveis; `mvp.test.ts` "blocos organizáveis" + "Wrapped renderiza blocos" |
| Conteúdo privado inacessível pela administração | `lib/admin.ts` `adminAudit` (supressão de espaço pessoal) + `mvp.test.ts` "o console da plataforma não vê texto privado"; `/admin` sem lixeira global |
| Publicação opcional, revogável, anônima por padrão | `challenges.results_anon` default `true`; token só-hash + rotação; `mvp.test.ts` "vitrine é anônima por padrão" + aceite passo 20 |
| Consentimento nominal explícito | `challenge_participants.name_consent` (`PATCH …/consent`); `mvp.test.ts` "consentimento nominal libera o nome só de quem autorizou" |
| Tudo que for excluído tem recuperação compatível | `lib/goa/trash.ts`: lixeira real (grupo/desafio/catálogo/registro), arquivamento recuperável (estrutura interna); `mvp.test.ts` ×5 testes "lixeira: …" + aceite passo 22 |
| O cenário autossuficiente passa integralmente | o teste de aceite acima — 60/60 na suíte (nível de API) |
| Beta real não revela falhas bloqueantes | **pendente** — não executado; ver "Pendências" |

---

## Correções P0 (revisão de setembro/2026)

Cinco bloqueadores encontrados e corrigidos, cada um com teste de regressão em
`tests/integration/mvp.test.ts` (testes com prefixo `P0:`):

1. **Exclusão permanente não checava se o objeto estava na lixeira** —
   `purgeTrashItem` agora recusa com 409 `not_in_trash` / `not_archived` qualquer
   alvo que não esteja efetivamente binado/arquivado.
   [trash.ts](../lib/goa/trash.ts).
2. **Apagar um grupo não tirava do ar a vitrine publicada** — `publicResults`
   passou a exigir `groups.deleted_at IS NULL`; `softDeleteGroup` despublica as
   vitrines do grupo.
3. **Revogar consentimento / anonimizar não invalidava o snapshot já publicado**
   — `setParticipantNameConsent` chama `regeneratePublishedShowcases` quando há
   publicação; `name_consent` é reiniciado ao sair/ser removido e ao voltar.
4. **Auditoria vazava conteúdo curto para o `/admin`** — `redactForPlatformAdmin`
   (allowlist de chaves estruturais) substitui a redação por tamanho; título,
   nome de grupo e rótulo de campo/métrica não aparecem mais.
5. **Hábito com período e sem checkpoints ficava inutilizável** — a tela do
   participante mostra o check-in direto para todo tipo `daily` que não é
   `checkpoint`-agendado (`directDaily`), datado ou não.

Também nesta rodada: rota da lixeira do grupo (`selectedGroup` não incluía
`group-trash`); `app/challenges/new/page.tsx` (refresh 404); motivo da exclusão
administrativa gravado em `system_audit_events`; sair de um grupo binado passou a
ser possível.

## Backlog pós-P0 — estado

O P1 da revisão foi trabalhado em **6 ondas** (commits `fix(P1 onda A–F)`), cada
uma com testes de regressão. Depois vieram duas rodadas de revisão (P0 do
reset administrativo + P1 de ciclo de vida). Total atual: **84 testes de
integração + 114 unitários**.

| Onda | O que entrou |
| --- | --- |
| **A — Receitas/integridade** | preflight bloqueia receita sem o campo essencial (`recipe_essential_field_missing`); métrica de receita com `fieldKey` irresolvível é **omitida**, nunca repontada; após ativar, reduzir limite / tornar obrigatório valida registros (`limit_would_invalidate` / `required_would_invalidate`); Estante/`bookshelf` resolve `book`; opção `choice` arquivada em uso volta na lista com `archived:true` (rótulo, não id) |
| **B — Listas/checkpoints** | a ordem enviada em `items/assign` persiste (`position`); Clube de Leitura datado sem dias automáticos organiza semanas/sessões à mão; editor de checkpoint ganha campo de descrição; série `groupBy:checkpoint` inclui semanas vazias (linha com `value:null`) |
| **C — Métricas/Wrapped** | `count` vira série por pessoa/item/checkpoint; `completion_rate` agrupado é **recusado** (`invalid_metric_grouping`); rankings + afinidade **ao vivo** no detalhe do desafio ativo; `curateResults` só depois de encerrar (`challenge_not_closed`) e o resultado interno é sempre vivo enquanto aberto |
| **D — Lixeira/ciclo de vida** | seção "Estrutura removida" (`<TrashView>`) na aba Revisão da admin; restaurar item de acervo pessoal refaz o vínculo da lista + registros; registro binado num desafio **encerrado** fica congelado (409); `applyPurge` cobre métricas/opções arquivadas; restaurar desafio desarquiva o catálogo órfão; **migração 0034** faz backfill de `trash_items` |
| **E — Contas/admin** | exclusão de conta raspa `username`/`username_normalized`/`password_hash`; conta desativada não lê nada privado por `GET` (só `bootstrap`); admin desativado perde o `/admin`; `admin/users/reset-link` **removida** — a exigência de "pedido recente" era circular (o admin vê o e-mail no painel e `/api/auth/forgot` era público); publicação nominal usa token opaco `p_…` no lugar do id interno _(a redefinição por link foi retirada por inteiro depois — ver "3ª revisão")_ |
| **F — Deep links** | `/modelos`, `/modelos/:id`, `/sobre` abrem por URL sem sessão; `app/challenges/new/page.tsx` (era 404 no refresh); testes de round-trip `urlForScreen ↔ screenFromUrl` e de existência de `page.tsx` para cada rota |

### 2ª revisão — o que entrou

| Item | O que mudou |
| --- | --- |
| **P0 — reset administrativo** | rota, serviço e aba removidos; teste garante que `POST /api/admin/users/reset-link` responde 404 _(o `scripts/reset-password.mjs` que entrou aqui foi retirado na 3ª revisão)_ |
| Publicação ressuscitando | binar um desafio agora também despublica (`unpublishResults`), então restaurar não devolve a URL pública antiga |
| Grupo binado órfão | a exclusão de conta passa a varrer também os grupos que já estavam na lixeira do dono (purga ou transfere) |
| Cota de participantes | `assertUnderMembershipCap` ignora grupos binados — ninguém fica preso numa cota por um grupo que está na lixeira |
| Restaurações incompletas | restaurar com renomeação usa o `normalizeTitle` canônico; métrica com tipo/campo arquivado é bloqueada (`parent_trashed`); a prévia de purga conta também as linhas arquivadas que vão morrer junto |
| Migração 0034 | o backfill distingue registro removido à mão de registro varrido junto com o item (só o primeiro vira `trash_items`) |
| Comentários públicos | a seleção de comentários na admin traz aviso de privacidade antes de publicar texto de terceiros |
| Importação JSON no wizard | `parseJsonItemsPaste` deixou de engolir entradas inválidas, repetidas e chaves desconhecidas: devolve um resumo (`total/added/invalid/duplicates/unknownKeys`) que o wizard mostra, como o importador pós-criação já fazia |

### 3ª revisão — redefinição de senha retirada (2026-09-06)

Sem vincular um provedor de e-mail não há como entregar o link de redefinição, e
e-mail está fora do escopo da V1 (`ROADMAP.md` §1). Decisão: retirar todo o fluxo
visível, temporariamente.

| O que saiu | Detalhe |
| --- | --- |
| Tela "Esqueci a senha" | `AuthScreen` perdeu o modo `forgot`; `app/goa/screens/reset-password.tsx` apagada; `Screen` não tem mais `kind:"reset"`; `navigation.ts` não lê mais `?reset=` |
| Rotas | `POST /api/auth/forgot` e `POST /api/auth/reset` respondem `404` para todo mundo (não `401`) |
| `/admin` | sumiu o indicador "reset pedido" e o campo `pendingReset` de `GET /api/admin/users` |
| Textos | o aviso do e-mail no cadastro virou "as opções de redefinição de senha chegam em breve" / "password reset options are coming soon"; namespace i18n `resetPassword` + `auth.forgot` removidos dos dois catálogos |
| Script de operador | `scripts/reset-password.mjs` apagado |
| Mantido | cadastro ainda aceita e-mail opcional (só login); troca de senha autenticada em `PATCH /api/account`; tabela `password_reset_tokens` fica no banco, **dormente**, sem migração — religar é mudança só de código |

Testes: o antigo teste 9 virou "e-mail, login por e-mail e edição de conta" (sem
o trecho de reset) e a asserção da onda E virou "não há redefinição de senha por
link — nem pública, nem pelo `/admin`" (as três rotas dão `404`). **114 unit + 84
integração, build verde.**

### 4ª revisão — privacidade da vitrine + auditoria da exclusão (2026-09-06)

| O que mudou | Detalhe |
| --- | --- |
| Anonimização despublica sozinha | mudar `anonymizeParticipants` em `curateResults` quando já **há** vitrine publicada agora chama `unpublishResults` na hora — o link antigo para de servir a config anterior. A resposta traz `unpublished:true` e a UI mostra "a vitrine foi despublicada porque a anonimização mudou". Salvar o rascunho sem mexer na anonimização não toca na publicação. Teste: "mudar a anonimização derruba a vitrine já publicada" |
| Motivo para binar registro alheio | `deleteEntry` passou a exigir `reason` quando owner/admin manda para a lixeira o registro **de outra pessoa** (igual à correção e à exclusão permanente); fica no `trash_items` e na auditoria. Excluir o próprio não pede nada. Novo `readOptionalJsonObject` no `lib/http.ts` para o `DELETE` aceitar corpo opcional. Teste dentro de "registros podem ser excluídos" |
| README sem contradição | a linha "`/admin` … lixeira (purga definitiva)" saiu — o painel não tem lixeira global (já dito no mesmo parágrafo) |
| Cópia carrega o cronograma | `copyChallengeStructure` passou a copiar os checkpoints manuais (semana/sessão/marco — o `kind='day'` continua sendo regerado) e o `checkpoint_id` de cada item, remapeados; as datas seguem caindo (a cópia nasce sem período). A duração dos filmes (`runtime_minutes`) também vai junto pelo `upsertCatalogItem`. O detalhe do modelo ganhou `checkpoints[]` e uma seção "Cronograma"; o preview não promete mais "N dias" via `structure` fallback. Teste: "copiar um desafio carrega as semanas, a distribuição dos itens e a duração dos filmes" |

**Adiado para pós-lançamento (o roadmap já estaciona estes):** afinidade
composta / "perfil de gosto relativo" (§10 "entra no final da V1"); autor e
atributos personalizados na afinidade; percentual de páginas lido; fluxo
completo de UI para atributos editoriais (criar/mapear-JSON/ver no detalhe) — a
API existe.

### P2 — feito nesta rodada (commit `fix(P2)`)

- `--muted` do tema claro escurecido para ≥ 4.5:1 em `--paper`/`--canvas`.
- `PurgeDialog`: foco inicial no botão fechar, **trap de Tab** dentro do painel,
  Escape, e o foco volta para quem abriu.
- números de ranking/afinidade usam a locale do leitor (`rankingLabels`/
  `affinityLabels` recebem `locale`; `pt-BR` vs `en-GB` no separador decimal).
- login: o `<h1>` do documento agora é o cabeçalho do formulário (visível no
  mobile); a manchete decorativa do herói virou `<p>`.
- cache do `sessionStorage`: entradas com mais de 60s não são mais pintadas na
  hora — o fetch ao vivo ainda as substitui, sem risco de flash do usuário
  anterior num aparelho compartilhado.
- 500s trazem um `requestId` correlacionável (corpo + header `x-request-id`),
  logado com a rota.
- CI roda `tests/rendered-html.test.mjs`.

### P2 — fora do escopo de código (decisão)

- en-GB completo nas mensagens do backend + console `/admin` — exige i18n no
  servidor (o roadmap §1 mantém e-mail/integrações fora da V1; i18n de servidor
  segue a mesma régua).
- testes reais de navegador / teclado / axe / Lighthouse — precisa de
  infra nova (Playwright + CI headless).
- observabilidade de produção (latência agregada, contadores, alertas) — é
  plataforma, não código de app.
- garantir que a migração do Neon anteceda o deploy da Vercel — processo de
  operação; hoje o push dispara a Vercel e a migração é manual (ver memória
  "Deployment model").
- **beta fechado com pessoas reais e correção dos achados** (§15) — não é código,
  é o próximo passo depois deste gate. O gate cobre o cenário do §16 pela API;
  não substitui uso real.

Documentação alinhada: `docs/api.md` (rotas de lixeira/conta, `system-audit`, sem
lixeira global no `/admin`, sem `/api/auth/forgot|reset`, receitas criáveis, CSV
como única resposta não-JSON); `README.md` (receitas criáveis, poderes do
`platform_admin`, seção "Recuperação de senha" = fora do ar); `docs/architecture.md`
(identidade sem redefinição por link); `ROADMAP.md` §13 e a linha do P1 de
privacidade (os "30 dias" e a purga automática do texto original foram
substituídos pela lixeira permanente); este arquivo.

---

## Revisão do §15 (qualidade de lançamento)

- **Regressões**: suíte completa verde (114 unit + 86 integração + build).
- **Permissões / isolamento**: `challengeAccess`/`requireGroupRole` em toda rota;
  a lixeira deriva o papel do objeto, não da URL; `mvp.test.ts` "isolamento",
  "aplica limites", matriz de purga (participante não purga desafio de grupo;
  purga de registro alheio exige motivo; sem rota de purga no `/admin`).
- **Visibilidade**: `tests` de política por tipo; métrica agregada ignora o
  filtro por design (documentado).
- **Lixeira / restauração**: 5 testes dedicados + aceite passo 22 (pai/filho,
  conflito, referência histórica bloqueia purga, permanência indefinida).
- **Publicação / rotação**: `mvp.test.ts` publicação/rotação/anonimização +
  aceite passo 20–21.
- **Métricas**: `analysis.test.ts` (fórmulas), `metrics.test.ts` (combinações
  inválidas, `explanation`/`sample`).
- **Deep links + refresh**: `tests/navigation.test.ts`; `page.tsx` para cada
  rota, incluindo `/personal/trash` e `/groups/:id/trash`.
- **Acessibilidade**: rótulos e `aria-*` nos formulários novos; `PurgeDialog`
  com `role="dialog"`, `aria-modal`, foco inicial e Escape; botões reais.
- **Mobile**: telas novas em `flex-wrap` / `max-w-*`, sem scroll horizontal;
  `img { max-width: 100% }` global.
- **Observabilidade**: `console.warn` para `trash.purge`,
  `auth.deactivateAccount`, `auth.deleteAccount`; `system_audit_events` para
  purga e exclusão de conta; `/api/health` sem efeito colateral.
- **Documentação**: `docs/architecture.md` (lixeira, conta, acesso do admin);
  este documento.
