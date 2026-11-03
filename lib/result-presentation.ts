/** Shared by Results, Manage previews and downloadable pages. */
export interface ResultPresentation {
  hiddenPages: string[];
  pageOrder: string[];
}

export function parseResultPresentation(raw: unknown): ResultPresentation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid result presentation");
  const value = raw as Record<string, unknown>;
  const ids = (raw: unknown) => {
    if (!Array.isArray(raw) || raw.length > 300 || raw.some((id) => typeof id !== "string" || !id.length || id.length > 160)
      || new Set(raw).size !== raw.length) throw new Error("Invalid result page list");
    return raw as string[];
  };
  return { hiddenPages: ids(value.hiddenPages), pageOrder: ids(value.pageOrder) };
}

/** Unconfigured/new pages keep their natural order after explicitly arranged pages. */
export function arrangeResultPages<T extends { id: string }>(pages: T[], settings?: ResultPresentation): T[] {
  if (!settings) return pages;
  const positions = new Map(settings.pageOrder.map((id, index) => [id, index]));
  return pages.filter((page) => !settings.hiddenPages.includes(page.id))
    .sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
}

export const RATED_RESULT_PAGES = ["rankings", "duo", "brought", "solo", "people", "details", "words"] as const;
export const DATED_RESULT_PAGES = ["streaks", "volume", "records", "words"] as const;
