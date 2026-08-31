# Arquitetura v2 — fundação relacional (Fase 1 da roadmap)

> **Status:** parcialmente implementado. **D1 resolvida** (acervo e rodada são
> irmãos do grupo) e a **Fase 1a** já está em `main` — `catalog_items`,
> `catalog_tags`, `challenge_items.catalog_item_id` + `recommended_by_user_id`
> (migração 0010). O que segue abaixo (`round_items`, `entries.checkpoint_id`,
> as 4 colunas ortogonais de `entry_types`, relaxar os CHECK) é o **Marco 3** e
> ainda precisa de decisão em D2. Contexto em [../ROADMAP.md](../ROADMAP.md).

## O problema em uma frase

Hoje `entry_types.submission_mode` (`item | daily | free`) amarra num eixo só três
coisas independentes: **com qual objeto** o registro fala, **quantos** registros
cabem, e **quando** eles podem acontecer. Além disso o filme/livro só existe
dentro da rodada — não tem identidade entre edições.

## O modelo

```
grupo
├── catalog_items          ← filme, livro, hábito: identidade estável no grupo
│   ├── atributos tipados   (catalog_item_attributes: duração, ano, páginas…)
│   └── tags                (catalog_item_tags → catalog_tags: gênero, carga…)
└── challenges (rodada)     ← inalterado no topo
    ├── entry_types         ← ganha 3 colunas ortogonais (abaixo)
    ├── round_items         ← challenge_items renomeado + catalog_item_id + recommended_by_user_id
    ├── challenge_checkpoints   ← já existe; passa a ser referenciável direto pelo entry
    └── entries             ← ganha checkpoint_id; os CHECKs relaxam
```

### Tabelas novas

| Tabela | Papel |
|---|---|
| `catalog_items` | `(id, group_id, kind, title, normalized_title, created_by, archived_at, …)`. `kind in ('film','book','habit','other')`. `unique(group_id, kind, normalized_title)` evita "dois livros" por grafia. |
| `catalog_item_attributes` | `(catalog_item_id, key, number_value / text_value / date_value)`. Tipado, analisável. `key` livre por `kind` (ex. `duration_minutes`, `year`, `pages`). |
| `catalog_tags` | `(id, group_id, kind, label, normalized_label)` — taxonomia reutilizável (gênero, década, carga emocional). |
| `catalog_item_tags` | N:N `(catalog_item_id, tag_id)`. |

### `entry_types` — 3 colunas no lugar de `submission_mode`

`submission_mode` fica (compat + o CHECK atual de `entries`), mas passa a ser
**derivado**. As colunas que mandam:

| Coluna | Valores | O que decide |
|---|---|---|
| `purpose` | `progress · completion · expectation · rating · checkin` | o que o registro é |
| `target_policy` | `required · optional · none` | precisa apontar um `round_item`? |
| `cardinality` | `once_per_item · once_per_item_day · repeatable · once_per_day` | quantos por participante |
| `schedule_policy` | `free · within_round · checkpoint` | quando pode registrar |

Exemplos:

| Fluxo | purpose | target_policy | cardinality | schedule_policy |
|---|---|---|---|---|
| Expectativa de filme | expectation | required | once_per_item | within_round |
| Avaliação de filme | rating | required | once_per_item | within_round |
| Progresso de leitura | progress | required | once_per_item_day | within_round |
| Conclusão de livro | completion | required | once_per_item | within_round |
| Hábito diário | checkin | required | once_per_item_day | within_round |
| Reflexão do encontro | checkin | none | repeatable | checkpoint |

### `round_items` (era `challenge_items`)

- `+ catalog_item_id → catalog_items(id)` (nullable durante a migração; obrigatório
  para verticais novas).
- `+ recommended_by_user_id → users(id)` (peça-chave do viés do indicador).
- `block` / `week` já cabem em `metadata` hoje; promover a colunas se a UI de
  organização por blocos entrar junto.

### `entries` — o coração

- `+ checkpoint_id → challenge_checkpoints(id)` (nullable). Um registro passa a
  poder apontar **livro + dia + checkpoint** ao mesmo tempo.
- CHECK `entries_item_mode_check` **relaxa**: `item_id` obrigatório quando
  `target_policy = required`, proibido quando `none`, livre quando `optional` —
  independente de haver `occurred_on` ou `checkpoint_id`.
- Índices únicos por cardinalidade:
  - `once_per_item` → `unique(item_id, participant_user_id) where deleted_at is null`
  - `once_per_item_day` → `unique(item_id, participant_user_id, occurred_on) where …` **(novo — destrava "dois livros no mesmo dia")**
  - `once_per_day` → o índice diário atual
  - `repeatable` → sem índice

## Migração dos dados existentes

1. **Aditiva primeiro:** criar tabelas de catálogo e colunas nullable, sem
   remover nada. Deploy. Nenhum comportamento muda.
2. **Backfill:** para cada `challenge_items` de um desafio `cine`, criar um
   `catalog_items(kind='film')` no grupo e ligar. Para `reading`, o "Livro atual"
   (campo texto) **não** tem como virar catálogo retroativo confiável — marcar
   esses desafios como legados e não migrar; verticais novas nascem certas.
3. **Relaxar os CHECKs** de `entries` só depois que `entry_types` das rodadas
   ativas tiver `purpose/target_policy/cardinality/schedule_policy` preenchidos
   (default seguro a partir do `submission_mode`).
4. A conta seed e qualquer rodada real do grupo migram com um script pontual
   revisado à mão (é single-tenant hoje).

## Teste de aceitação (spec executável da Fase 1)

```
Dado um desafio de leitura ativo com dois livros no acervo,
Quando a participante registra progresso nos dois no mesmo dia,
 E marca um deles como concluído com nota 5,
Então há dois registros de `progress` (um por livro/dia),
 E um registro de `completion` + um de `rating` ligados ao livro concluído,
 E nenhum passo exigiu comentário para o sistema saber de qual livro se trata.
```

Vira um teste de integração novo em `tests/integration/`.

## Decisões ainda abertas (precisam de você)

- ~~**D1**~~ — **resolvida:** acervo e rodada são filhos irmãos do grupo.
- **D2** — "Avaliar a qualquer hora" (`schedule_policy = within_round`) vira o
  **padrão** para cine, com checkpoint datado como opção só para leitura/hábitos?
- Ordem de UI: a organização por blocos/semanas (drag-and-drop) entra **junto**
  com `round_items`, ou fica para a Fase 2?

## O que NÃO muda na Fase 1

Auth, grupos, convites, o showcase (Fase 4), o motor de análise (Fase 3),
`entry_values` normalizado, a filosofia de imutabilidade dos registros.
