// Answers from the /label page. Labellers are anonymous codes, and a labeller's newest answer on a draft
// replaces their older one. A draft or rule the manifest doesn't list is refused.
import { z } from "zod";
import manifest from "../../public/label/manifest.json";
import { database, ensureTable } from "./db";

const ITEMS = new Set(manifest.items.map((i) => i.id));
const RULES = new Set(manifest.rules.map((r) => r.id));

export const labelInput = z.object({
  coder: z.string().regex(/^[a-z0-9-]{4,40}$/),
  itemId: z.string().refine((id) => ITEMS.has(id)),
  ruleIds: z.array(z.string().refine((id) => RULES.has(id))).max(25),
  ms: z.number().int().min(0).max(3_600_000).optional(),
});

const table = () =>
  ensureTable(
    "label_answers",
    "CREATE TABLE IF NOT EXISTS label_answers (coder text NOT NULL, item_id text NOT NULL, rule_ids jsonb NOT NULL, ms integer, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (coder, item_id))",
  );

export async function saveLabel(a: z.infer<typeof labelInput>): Promise<void> {
  await table();
  await database()!.query(
    "INSERT INTO label_answers (coder, item_id, rule_ids, ms) VALUES ($1, $2, $3, $4) ON CONFLICT (coder, item_id) DO UPDATE SET rule_ids = EXCLUDED.rule_ids, ms = EXCLUDED.ms, at = now()",
    [a.coder, a.itemId, JSON.stringify(a.ruleIds), a.ms ?? null],
  );
}

/** How many labels each draft has, and which this labeller has done, so the page can hand out the next batch. */
export async function labelProgress(coder: string) {
  await table();
  const { rows } = await database()!.query<{ item_id: string; n: number; mine: boolean }>(
    "SELECT item_id, count(*)::int n, bool_or(coder = $1) mine FROM label_answers GROUP BY item_id",
    [coder],
  );
  return { counts: Object.fromEntries(rows.map((r) => [r.item_id, r.n])), mine: rows.filter((r) => r.mine).map((r) => r.item_id) };
}

export async function allLabels() {
  await table();
  const { rows } = await database()!.query("SELECT coder, item_id, rule_ids, ms, at FROM label_answers ORDER BY at");
  return rows;
}
