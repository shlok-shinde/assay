import { Suspense } from "react";
import { NewDraft } from "@/components/NewDraft";

export const metadata = { title: "New draft" };

export default function NewDraftPage() {
  return (
    <Suspense>
      <NewDraft />
    </Suspense>
  );
}
