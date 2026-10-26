"use client";

import { use } from "react";
import { SubmissionView } from "@/components/SubmissionView";

export function SubmissionRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SubmissionView id={id} />;
}
