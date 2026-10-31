import { Suspense } from "react";
import { BookPageView } from "@/components/BookPageView";
import { PageLoading } from "@/components/ui";

export const metadata = { title: "Brand book" };

export default function BookPage() {
  return (
    <Suspense fallback={<PageLoading label="Opening the brand book…" />}>
      <BookPageView />
    </Suspense>
  );
}
