import { Suspense } from "react";
import { SubmissionRoute } from "./route-client";
import { PageLoading } from "@/components/ui";

export const metadata = { title: "Draft" };

export default function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageLoading label="Opening the draft…" />}>
      <SubmissionRoute params={params} />
    </Suspense>
  );
}
