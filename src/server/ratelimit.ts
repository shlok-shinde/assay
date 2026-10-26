// In-memory sliding-window rate limit per IP. Per serverless instance, which
// is enough to stop one visitor from draining the shared free-tier quota.

const hits = new Map<string, number[]>();

export function allow(ip: string, limit = 20, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
