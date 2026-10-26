// Copies the browser-side worker and data files that pdfjs-dist and tesseract.js
// load at runtime into public/vendor, so the app never fetches them from a CDN.
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = join(process.cwd(), "public", "vendor");
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const tesseractDir = pkgDir("tesseract.js");
const coreDir = dirname(createRequire(join(tesseractDir, "package.json")).resolve("tesseract.js-core/package.json"));

const files = [
  [join(pkgDir("pdfjs-dist"), "build", "pdf.worker.min.mjs"), join(out, "pdfjs", "pdf.worker.min.mjs")],
  [join(tesseractDir, "dist", "worker.min.js"), join(out, "tesseract", "worker.min.js")],
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map((f) => [
    join(coreDir, f),
    join(out, "tesseract", "core", f),
  ]),
  [join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), join(out, "tesseract", "lang", "eng.traineddata.gz")],
];

for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`Missing vendor file: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}
console.log(`copy-vendor: ${files.length} files copied to public/vendor`);
