#!/usr/bin/env python3
"""Generates the demo files in public/samples from the fictional Velvra content.

- velvra-monsoon-creative.png  Instagram creative (#FF5FA2 ground, a low-contrast headline, a 96 px logo)
- velvra-product-page.docx     product page copy, as a minimal Word file
- velvra-brochure.pdf          two-page brochure with a real text layer
- velvra-brand-book-update.pdf brand-book pages for the "import" demo

Run: python3 scripts/make_samples.py   (needs Chromium at $CHROMIUM or /usr/bin/chromium)
The text matches src/seed/samples.ts.
"""
import html
import os
import subprocess
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "samples")
CHROMIUM = os.environ.get("CHROMIUM", "/usr/bin/chromium")
os.makedirs(OUT, exist_ok=True)

BASE_CSS = """
@page { size: A5; margin: 18mm; }
body { font-family: 'DejaVu Sans', Arial, sans-serif; color: #1F1B24; }
h1 { font-size: 22pt; margin: 0 0 10pt; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; }
p { font-size: 11pt; line-height: 1.45; margin: 0 0 9pt; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.meta { color: #5f5a4f; font-size: 9pt; }
"""


def chromium(args):
    subprocess.run([CHROMIUM, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", *args], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def pdf(name, body):
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "doc.html")
        with open(src, "w") as f:
            f.write(f"<!doctype html><meta charset='utf-8'><style>{BASE_CSS}</style>{body}")
        chromium(["--no-pdf-header-footer", f"--print-to-pdf={os.path.join(OUT, name)}", "file://" + src])


def paragraphs(text):
    return "".join(f"<p>{html.escape(p)}</p>" for p in text.strip().split("\n\n"))


# 1. The Instagram creative --------------------------------------------------
CREATIVE = """<!doctype html><meta charset='utf-8'><style>
html,body{margin:0;width:1080px;height:1080px;overflow:hidden}
body{background:#FF5FA2;font-family:'DejaVu Sans',Arial,sans-serif;position:relative}
.headline{position:absolute;left:64px;top:96px;width:900px;font-size:96px;line-height:1.05;font-weight:700;color:#FFB4D2;letter-spacing:-1px}
.tube{position:absolute;right:120px;top:420px;width:300px;height:470px;background:#EADCCB;border-radius:40px 40px 22px 22px}
.cap{position:absolute;right:170px;top:360px;width:200px;height:80px;background:#1F1B24;border-radius:18px 18px 6px 6px}
.label{position:absolute;right:150px;top:560px;width:240px;font-size:34px;font-weight:700;color:#1F1B24;line-height:1.2}
.logo{position:absolute;left:64px;top:940px;width:96px;height:34px;font-size:27px;font-weight:700;color:#1F1B24;letter-spacing:0.5px}
</style>
<div class='headline'>Glow like<br>never before</div>
<div class='cap'></div><div class='tube'></div>
<div class='label'>Daily Shield<br>SPF 50</div>
<div class='logo'>velvra</div>"""

with tempfile.TemporaryDirectory() as tmp:
    src = os.path.join(tmp, "creative.html")
    with open(src, "w") as f:
        f.write(CREATIVE)
    chromium(["--window-size=1080,1080", "--force-device-scale-factor=1", f"--screenshot={os.path.join(OUT, 'velvra-monsoon-creative.png')}",
              "file://" + src])

# 2. The product page DOCX ---------------------------------------------------
PRODUCT = """Daily Shield SPF 50

Meet Daily Shield SPF 50, the lightweight sunscreen for whitening and everyday protection. Visible results guaranteed.

Its niacinamide blend treats acne while it protects, and it is water-resistant for 40 minutes.

₹649 for 50 ml. Reapply every 2 hours, and after swimming or sweating."""


def docx(name, text):
    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    paras = "".join(
        f"<w:p><w:r><w:t xml:space='preserve'>{html.escape(p)}</w:t></w:r></w:p>" for p in text.strip().split("\n\n")
    )
    files = {
        "[Content_Types].xml": "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
        "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'>"
        "<Default Extension='rels' ContentType='application/vnd.openxmlformats-package.relationships+xml'/>"
        "<Default Extension='xml' ContentType='application/xml'/>"
        "<Override PartName='/word/document.xml' ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'/>"
        "</Types>",
        "_rels/.rels": "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
        "<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>"
        "<Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' Target='word/document.xml'/>"
        "</Relationships>",
        "word/document.xml": f"<?xml version='1.0' encoding='UTF-8' standalone='yes'?><w:document xmlns:w='{W}'><w:body>{paras}</w:body></w:document>",
    }
    with zipfile.ZipFile(os.path.join(OUT, name), "w", zipfile.ZIP_DEFLATED) as z:
        for path, content in files.items():
            z.writestr(path, content)


docx("velvra-product-page.docx", PRODUCT)

# 3. The two-page brochure -----------------------------------------------------
PAGE1 = """Velvra Daily Shield SPF 50

Everyday protection, made for Indian weather. Dermatologist-tested and fragrance-free.

SPF 50 PA++++ broad-spectrum protection in a light gel."""
PAGE2 = """Why people switch

Clinically proven: 90% saw brighter skin.

The No. 1 sunscreen in India, with permanent results.

₹649 for 50 ml at your nearest pharmacy."""
pdf("velvra-brochure.pdf", f"<div class='page'>{paragraphs(PAGE1)}</div><div class='page'>{paragraphs(PAGE2)}</div>")

# 4. Brand-book update pages for the import demo -----------------------------
BOOK = [
    """Velvra Brand Book v3: update pages

These pages add guidance agreed after the monsoon campaign. Fictional demo document.""",
    """Social channels

LinkedIn posts must use no more than three hashtags.

Never call a product a miracle, in any channel.

Always credit the creator when we repost their photo or video.""",
    """Language

Avoid "anti-ageing"; say "age-aware care" instead.

Don't describe skin tones as good or bad.

We like to keep sentences short, but this is a preference rather than a rule.""",
    """Email

Email subject lines must stay under 60 characters.

Every promotional email must include an unsubscribe line.""",
]
pdf("velvra-brand-book-update.pdf", "".join(f"<div class='page'>{paragraphs(p)}</div>" for p in BOOK))

print("Wrote:", ", ".join(sorted(os.listdir(OUT))))
