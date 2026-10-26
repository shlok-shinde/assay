"use client";

import { diff_match_patch, DIFF_DELETE, DIFF_INSERT } from "diff-match-patch";

export function diffParts(a: string, b: string) {
  const dmp = new diff_match_patch();
  const d = dmp.diff_main(a, b);
  dmp.diff_cleanupSemantic(d);
  return d;
}

/** A word-level diff between two versions: deletions struck through, insertions marked. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = diffParts(before, after);
  return (
    <div className="whitespace-pre-wrap text-[14px] leading-[26px]">
      {parts.map(([op, s], i) =>
        op === DIFF_DELETE ? (
          <del key={i} className="diff-del">
            {s}
          </del>
        ) : op === DIFF_INSERT ? (
          <ins key={i} className="diff-ins">
            {s}
          </ins>
        ) : (
          <span key={i}>{s}</span>
        ),
      )}
    </div>
  );
}
