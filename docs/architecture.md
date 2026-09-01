# Arquitetura

## Visão geral

Next.js 16 (App Router) + React 19 + TypeScript. A API REST são route handlers no
mesmo runtime da interface, todos Node e dinâmicos (`force-dynamic`). PostgreSQL
16+ é a única fonte de verdade. Deploy padrão: Vercel + Neon; Docker Compose
replica tudo localmente.

```text
navegador ──JSON + cookie HTTP-only──▶ Next.js / route handlers ──SQL parametrizado──▶ PostgreSQL
                                        ├── autenticação, CSRF e autorização
                                        ├── grupos, convites, acervo
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
| `lib/auth.ts` | contas, sessões, rate limit, papéis, redefinição de senha |
| `lib/admin.ts` | serviços do `/admin` — só metadados |
| `lib/security.ts` | PBKDF2, tokens, cookies, origem e CSRF |
| `lib/goa/domain/` | criação de grupos, convites e desafios |
| `lib/goa/challenges/` | receitas, tipos de registro, campos, registros, análise, vitrine, duplicação |
| `lib/goa/catalog.ts` | acervo do grupo e histórico de um item entre rodadas |
| `lib/goa/analysis.ts` · `lib/metrics.ts` | matemática pura das métricas (bayes, desvio, delta) |
| `lib/validation.ts` | validação tipada e exportação CSV segura |
| `db/schema/` | schema Drizzle, dividido por área |
| `drizzle/` | única fonte de migrações reproduzíveis |

## Modelo de domínio

```
Grupo
├── Acervo — catalog_items (filme/livro), atributos tipados, tags (gênero)
│              identidade estável entre rodadas
└── Rodada (challenges) — recipe_key + recipe_version
    ├── entry_types — 4 eixos ortogonais (o submission_mode fica, derivado):
    │     purpose (progress·completion·expectation·rating·checkin)
    │     target_policy (required·optional·none)  — precisa de um round item?
    │     cardinality (once_per_item·once_per_item_day·once_per_day·repeatable)
    │     schedule_policy (free·while_active·checkpoint)
    ├── challenge_items — o filme/livro nesta rodada + catalog_item_id + recommended_by
    ├── challenge_checkpoints — dias, quando a receita usa checkpoints
    ├── challenge_fields — campos semânticos por tipo de registro
    └── entries — participante + tipo + item/checkpoint + occurred_on + entry_values
```

- **Receitas** (`lib/goa/challenges/recipes.ts`): `cine_free`, `cine_curated`
  (2 tipos: expectativa + avaliação), `reading_club` (3 tipos: progresso/dia,
  conclusão, nota), `reading_daily` (check-in). Cada receita abre os tipos de
  registro, os campos e as métricas de análise — um round novo já gera vitrine
  completa sem configuração.
- Um mesmo item aceita **mais de um tipo** de registro por pessoa (unicidade por
  item × tipo × pessoa; `once_per_item_day` inclui `occurred_on`). A expectativa
  **trava** assim que existe uma avaliação daquela pessoa para o item.
- Números e notas são inteiros escalados. Campos e opções em uso são arquivados,
  nunca apagados.
- **Métricas** referenciam IDs de campos e são recalculadas sem tocar nos dados.
  `group_by` produz uma série (ranking por item, recorte por pessoa). Ao encerrar,
  `result_blocks` guarda snapshots congelados; a página pública exige um token
  aleatório cujo banco guarda só o hash (rotacionável).
- **Duplicação** é só estrutural, em transação: desafio, tipos, campos, opções,
  itens e métricas ganham novos IDs; a receita carrega, a agenda zera, os itens
  re-resolvem contra o acervo do grupo de destino. Participantes, registros,
  valores, checkpoints, blocos, tokens e indicadores **nunca** são copiados.

## Segurança

- senhas nunca persistidas nem retornadas; PBKDF2-HMAC-SHA256, 600.000 iterações,
  salt individual via Web Crypto;
- nome de usuário NFKC, minúsculo, restrito, único no PostgreSQL;
- tokens de sessão e convite de 256 bits; o banco guarda só SHA-256 base64url;
- cookie `__Host-goa_session` — `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`;
- toda mutação autenticada exige `Origin` exata + token CSRF ligado à sessão;
- toda consulta a recurso privado parte da associação ativa ao grupo — IDs não
  concedem acesso; participante só altera o próprio registro;
- payload JSON limitado, campos dinâmicos com validação estrita, CSV neutraliza
  células-fórmula, métricas usam enums (nunca SQL nem fórmula arbitrária);
- auditoria append-only registra correções e transições, sem senha nem token;
- `platform_admin` é um flag separado, sem poder sobre grupos — só abre `/admin`.

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
- **Identidade** — contas com usuário e senha, e-mail opcional (login por ambos;
  habilita a redefinição por token de uso único). Autorização sempre a partir da
  associação ativa ao grupo. Identidade de terceiros cabe depois sem mudar o
  domínio.
- **`submission_mode`** — mantido como coluna derivada por compatibilidade com o
  FK e os CHECKs de `entries`; os 4 eixos ortogonais é que mandam.

## Fora de escopo por enquanto

App mobile nativo; feed social entre grupos; import direto de `.xlsx`; editor
no-code genérico; afinidade nominal publicada sem consentimento; recalcular
retroativamente uma vitrine publicada.
