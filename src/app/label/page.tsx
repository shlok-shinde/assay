import { LabelApp } from "@/components/LabelApp";

// Anonymous, for people who are not in the app: no index, no app title in the tab.
export const metadata = { title: { absolute: "Check some drafts" }, robots: { index: false, follow: false } };

export default function LabelPage() {
  return <LabelApp />;
}
