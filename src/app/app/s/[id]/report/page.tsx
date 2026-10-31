import { Suspense } from "react";
import { ReportRoute } from "./route-client";
import { PageLoading } from "@/components/ui";

export const metadata = { title: "Draft report" };

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageLoading label="Opening the report…" />}>
      <ReportRoute params={params} />
    </Suspense>
  );
}
