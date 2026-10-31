import Link from "next/link";
import { StatusPanel } from "@/components/ui";

export const metadata = { title: "Page not found" };

// Any address Assay has no page for. Drafts live only in the browser that made them, which is the
// likeliest reason a link from someone else lands here.
export default function NotFound() {
  return (
    <StatusPanel
      fullscreen
      title="This page isn't here"
      actions={
        <Link href="/app" className="btn btn-inverse btn-lg">
          Back to drafts
        </Link>
      }
    >
      <p>The address may be mistyped, or the page may have moved.</p>
      <p>If you were sent a link to a draft, note that drafts stay in the browser that made them, so it will not open in another one.</p>
    </StatusPanel>
  );
}
