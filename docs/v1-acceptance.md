# GOA V1 — gate final (ROADMAP §15–17)

Estado: os tópicos 1–17 da `ROADMAP.md` estão implementados em `main`. Este
documento é a evidência do gate: o cenário autossuficiente do §16 rodando de
ponta a ponta e cada item da definição de pronto do §17.

Gates verdes na entrega: `npm run typecheck`, `npm run lint`,
`npm run test:unit` (109), `npm run test:integration` (55), `npm run build`,
`npx drizzle-kit check`.

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
| 9 | Atributos editoriais opcionais | `POST …/catalog-attributes` "Diretor"; `attributes` no commit de itens |
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
| O cenário autossuficiente passa integralmente | o teste de aceite acima — 55/55 na suíte |
| Beta real não revela falhas bloqueantes | pendente (fora do escopo automatizado); os gates acima são o pré-requisito |

---

## Revisão do §15 (qualidade de lançamento)

- **Regressões**: suíte completa verde (109 unit + 55 integração + build).
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
