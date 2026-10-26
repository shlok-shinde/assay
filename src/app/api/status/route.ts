import { connection } from "next/server";
import { sharedPool } from "@/server/ai/keys";
import { modelChain } from "@/server/ai/gemini";

// Never returns a key value: only whether AI is configured, how many keys
// there are, how many can serve at least one model right now, and the model chain.
export async function GET() {
  await connection();
  const pool = sharedPool();
  const models = { judge: modelChain("judge"), lite: modelChain("lite") };
  const { keyCount, keysAvailable } = pool.status([...models.judge, ...models.lite]);
  return Response.json(
    { aiConfigured: keyCount > 0, keyCount, keysAvailable, models },
    { headers: { "cache-control": "no-store" } },
  );
}
