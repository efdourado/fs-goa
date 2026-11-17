/** Local-only, additive progress examples. Existing examples are left intact on reruns. */
import process from "node:process";
import { getPool, oneOrNull, withClient } from "../../lib/db";
import { createChallenge, createGroup } from "../../lib/goa-domain";
import { createGroupLibrary } from "../../lib/goa/catalog";
import { getChallengeDetail, listEntries, saveEntry, transitionChallenge, updateChallenge } from "../../lib/goa-challenges";
import type { ChallengeDetail, Entry } from "../../app/goa/types";
import { buildStory, storyFromChallenge } from "../../app/goa/story/model";
import { addDays, fail, looksRemote, resolveAccount, sessionFor } from "../seed-reading/helpers";
import { PROGRESS_DEMOS } from "./data";

const GROUP_NAME = "Laboratório de progresso";
async function main() {
  if (process.argv.length > 2) fail("Esta seed não recebe argumentos; ao repetir, os exemplos existentes são preservados.");
  if (looksRemote()) fail("db:seed-progress só roda em um banco local. Nada foi alterado.");
  const account = await resolveAccount();
  const session = sessionFor(account);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const origin = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  const existing = await withClient((client) => oneOrNull<{ id: string }>(client,
    "SELECT id FROM groups WHERE owner_user_id=$1 AND name=$2 AND archived_at IS NULL AND deleted_at IS NULL", [account.id, GROUP_NAME]));
  const group = existing ?? await createGroup(session, { name: GROUP_NAME, description: "Exemplos de progresso: propriedades, comparações equivalentes, séries, volume e valores desejados." });
  console.log(`@${account.username}: ${origin}/groups/${group.id}`);
  async function verify(id: string, demo: (typeof PROGRESS_DEMOS)[number]) {
    const saved = await getChallengeDetail(session, id) as unknown as ChallengeDetail;
    const entries = await listEntries(session, id) as unknown as Entry[];
    const story = buildStory(storyFromChallenge(saved, entries, today));
    if (story.kind !== "dated" || !story.records.length) throw new Error(`Seed sem resultados: ${demo.title}`);
    return story.records.length;
  }
  for (const demo of PROGRESS_DEMOS) {
    const previous = await withClient((client) => oneOrNull<{ id: string }>(client,
      "SELECT id FROM challenges WHERE group_id=$1 AND title=$2 AND deleted_at IS NULL", [group.id, demo.title]));
    if (previous) {
      await verify(previous.id, demo);
      console.log(`Preservado: ${demo.title} — ${origin}/challenges/${previous.id}`);
      continue;
    }
    const library = demo.session ? await createGroupLibrary(session, group.id, { label: demo.title }) : null;
    const created = await createChallenge(session, group.id, {
      recipe: demo.session ? "custom" : "habit", title: demo.title, description: demo.description,
      ...(library ? { libraryId: library.id, recordingMode: "session", sessionName: "Sessão" } : {}),
      startsOn: addDays(today, -28), endsOn: addDays(today, 28), participantIds: [account.id],
      fields: demo.fields, items: demo.items?.map((title) => ({ title })),
    });
    const detail = await getChallengeDetail(session, created.id) as unknown as ChallengeDetail;
    const source = detail.entryTypes.find((type) => demo.session ? Boolean(type.parentTypeId) : type.purpose === "checkin")!;
    const idFor = (key: string) => {
      const id = source.fields.find((field) => field.key === key)?.id;
      if (!id) throw new Error(`Campo ausente: ${key}`);
      return id;
    };
    const performance = {
      ...demo.performance, fieldIds: demo.performance.fieldIds.map(idFor),
      ...(demo.performance.seriesFieldId ? { seriesFieldId: idFor(demo.performance.seriesFieldId) } : {}),
      rules: Object.fromEntries(Object.entries(demo.performance.rules ?? {}).map(([key, rule]) => [idFor(key), { ...rule, ...(rule.contextFieldId ? { contextFieldId: idFor(rule.contextFieldId) } : {}) }])),
    };
    await updateChallenge(session, created.id, { trackingSettings: { performance, results: { pageOrder: ["records", "streaks", "volume", "words"], hiddenPages: [] } } });
    await transitionChallenge(session, created.id, { status: "active" });
    for (const [index, rows] of demo.sessions.entries()) {
      const occurredOn = addDays(today, -21 + index * 3);
      const values = (row: (typeof rows)[number]) => Object.fromEntries(Object.entries(row.values).map(([key, value]) => [idFor(key), value]));
      await saveEntry(session, created.id, demo.session ? {
        entryTypeId: source.parentTypeId, occurredOn, values: {},
        children: rows.map((row) => ({ itemId: detail.items.find((item) => item.title === row.item)!.id, values: values(row) })),
      } : { entryTypeId: source.id, occurredOn, values: values(rows[0]) });
    }
    const count = await verify(created.id, demo);
    console.log(`${demo.title} — ${demo.sessions.length} sessões, ${count} séries de dados — ${origin}/challenges/${created.id}`);
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => getPool().end());
