// Which brand this browser is working on. Each brand is its own Dexie database, so nothing can leak
// between them; switching reloads the page, so no module holds on to the previous database. Velvra keeps
// the database name it has always had, which is why a Round 2 workspace opens untouched.
import type { Role } from "@/lib/types";

export interface Brand {
  id: string;
  name: string;
  dbName: string;
  kitId: string;
  /** The seeded demo: made-up people, marked demo addresses, and a Reset button. */
  demo: boolean;
  /** Set on a team workspace: this browser's copy syncs to the server, under the signed-in person's name and role. */
  team?: { workspaceId: string; name: string; role: Role };
}

const VELVRA: Brand = { id: "velvra", name: "Velvra", dbName: "assay", kitId: "velvra", demo: true };
const LIST = "assay:brands";
const ACTIVE = "assay:active-brand";

function read(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function listBrands(): Brand[] {
  try {
    const extra = JSON.parse(read(LIST) ?? "[]") as Brand[];
    return [VELVRA, ...extra.filter((b) => b && b.id && b.dbName && b.id !== VELVRA.id)];
  } catch {
    return [VELVRA];
  }
}

export function activeBrand(): Brand {
  const id = read(ACTIVE);
  return listBrands().find((b) => b.id === id) ?? VELVRA;
}

const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";

/** Adds a brand and returns it. The caller switches to it; its database is seeded on first open. */
export function addBrand(name: string): Brand {
  const taken = new Set(listBrands().map((b) => b.id));
  let id = slug(name);
  for (let n = 2; taken.has(id); n++) id = `${slug(name)}-${n}`;
  const brand: Brand = { id, name: name.trim(), dbName: `assay-${id}`, kitId: id, demo: false };
  window.localStorage.setItem(LIST, JSON.stringify([...listBrands().slice(1), brand]));
  return brand;
}

/** Adds a team workspace to this browser's list, or refreshes who this person is in it. Returns its brand. */
export function addTeamBrand(workspaceId: string, workspaceName: string, name: string, role: Role): Brand {
  const id = `team-${workspaceId}`;
  const brand: Brand = { id, name: workspaceName, dbName: `assay-${id}`, kitId: workspaceId, demo: false, team: { workspaceId, name, role } };
  window.localStorage.setItem(LIST, JSON.stringify([...listBrands().slice(1).filter((b) => b.id !== id), brand]));
  return brand;
}

export function switchBrand(id: string) {
  window.localStorage.setItem(ACTIVE, id);
  window.location.assign("/app");
}

export function forgetBrand(id: string) {
  window.localStorage.setItem(LIST, JSON.stringify(listBrands().slice(1).filter((b) => b.id !== id)));
  if (read(ACTIVE) === id) window.localStorage.removeItem(ACTIVE);
}
