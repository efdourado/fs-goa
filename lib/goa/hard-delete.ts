import type { PoolClient } from "pg";

/**
 * Deleting a challenge's structure deletes it: the row and everything that hangs from it leave the database, in
 * foreign-key order (the schema RESTRICTs). Nothing is archived to come back later. Only the Lixeira (challenges,
 * groups, catalogue items, responses) keeps things restorable, and it erases them for good when it is emptied.
 */

/** Responses, with the records a check-in holds, their answers and any Vitrine card quoting them. */
export async function deleteEntriesHard(client: PoolClient, entryIds: string[]): Promise<void> {
  if (!entryIds.length) return;
  const children = await client.query<{ id: string }>("SELECT id FROM entries WHERE parent_entry_id = ANY($1::text[])", [entryIds]);
  const all = [...entryIds, ...children.rows.map((row) => row.id)];
  await client.query("DELETE FROM result_blocks WHERE source_entry_id = ANY($1::text[])", [all]);
  await client.query("DELETE FROM trash_items WHERE entity_kind = 'entry' AND entity_id = ANY($1::text[])", [all]);
  // entry_values go with their entry (ON DELETE CASCADE); records before the check-in they hang from.
  await client.query("DELETE FROM entries WHERE parent_entry_id = ANY($1::text[])", [entryIds]);
  await client.query("DELETE FROM entries WHERE id = ANY($1::text[])", [entryIds]);
}

export async function deleteMetricsHard(client: PoolClient, metricIds: string[]): Promise<void> {
  if (!metricIds.length) return;
  await client.query("DELETE FROM result_blocks WHERE metric_id = ANY($1::text[])", [metricIds]);
  await client.query("DELETE FROM challenge_metrics WHERE id = ANY($1::text[])", [metricIds]);
}

/** Choices of a choice field, with the answers that picked them. */
export async function deleteOptionsHard(client: PoolClient, optionIds: string[]): Promise<void> {
  if (!optionIds.length) return;
  await client.query(
    `DELETE FROM result_blocks rb USING entry_values ev
      WHERE ev.option_id = ANY($1::text[]) AND rb.source_entry_id = ev.entry_id AND rb.source_field_id = ev.field_id`,
    [optionIds],
  );
  await client.query("DELETE FROM entry_values WHERE option_id = ANY($1::text[])", [optionIds]);
  await client.query("DELETE FROM field_options WHERE id = ANY($1::text[])", [optionIds]);
}

/** Fields, with their answers, choices and the metrics that read them. */
export async function deleteFieldsHard(client: PoolClient, fieldIds: string[]): Promise<void> {
  if (!fieldIds.length) return;
  const metrics = await client.query<{ id: string }>("SELECT id FROM challenge_metrics WHERE field_id = ANY($1::text[])", [fieldIds]);
  await deleteMetricsHard(client, metrics.rows.map((row) => row.id));
  await client.query("DELETE FROM result_blocks WHERE source_field_id = ANY($1::text[])", [fieldIds]);
  await client.query("DELETE FROM entry_values WHERE field_id = ANY($1::text[])", [fieldIds]);
  await client.query("DELETE FROM field_options WHERE field_id = ANY($1::text[])", [fieldIds]);
  await client.query("DELETE FROM challenge_fields WHERE id = ANY($1::text[])", [fieldIds]);
}

/** A challenge's items, with every response about them (binned ones too). */
export async function deleteChallengeItemsHard(client: PoolClient, itemIds: string[]): Promise<void> {
  if (!itemIds.length) return;
  const entries = await client.query<{ id: string }>(
    "SELECT id FROM entries WHERE item_id = ANY($1::text[]) AND parent_entry_id IS NULL", [itemIds]);
  await deleteEntriesHard(client, entries.rows.map((row) => row.id));
  // A record inside someone's check-in about this item goes on its own; the check-in stays.
  const records = await client.query<{ id: string }>("SELECT id FROM entries WHERE item_id = ANY($1::text[])", [itemIds]);
  await deleteEntriesHard(client, records.rows.map((row) => row.id));
  await client.query("DELETE FROM challenge_items WHERE id = ANY($1::text[])", [itemIds]);
}

/** Stages; their items stay in the challenge with no stage, and responses lose the stage they pointed at. */
export async function deleteCheckpointsHard(client: PoolClient, checkpointIds: string[]): Promise<void> {
  if (!checkpointIds.length) return;
  await client.query("UPDATE challenge_items SET checkpoint_id = NULL WHERE checkpoint_id = ANY($1::text[])", [checkpointIds]);
  await client.query("UPDATE entries SET checkpoint_id = NULL WHERE checkpoint_id = ANY($1::text[])", [checkpointIds]);
  await client.query("DELETE FROM challenge_checkpoints WHERE id = ANY($1::text[])", [checkpointIds]);
}

/** Response types, with their responses, fields and metrics. */
export async function deleteEntryTypesHard(client: PoolClient, typeIds: string[]): Promise<void> {
  if (!typeIds.length) return;
  const entries = await client.query<{ id: string }>(
    "SELECT id FROM entries WHERE entry_type_id = ANY($1::text[]) AND parent_entry_id IS NULL", [typeIds]);
  await deleteEntriesHard(client, entries.rows.map((row) => row.id));
  const records = await client.query<{ id: string }>("SELECT id FROM entries WHERE entry_type_id = ANY($1::text[])", [typeIds]);
  await deleteEntriesHard(client, records.rows.map((row) => row.id));
  const metrics = await client.query<{ id: string }>("SELECT id FROM challenge_metrics WHERE entry_type_id = ANY($1::text[])", [typeIds]);
  await deleteMetricsHard(client, metrics.rows.map((row) => row.id));
  const fields = await client.query<{ id: string }>("SELECT id FROM challenge_fields WHERE entry_type_id = ANY($1::text[])", [typeIds]);
  await deleteFieldsHard(client, fields.rows.map((row) => row.id));
  await client.query("UPDATE challenge_items SET entry_type_id = NULL WHERE entry_type_id = ANY($1::text[])", [typeIds]);
  await client.query("UPDATE entry_types SET parent_type_id = NULL WHERE parent_type_id = ANY($1::text[])", [typeIds]);
  await client.query("DELETE FROM entry_types WHERE id = ANY($1::text[])", [typeIds]);
}
