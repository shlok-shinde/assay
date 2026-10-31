// A small reader for the Markdown this app writes (a draft's report): headings, bullet lists, tables, fenced code,
// paragraphs, and inline code. Nothing here makes HTML: it returns plain blocks, and the page puts each piece of
// text into the document as text, so nothing in a draft can run or restyle the page.

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "code"; text: string };

/** Splits a table row on the bars that are not escaped, and unescapes the ones that are. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out: string[] = [];
  let cell = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && inner[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (inner[i] === "|") {
      out.push(cell.trim());
      cell = "";
    } else cell += inner[i];
  }
  out.push(cell.trim());
  return out;
}

const isRule = (line: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      i++;
      continue;
    }
    if (line.trimStart().startsWith("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^[-*]\s+/, "").trim());
      blocks.push({ kind: "list", items });
      continue;
    }
    const text: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^#{1,3}\s/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !lines[i].trimStart().startsWith("|")) text.push(lines[i++].trim());
    if (!text.length) {
      // A line that starts like a table but is not one: kept as text, so the loop always moves on.
      text.push(lines[i++].trim());
    }
    blocks.push({ kind: "paragraph", text: text.join(" ") });
  }
  return blocks;
}

/** Text with `code` spans picked out. Backticks are the only markup. */
export function inlineParts(text: string): { code: boolean; text: string }[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((part) => (part.length > 1 && part.startsWith("`") && part.endsWith("`") ? { code: true, text: part.slice(1, -1) } : { code: false, text: part }));
}
