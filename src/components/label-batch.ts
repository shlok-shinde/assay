// Which drafts a labeller is handed next. Kept apart from the page so it can be tested alone.

/** How many drafts make a set. */
export const BATCH = 20;

/** Drafts this person has not done, those with the fewest labels first, then in the manifest's order. */
export function pickBatch(items: { id: string }[], counts: Record<string, number>, done: Set<string>, size = BATCH): string[] {
  return items
    .map((it, i) => ({ id: it.id, n: counts[it.id] ?? 0, i }))
    .filter((x) => !done.has(x.id))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .slice(0, size)
    .map((x) => x.id);
}
