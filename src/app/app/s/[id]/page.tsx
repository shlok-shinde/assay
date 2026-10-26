import { Suspense } from "react";
import { SubmissionRoute } from "./route-client";

export const metadata = { title: "Draft" };

export default function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading the draft…</div>}>
      <SubmissionRoute params={params} />
    </Suspense>
  );
}
