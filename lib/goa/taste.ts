import type { SessionContext } from "../auth";
import { requireGroupRole } from "../auth";
import { oneOrNull, withClient } from "../db";
import { ApiError } from "../http";
import { directAffinity } from "./analysis";
import { unsealedEntrySql } from "./challenges/reveal";

/** Titles rated by both people before an agreement is worth a number. */
export const TASTE_MIN_SHARED = 3;

interface Rated {
  key: string;
  title: string;
  /** 0–1 on the field's own scale, so a 0–5 film and a 0–10 book compare. */
  norm: number;
  raw: number;
}

export interface TasteMoment {
  title: string;
  you: number;
  them: number;
}

export interface TastePerson {
  userId: string;
  name: string;
  shared: number;
  /** 0–100, null until they share `TASTE_MIN_SHARED` titles. */
  agreement: number | null;
  /** The title you two were closest on, and the one you were furthest apart on. */
  twin: TasteMoment | null;
  clash: TasteMoment | null;
}

export interface TastePair {
  a: { userId: string; name: string };
  b: { userId: string; name: string };
  agreement: number;
  shared: number;
}

export interface GroupTaste {
  viewerId: string;
  minShared: number;
  /** How many titles the viewer has rated in this group so far. */
  ratedCount: number;
  people: TastePerson[];
  /** The group's closest and furthest pair (anyone, not just the viewer), when there are two scored pairs. */
  twins: TastePair | null;
  opposites: TastePair | null;
}

/**
 * Who shares your taste, across every challenge this group ever ran: the same catalogue title rated
 * by two members is one data point. Only ratings the group can already see count — never a sealed
 * one before its reveal, an author-only one, or an after-close one while its round is still open.
 */
export async function groupTaste(session: SessionContext, groupId: string): Promise<GroupTaste> {
  return withClient(async (client) => {
    await requireGroupRole(session.user.id, groupId, ["owner", "admin", "participant"], client);
    const group = await oneOrNull<{ kind: string }>(
      client, "SELECT kind FROM groups WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL", [groupId],
    );
    if (!group || group.kind !== "standard") throw new ApiError(404, "not_found", "Grupo não encontrado.");

    const rows = await client.query<{ user_id: string; name: string; key: string; title: string; norm: number; raw: number }>(
      `SELECT e.participant_user_id AS user_id, u.display_name AS name,
              coalesce(ci.catalog_item_id, ci.id) AS key, min(coalesce(cat.title, ci.title)) AS title,
              avg((ev.number_scaled - f.min_scaled)::float8 / (f.max_scaled - f.min_scaled)) AS norm,
              avg(ev.number_scaled::float8 / (10 ^ f.number_scale)) AS raw
         FROM entry_values ev
         JOIN entries e ON e.id = ev.entry_id AND e.deleted_at IS NULL
         JOIN challenge_fields f ON f.id = ev.field_id AND f.kind = 'rating'
          AND f.min_scaled IS NOT NULL AND f.max_scaled > f.min_scaled
         JOIN entry_types t ON t.id = e.entry_type_id
          AND coalesce(t.purpose, 'rating') = 'rating' AND t.answer_scope = 'individual'
         JOIN challenges c ON c.id = e.challenge_id AND c.group_id = $1 AND c.deleted_at IS NULL
         JOIN challenge_items ci ON ci.id = e.item_id
         LEFT JOIN catalog_items cat ON cat.id = ci.catalog_item_id
         JOIN group_members gm ON gm.group_id = $1 AND gm.user_id = e.participant_user_id AND gm.removed_at IS NULL
         JOIN users u ON u.id = e.participant_user_id
        WHERE ev.number_scaled IS NOT NULL
          AND (t.visibility_policy IN ('group_realtime', 'after_own', 'until_reveal')
               OR (t.visibility_policy = 'after_close' AND c.status = 'closed'))
          AND ${unsealedEntrySql("e")}
        GROUP BY e.participant_user_id, u.display_name, coalesce(ci.catalog_item_id, ci.id)`,
      [groupId],
    );

    const byPerson = new Map<string, { name: string; rated: Map<string, Rated> }>();
    for (const row of rows.rows) {
      const person = byPerson.get(row.user_id) ?? { name: row.name, rated: new Map<string, Rated>() };
      person.rated.set(row.key, { key: row.key, title: row.title, norm: row.norm, raw: row.raw });
      byPerson.set(row.user_id, person);
    }
    const members = await client.query<{ user_id: string; name: string }>(
      `SELECT gm.user_id, u.display_name AS name FROM group_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = $1 AND gm.removed_at IS NULL ORDER BY u.display_name`,
      [groupId],
    );

    const compare = (a: Map<string, Rated>, b: Map<string, Rated>) => {
      const shared = [...a.keys()].filter((key) => b.has(key)).map((key) => ({ mine: a.get(key)!, theirs: b.get(key)! }));
      const score = directAffinity(shared.map(({ mine, theirs }) => [mine.norm, theirs.norm] as const), 1, { minSample: TASTE_MIN_SHARED });
      return { shared, agreement: score.value };
    };

    const mine = byPerson.get(session.user.id)?.rated ?? new Map<string, Rated>();
    const people: TastePerson[] = [];
    for (const member of members.rows) {
      if (member.user_id === session.user.id) continue;
      const theirs = byPerson.get(member.user_id)?.rated ?? new Map<string, Rated>();
      const { shared, agreement } = compare(mine, theirs);
      const gap = (pair: (typeof shared)[number]) => Math.abs(pair.mine.norm - pair.theirs.norm);
      // Closest: smallest gap, the one you both liked most breaking ties. Furthest: only a real disagreement.
      const twin = [...shared].sort((x, y) => gap(x) - gap(y) || (y.mine.norm + y.theirs.norm) - (x.mine.norm + x.theirs.norm))[0];
      const clash = [...shared].sort((x, y) => gap(y) - gap(x))[0];
      const moment = (pair: (typeof shared)[number] | undefined) => pair
        ? { title: pair.mine.title, you: Math.round(pair.mine.raw * 10) / 10, them: Math.round(pair.theirs.raw * 10) / 10 }
        : null;
      people.push({
        userId: member.user_id,
        name: member.name,
        shared: shared.length,
        agreement,
        twin: moment(twin),
        clash: clash && gap(clash) >= 0.3 ? moment(clash) : null,
      });
    }
    people.sort((x, y) => (y.agreement ?? -1) - (x.agreement ?? -1) || y.shared - x.shared);

    const scored: TastePair[] = [];
    const ids = [...byPerson.keys()].filter((id) => members.rows.some((member) => member.user_id === id));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = byPerson.get(ids[i])!;
        const b = byPerson.get(ids[j])!;
        const { shared, agreement } = compare(a.rated, b.rated);
        if (agreement === null) continue;
        scored.push({ a: { userId: ids[i], name: a.name }, b: { userId: ids[j], name: b.name }, agreement, shared: shared.length });
      }
    }
    scored.sort((x, y) => y.agreement - x.agreement || y.shared - x.shared);

    return {
      viewerId: session.user.id,
      minShared: TASTE_MIN_SHARED,
      ratedCount: mine.size,
      people,
      twins: scored.length >= 2 ? scored[0] : null,
      opposites: scored.length >= 2 && scored.at(-1)!.agreement < scored[0].agreement ? scored.at(-1)! : null,
    };
  });
}
