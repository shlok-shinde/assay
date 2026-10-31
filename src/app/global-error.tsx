"use client";

import { useEffect } from "react";

// Replaces the root layout when that itself fails, so there is no stylesheet and no font: the colours
// are the app's night tokens, written out.
const page = { margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px", background: "#17140f", color: "#f4efe4", fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' } as const;
const panel = { width: "100%", maxWidth: 540, boxSizing: "border-box", borderRadius: 28, background: "#1e1a14", padding: "36px 32px" } as const;
const pill = { display: "inline-flex", alignItems: "center", justifyContent: "center", height: 36, padding: "0 18px", borderRadius: 999, border: 0, fontSize: 14, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", textDecoration: "none" } as const;

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={page}>
        <main style={panel}>
          <h1 style={{ margin: 0, fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 30, fontWeight: 500, lineHeight: "36px", letterSpacing: "-0.02em" }}>Assay could not start</h1>
          <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: "28px", color: "#c6bdab" }}>
            Something broke before the page could be drawn. Nothing you have written was changed: drafts are kept in this browser.
          </p>
          <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: "28px", color: "#c6bdab" }}>Try again, or go back to your drafts.</p>
          <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={() => retry()} style={{ ...pill, background: "#f4efe4", color: "#1e1a14" }}>
              Try again
            </button>
            <a href="/app" style={{ ...pill, background: "transparent", color: "#f4efe4" }}>
              Back to drafts
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
