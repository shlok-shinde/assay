"use client";

import { use } from "react";
import { ReportView } from "@/components/ReportView";

export function ReportRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReportView id={id} />;
}
