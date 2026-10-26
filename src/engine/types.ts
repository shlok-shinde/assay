import type { Category, ClaimStatus, Fix, Severity } from "@/lib/types";

/** A finding before it is stored: the engine's output, with no ids or status yet. */
export interface RawFinding {
  ruleId: string;
  relatedRuleIds: string[];
  factId?: string;
  claimStatus?: ClaimStatus;
  category: Category;
  severity: Severity;
  origin: "rule" | "ai";
  model?: string;
  confidence?: number;
  suggestion?: boolean;
  start: number;
  end: number;
  quote: string;
  page?: number;
  region?: { x: number; y: number; w: number; h: number };
  title: string;
  reason: string;
  fix?: Fix;
  cached?: { model: string; at: string };
}

export const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const;
