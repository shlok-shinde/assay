"use client";

import Link from "next/link";
import { useEffect } from "react";
import { StatusPanel } from "@/components/ui";

// The last net: anything that breaks outside a working screen (the landing page, the About page, the
// app's own frame) lands here instead of on a blank page.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusPanel
      fullscreen
      title="Something went wrong"
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
      <p>Assay hit a problem it did not expect and stopped this page. Nothing you have written was changed by it.</p>
      <p>Trying again often clears it. If it comes back, reload the page.</p>
    </StatusPanel>
  );
}
