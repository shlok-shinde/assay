// Team workspaces: records every local write so the sync loop can send it. It sits underneath Dexie, so all of actions.ts
// is captured without knowing about teams. The note is written just after each transaction commits, because a store
// transaction's scope doesn't include syncRows; the window is milliseconds, and only a tab dying inside it can lose one.
import type { DBCore, DBCoreMutateRequest, DBCoreTable, Middleware } from "dexie";
import type Dexie from "dexie";
import { isSyncedTable } from "@/lib/team-rules";

/** Writes applied from the server carry this mark on their transaction, so they aren't sent straight back. */
export const FROM_SERVER = "__assayFromServer";

const keysOf = (table: DBCoreTable, req: DBCoreMutateRequest): unknown[] => {
  if (req.type === "delete") return [...req.keys];
  if (req.type === "add" || req.type === "put") return req.keys ? [...req.keys] : req.values.map((v) => table.schema.primaryKey.extractKey!(v));
  return [];
};

export function captureChanges(db: Dexie) {
  const middleware: Middleware<DBCore> = {
    stack: "dbcore",
    name: "assay-sync-capture",
    create(down) {
      return {
        ...down,
        table(name) {
          const table = down.table(name);
          if (!isSyncedTable(name)) return table;
          return {
            ...table,
            async mutate(req) {
              const res = await table.mutate(req);
              const trans = req.trans as unknown as IDBTransaction & Record<string, unknown>;
              if (trans[FROM_SERVER]) return res;
              const keys = keysOf(table, req).map(String);
              if (req.type === "deleteRange") return res;
              const note = () => {
                const at = new Date().toISOString();
                void (db as unknown as { syncRows: { bulkAdd(rows: unknown[]): Promise<unknown> } }).syncRows.bulkAdd(keys.map((rowId) => ({ tbl: name, rowId, op: req.type === "delete" ? "delete" : "put", at }))).then(() => window.dispatchEvent(new Event(CHANGED_EVENT)));
              };
              trans.addEventListener("complete", note, { once: true });
              return res;
            },
          };
        },
      };
    },
  };
  db.use(middleware);
}

export const CHANGED_EVENT = "assay:local-change";
