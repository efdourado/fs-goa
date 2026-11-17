Run `npm run db:seed-progress` against the local database with an existing `@dudupizzas` account. It creates the **Laboratório de progresso** group and five active examples:

- **Uma série:** same weight with more reps, then lighter weight with a rep record at that weight.
- **Três séries:** explicit working-set numbers, shuffled row order, individual fields and total workload.
- **Corrida:** daily distance/time/heart-rate fields, comparing time over the same distance.
- **Estudos:** per-subject correct answers (higher), errors (lower), and study time (descriptive).
- **Jardim:** moisture approaching a target, descriptive temperature, and a zero-baseline water field.

Open each challenge's **Resultados → Recordes pessoais**. Configure comparisons in **Gerenciar → Resultados → Recordes pessoais** (edit icon). To record numbered sets, select the numeric set-number field in those settings and use **Adicionar série** in the session form.

The seed uses domain services, refuses remote databases, and preserves existing challenges when rerun. Each new example is read back through the story calculation before its link is printed. Dates are relative to the day the seed runs.
