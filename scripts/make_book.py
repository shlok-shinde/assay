#!/usr/bin/env python3
"""Renders the fictional Velvra Brand Book from src/seed/velvra-book.json to public/samples/velvra-brand-book.pdf.

The JSON is the single source: every page, paragraph ID and citation. src/seed/velvra-book.test.ts proves that
each paragraph lands on the page it claims, so a layout change that pushes text to the next page fails the tests.

Run: pnpm book   (needs Chromium at $CHROMIUM or /usr/bin/chromium; fonts come from Google Fonts and are embedded)
The cover photo is the same generated product photo as the sample creatives (see scripts/make_samples.py).
"""
import html
import json
import os
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOK = json.load(open(os.path.join(ROOT, "src", "seed", "velvra-book.json"), encoding="utf-8"))
OUT = os.path.join(ROOT, "public", "samples", "velvra-brand-book.pdf")
PHOTO = os.path.join(ROOT, "scripts", "assets", "velvra-tube-photo-rose-clay.jpg")
CHROMIUM = os.environ.get("CHROMIUM", "/usr/bin/chromium")

CSS = """
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;600&display=block');
@page { size: 148mm 210mm; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; background: #FBF6EF; color: #1F1B24; font-family: Inter, 'DejaVu Sans', sans-serif; }
.page { position: relative; width: 148mm; height: 210mm; padding: 16mm 15mm 18mm; overflow: hidden; page-break-after: always; background: #FBF6EF; }
.page:last-child { page-break-after: auto; }
.chapter { font: 600 29pt/1.12 Fraunces, 'DejaVu Serif', serif; margin: 0 0 8mm; padding-bottom: 5mm; border-bottom: 1.4pt solid #C98B7F; letter-spacing: -0.01em; }
h2 { font: 600 16pt/1.25 Fraunces, 'DejaVu Serif', serif; margin: 6mm 0 2.5mm; }
.chapter + h2, .page > h2:first-child { margin-top: 0; }
h3 { font: 600 12.5pt/1.3 Fraunces, 'DejaVu Serif', serif; margin: 4.5mm 0 1mm; }
p { font-size: 12.6pt; line-height: 1.5; margin: 0 0 3.2mm; }
ul { margin: 0 0 2mm; padding: 0; list-style: none; }
li { font-size: 11.4pt; line-height: 1.42; margin: 0 0 1.5mm; padding-left: 3.6mm; position: relative; }
li::before { content: ""; position: absolute; left: 0; top: 2.2mm; width: 1.5mm; height: 1.5mm; border-radius: 50%; background: #C98B7F; }
.example { font-size: 11.6pt; line-height: 1.42; margin: 0 0 1.8mm; padding: 2.2mm 3.4mm; border-radius: 3mm; background: #EADCCB; }
.foot { position: absolute; left: 15mm; right: 15mm; bottom: 8mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: #5f5a4f; }
.cover { padding: 0; background: #C98B7F; }
.cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cover .band { position: absolute; left: 0; right: 0; bottom: 0; padding: 12mm 15mm 14mm; background: #1F1B24; color: #FBF6EF; }
.cover .word { font: 600 44pt/1 Fraunces, 'DejaVu Serif', serif; letter-spacing: -0.015em; margin: 0; }
.cover .sub { font-size: 11pt; margin: 3mm 0 0; }
.swatches { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1.6mm; margin: 2mm 0 4mm; }
.swatch { height: 25mm; border-radius: 3mm; padding: 1.5mm; display: flex; align-items: flex-end; font-size: 7.2pt; line-height: 1.2; box-shadow: inset 0 0 0 0.6pt rgb(31 27 36 / 0.14); }
.logo { display: flex; justify-content: center; margin: 5mm 0 6mm; }
.logo .clear { border: 0.7pt dashed #C98B7F; border-radius: 3mm; padding: 9mm; }
.logo .word { font: 600 34pt/1 Inter, 'DejaVu Sans', sans-serif; letter-spacing: 0.01em; }
"""


def esc(text):
    return html.escape(text, quote=False)


def swatch(item):
    name, hexa = item.rsplit(" ", 1)
    light = hexa in ("#1F1B24",)
    return f"<div class='swatch' style='background:{hexa};color:{'#FBF6EF' if light else '#1F1B24'}'><span>{esc(name)}<br>{esc(hexa)}</span></div>"


def block(b):
    kind, text = b["kind"], b["text"]
    para = f" id='{esc(b['id'])}'" if "id" in b else ""
    if kind == "chapter":
        return f"<div class='chapter'>{esc(text)}</div>"
    if kind in ("h2", "h3"):
        return f"<{kind}>{esc(text)}</{kind}>"
    if kind == "p":
        return f"<p{para}>{esc(text)}</p>"
    if kind == "li":
        return f"<ul><li{para}>{esc(text)}</li></ul>"
    if kind == "example":
        return f"<div class='example'{para}>{esc(text)}</div>"
    if kind == "palette":
        return "<div class='swatches'>" + "".join(swatch(i) for i in text.split("|")) + "</div>"
    if kind == "logo":
        return f"<div class='logo'><div class='clear'><span class='word'>{esc(text)}</span></div></div>"
    raise ValueError(kind)


def render_page(page):
    if page["blocks"][0]["kind"] == "cover":
        return (
            f"<section class='page cover'><img src='file://{PHOTO}' alt=''>"
            f"<div class='band'><p class='word'>velvra</p><p class='sub'>{esc(page['blocks'][0]['text'])}</p></div></section>"
        )
    body = "".join(block(b) for b in page["blocks"])
    return f"<section class='page'>{body}<div class='foot'><span>{esc(BOOK['title'])}</span><span>{page['page']}</span></div></section>"


with tempfile.TemporaryDirectory() as tmp:
    src = os.path.join(tmp, "book.html")
    with open(src, "w", encoding="utf-8") as f:
        f.write(f"<!doctype html><html lang='en'><meta charset='utf-8'><title>{esc(BOOK['title'])}</title><style>{CSS}</style>")
        f.write("".join(render_page(p) for p in BOOK["pages"]))
    subprocess.run(
        [CHROMIUM, "--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", "--allow-file-access-from-files",
         "--virtual-time-budget=15000", f"--print-to-pdf={OUT}", "file://" + src],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
print("Wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
