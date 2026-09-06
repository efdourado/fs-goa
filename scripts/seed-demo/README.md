# `db:seed-demo`

Builds a self-contained **demonstration group** so the Wrapped, rankings, weekly
schedule, large lists and mobile layout can be reviewed against real volume
instead of empty screens.

```bash
npm run db:seed-demo -- --scenario=cinema --dry-run
npm run db:seed-demo -- --scenario=cinema
npm run db:seed-demo -- --scenario=all
npm run db:seed-demo -- --reset --scenario=cinema
```

## What it does

- Finds the three fixed accounts by username: **`dudupizzas`** (owner),
  **`admin`** (group admin — must hold `platform_admin`), **`teste`** (participant).
  It never creates them and never touches their password, e-mail or global role.
  It aborts if one is missing, deactivated or banned.
- Creates **one** group, `Laboratório GOA — Dados de demonstração`, whose
  description carries the marker `⟦seed-demo⟧` and states the data is synthetic.
- Runs each selected scenario through the **real domain services** — the same
  `createChallenge` / `saveEntry` / `transitionChallenge` / `curateResults` /
  `publishResults` / `setChallengeTemplate` a person hits. No hand-written SQL for
  content.
- Closes the challenges normally, generates the Wrapped with the real engine,
  publishes the result **anonymously**, and publishes each challenge as a
  **template** (as `admin`).
- Prints a summary: management / participant / template URLs, the public result
  token, and row counts.

## Transactions & idempotency

The public domain services open and commit their own transactions, so there is
**no global rollback**:

| Mode | Behaviour |
| --- | --- |
| `--dry-run` | Validates accounts, environment and scenario data; prints the plan. **Writes nothing** — no domain service is called. |
| normal | Progressive writes through the real services. |
| failure midway | The partial group is left in place, tagged by the marker. The next run detects it and refuses until `--reset`. |
| `--reset` | Removes **only** the synthetic group whose marker + id were re-checked inside the transaction, then rebuilds. On a remote (Neon) `DATABASE_URL` it first asks for a confirmation phrase (`SEED_DEMO_CONFIRM="seed demo"` to skip the prompt). |

## Adding a scenario

`scenarios/` holds one file per recipe. `cinema.ts` is the vertical slice.
`library`, `bookshelf` and `habit` are stubs that abort until written — they land
once the Wrapped format has been reviewed against the first full Cinema result.

A scenario implements `Scenario` from `scenarios/types.ts`:

- `plan(context)` — a string describing what a real run would create (for `--dry-run`).
- `run(context)` — builds it with the domain services and returns a `ScenarioResult`.

The orchestrator (`index.ts`) creates the group and adds the three members before
any scenario runs, so a scenario can assume `context.groupId` and the roster.
