/**
 * Dimensional cuts over a catalog list — average rating by genre, by year, by
 * decade. Pure and deterministic: the screen supplies the bucket key/label, this
 * file only aggregates. The average is weighted by each item's rating count, so a
 * bucket average equals the mean of every rating in it, not a mean of means.
 */

export interface CatalogItemLike {
  mainGenre?: string | null;
  year?: number | null;
  ratingAvg?: number | null;
  ratingCount?: number | null;
}

export interface CatalogBucket {
  key: string;
  label: string;
  /** null when nothing in the bucket has been rated yet. */
  ratingAvg: number | null;
  ratingCount: number;
  itemCount: number;
}

type KeyOf<T> = (item: T) => { key: string; label: string } | null;

export function bucketize<T extends CatalogItemLike>(items: readonly T[], keyOf: KeyOf<T>): CatalogBucket[] {
  const map = new Map<string, { label: string; ratingSum: number; ratingCount: number; itemCount: number }>();
  for (const item of items) {
    const bucket = keyOf(item);
    if (!bucket) continue;
    const current = map.get(bucket.key) ?? { label: bucket.label, ratingSum: 0, ratingCount: 0, itemCount: 0 };
    current.itemCount += 1;
    const count = typeof item.ratingCount === "number" ? item.ratingCount : 0;
    if (typeof item.ratingAvg === "number" && count > 0) {
      current.ratingSum += item.ratingAvg * count;
      current.ratingCount += count;
    }
    map.set(bucket.key, current);
  }
  return [...map.entries()].map(([key, value]) => ({
    key,
    label: value.label,
    ratingAvg: value.ratingCount > 0 ? Number((value.ratingSum / value.ratingCount).toFixed(2)) : null,
    ratingCount: value.ratingCount,
    itemCount: value.itemCount,
  }));
}

/** Highest average first; unrated buckets sink to the bottom. */
export function byRatingDesc(buckets: readonly CatalogBucket[]): CatalogBucket[] {
  return [...buckets].sort((a, b) => (b.ratingAvg ?? -1) - (a.ratingAvg ?? -1) || b.ratingCount - a.ratingCount);
}

/** The best-scoring buckets with at least `minRatings` ratings behind them. */
export function highlights(buckets: readonly CatalogBucket[], minRatings = 3, limit = 3): CatalogBucket[] {
  return byRatingDesc(buckets.filter((bucket) => bucket.ratingAvg !== null && bucket.ratingCount >= minRatings)).slice(0, limit);
}

export const decadeOf = (year: number): string => `${Math.floor(year / 10) * 10}s`;
