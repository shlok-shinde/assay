import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Assay: brand content, tested before it ships", template: "%s · Assay" },
  description:
    "Assay checks drafts against a brand's approved rules, facts and assets, explains every issue with its source, suggests a fix that keeps the message, and routes it to a human for approval. CodeStar 30 Round 2, team 24K MAGIC.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${fraunces.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
