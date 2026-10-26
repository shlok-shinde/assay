import { connection } from "next/server";
import { sharedPool } from "@/server/ai/keys";
import { modelChain } from "@/server/ai/gemini";

// Never returns a key value: only whether AI is configured, how many keys
// there are, how many are usable right now, and the model chain.
export async function GET() {
  await connection();
  const pool = sharedPool();
  const { keyCount, keysAvailable } = pool.status();
  return Response.json(
    { aiConfigured: keyCount > 0, keyCount, keysAvailable, models: { judge: modelChain("judge"), lite: modelChain("lite") } },
    { headers: { "cache-control": "no-store" } },
  );
}
