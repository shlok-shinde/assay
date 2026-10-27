import { PageLoading } from "@/components/ui";

// Shown while an app screen's code loads on a slow connection.
export default function Loading() {
  return <PageLoading label="Opening Assay…" />;
}
