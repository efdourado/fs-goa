import type { AffinityBlock, Metric, PersonalRanking, WrappedBlock } from "./types";
import { metricHasData } from "./utils";

// No "use client": the public results page (a server component) builds these blocks, and the showcase view draws them.

export type ShowcaseComment = { id: string; text: string; itemTitle?: string | null };

/**
 * Turns a never-curated round's raw result parts into the same block list the
 * curated path produces, so both render through one component.
 */
export function defaultShowcaseBlocks(input: {
  metrics?: Metric[];
  personalRankings?: PersonalRanking[];
  affinity?: AffinityBlock | null;
  comments?: ShowcaseComment[];
}): WrappedBlock[] {
  const blocks: WrappedBlock[] = [];
  let position = 0;
  const add = (block: Omit<WrappedBlock, "position" | "visible">) =>
    blocks.push({ ...block, position: position++, visible: true } as WrappedBlock);

  for (const metric of (input.metrics ?? []).filter(metricHasData)) add({ id: metric.id, kind: "metric", metric });
  if ((input.personalRankings?.length ?? 0) > 1) add({ id: "rankings", kind: "ranking", ranking: input.personalRankings });
  if (input.affinity && input.affinity.pairs.length) add({ id: "affinity", kind: "affinity", affinity: input.affinity });
  for (const comment of input.comments ?? []) {
    add({ id: comment.id, kind: "entry_value", comment: { id: comment.id, text: comment.text, itemTitle: comment.itemTitle ?? undefined } });
  }
  return blocks;
}
