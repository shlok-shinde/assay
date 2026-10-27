import type { NextConfig } from "next";

// Assay's workspace lives in the browser (IndexedDB), so pages are client
// rendered and Cache Components / partial prefetching are not used.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  poweredByHeader: false,
  // The OCR and PDF workers (about 7 MB) change only with a library upgrade: cache them for a day,
  // so a redeploy does not make every returning browser download them again.
  async headers() {
    return [{ source: "/vendor/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] }];
  },
};

export default nextConfig;
