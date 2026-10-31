// What a workspace export must hold before an import may replace anything. It checks the fields the
// app reads without looking twice, and passes everything else through, so older exports still load.
import { z } from "zod";
import type { TableName } from "./db";

const id = z.string().min(1);
const rows = <T extends z.ZodRawShape>(shape: T) => z.array(z.looseObject(shape)).default([]);

const FILE = z.object({
  app: z.literal("assay"),
  format: z.literal(1),
  data: z.looseObject({
    kits: z.array(z.looseObject({ id, name: z.string(), rules: z.array(z.looseObject({ id })), facts: z.array(z.looseObject({ id })) })).min(1),
    rulebooks: z.array(z.looseObject({ id, version: z.string(), hash: z.string(), snapshot: z.looseObject({ rules: z.array(z.unknown()) }) })).min(1),
    submissions: rows({ id, status: z.enum(["draft", "checked", "in_review", "changes_requested", "approved"]), title: z.string() }),
    versions: rows({ id, submissionId: id, n: z.number(), text: z.string() }),
    checks: rows({ id, submissionId: id, versionId: id }),
    findings: rows({ id, submissionId: id, versionId: z.string(), ruleId: z.string(), status: z.string(), start: z.number(), end: z.number() }),
    hallmarks: rows({ id, seq: z.number(), hash: z.string(), versionId: id }),
    blobs: rows({ hash: id, dataUrl: z.string() }),
  }),
});

/** The tables of a valid export for this kit. Throws a plain sentence saying what is wrong with anything else. */
export function readWorkspaceFile(json: string, kitId: string): Partial<Record<TableName, unknown[]>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const head = parsed as { app?: unknown; format?: unknown } | null;
  if (head?.app !== "assay" || head.format !== 1) throw new Error("That file is not an Assay workspace export.");
  const result = FILE.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`That export is damaged, so nothing was changed. The problem is at ${issue.path.join(".")}.`);
  }
  const data = result.data.data;
  if (!data.kits.some((k) => k.id === kitId)) throw new Error(`That export is for another brand (${data.kits[0].name}), so nothing was changed. Switch to that brand and import it there.`);
  return data as unknown as Partial<Record<TableName, unknown[]>>;
}
