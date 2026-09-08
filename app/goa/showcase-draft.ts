import type { ChallengeDetail, WrappedBlock } from "./types";

export function buildShowcaseDraft(challenge: ChallengeDetail, draft: {
  headline: string; summary: string; metricIds: string[];
  comments: Array<{ key: string; text: string; itemTitle: string }>;
  includeRankings: boolean; includeAffinity: boolean;
  order: Array<{ id: string; visible: boolean }>;
}): ChallengeDetail {
  const saved = challenge.result;
  const existing = saved?.blocks ?? [];
  const blocks: WrappedBlock[] = [];
  const add = (block: Omit<WrappedBlock, "position" | "visible">) => blocks.push({ ...block, position: blocks.length, visible: true });
  add({ id: existing.find((b) => b.heading === "headline")?.id ?? "draft-headline", kind: "text", heading: "headline", text: draft.headline });
  add({ id: existing.find((b) => b.heading === "summary")?.id ?? "draft-summary", kind: "text", heading: "summary", text: draft.summary });
  for (const id of draft.metricIds) {
    const metric = challenge.metrics.find((m) => m.id === id) ?? saved?.metrics?.find((m) => m.id === id);
    if (metric) add({ id: existing.find((b) => b.kind === "metric" && b.metric?.id === id)?.id ?? `draft-metric-${id}`, kind: "metric", metric });
  }
  if (draft.includeRankings && saved?.personalRankings?.length) add({ id: existing.find((b) => b.kind === "ranking")?.id ?? "draft-rankings", kind: "ranking", ranking: saved.personalRankings });
  if (draft.includeAffinity && saved?.affinity) add({ id: existing.find((b) => b.kind === "affinity")?.id ?? "draft-affinity", kind: "affinity", affinity: saved.affinity });
  for (const comment of draft.comments) add({ id: existing.find((b) => b.kind === "entry_value" && b.comment?.text === comment.text && b.comment?.itemTitle === comment.itemTitle)?.id ?? `draft-comment-${comment.key}`, kind: "entry_value", comment: { id: comment.key, text: comment.text, itemTitle: comment.itemTitle } });
  const ranks = new Map(draft.order.map((b, index) => [b.id, { ...b, index }]));
  blocks.sort((a, b) => (ranks.get(a.id)?.index ?? draft.order.length + a.position) - (ranks.get(b.id)?.index ?? draft.order.length + b.position));
  const ordered = blocks.map((b, position) => ({ ...b, position, visible: ranks.get(b.id)?.visible ?? true }));
  return { ...challenge, result: { ...saved,
    headline: ordered.find((b) => b.heading === "headline" && b.visible)?.text ?? "",
    summary: ordered.find((b) => b.heading === "summary" && b.visible)?.text ?? "",
    blocks: ordered,
  } };
}
