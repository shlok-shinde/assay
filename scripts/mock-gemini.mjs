// A local stand-in for the Gemini REST API, used to test the server's AI path
// end to end without a real key: key rotation on 429, model fallback on 404,
// JSON output, and what the route does with the answer.
// Usage: node scripts/mock-gemini.mjs [port]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3999);
let calls = 0;

createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  calls++;
  const key = req.headers["x-goog-api-key"];
  const model = decodeURIComponent((req.url.match(/models\/([^:]+):/) ?? [])[1] ?? "");
  const send = (status, json) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(json));
  };
  console.log(`call ${calls}: model=${model} key=${key === "mock-key-a" ? "A" : key === "mock-key-b" ? "B" : "?"}`);
  if (key === "mock-key-a") return send(429, { error: { code: 429, message: "Resource exhausted", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30s" }] } });
  if (model === "gemini-3.8-flash" || model === "gemini-3.5-flash-lite") return send(404, { error: { code: 404, message: "model not found" } });
  const req1 = JSON.parse(body);
  const input = JSON.parse(req1.contents[0].parts[0].text);
  let out = {};
  if (input.segments) {
    const findings = [];
    for (const s of input.segments) {
      const at = s.text.indexOf("OMG");
      if (at >= 0) findings.push({ segment: s.id, rule_id: "VOICE-02", quote: "OMG", start: at, end: at + 3, reason: "Hype word the rule names.", fix: "Meet", confidence: 0.86 });
      const sh = s.text.indexOf("Shop now");
      if (sh >= 0) findings.push({ segment: s.id, rule_id: "MSG-01", quote: "Shop now", start: sh, end: sh + 8, reason: "The launch message does not mention either pillar.", fix: "", confidence: 0.62 });
      findings.push({ segment: s.id, rule_id: "VOICE-01", quote: "words the model made up", start: 0, end: 5, reason: "Invented evidence.", fix: "", confidence: 0.9 });
      if (s.text.includes("[EMAIL]")) console.log("  redaction seen: [EMAIL] placeholder reached the model");
    }
    out = { findings, factChoices: [] };
  } else if (input.before !== undefined) out = { kept: true, explanation: "Still about daily protection and still asks people to shop." };
  else if (input.text !== undefined) out = { goal: "Launch awareness", keyMessage: "Daily sun protection", cta: "Shop via link in bio" };
  else if (input.pages) out = { rules: [{ title: "Hashtag limit on LinkedIn", text: "LinkedIn posts use no more than three hashtags.", category: "accessibility", severity: "low", page: 2, quote: "LinkedIn posts must use no more than three hashtags." }] };
  else if (input.rule) out = { text: `${input.rule.text} Exception: informal slang is fine for Gen Z campaigns with reviewer sign-off.`, dos: ["ok this SPF feels light"], donts: ["insane results!!!"], rationale: "Most dismissals came from Gen Z campaigns." };
  send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
}).listen(port, () => console.log(`mock Gemini on http://localhost:${port}/v1beta`));
