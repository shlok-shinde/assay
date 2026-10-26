import { Suspense } from "react";
import { KitView } from "@/components/KitView";

export const metadata = { title: "Brand Kit" };

export default function KitPage() {
  return (
    <Suspense>
      <KitView />
    </Suspense>
  );
}
