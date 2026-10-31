"use client";

import Link from "next/link";
import { useEffect } from "react";
import { StatusPanel } from "@/components/ui";

// A screen inside the app broke. The frame (menu, role switcher) is still working around it.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusPanel
      title="This screen stopped working"
      actions={
        <>
          <button type="button" className="btn btn-inverse btn-lg" onClick={() => retry()}>
            Try again
          </button>
          <Link href="/app" className="btn btn-ghost btn-lg">
            Back to drafts
          </Link>
        </>
      }
    >
      <p>Your drafts are safe. Assay keeps them in this browser, and a screen that stops working does not change them.</p>
      <p>Try again, or go back to the drafts list and open it from there.</p>
    </StatusPanel>
  );
}
