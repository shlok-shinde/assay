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
};

export default nextConfig;
