import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database, advisoryKey } from "./database.ts";
/** Shared across worker replicas. Configure the same cap on every replica.
 * The lease exceeds provider timeouts; a heartbeat preserves long valid work.
 * This bounds in-flight calls, not account RPM/TPM quotas. */
export async function withProviderSlot<T>(
  provider: string,
  operation: () => Promise<T>,
): Promise<T> {
  provider = z.string().min(1).max(100).parse(provider);
  const cap = z.coerce
    .number()
    .int()
    .min(1)
    .max(64)
    .parse(process.env.YTI_PROVIDER_CONCURRENCY ?? 8);
  const id = randomUUID();
  const started = Date.now();
  while (true) {
    const acquired = await database.transaction(async () => {
      await database
        .prepare("SELECT pg_advisory_xact_lock($1::bigint)")
        .get(advisoryKey("yi:provider:" + provider));
      await database
        .prepare(
          "DELETE FROM yi_provider_slots WHERE provider=$1 AND lease_until<now()",
        )
        .run(provider);
      const row = await database
        .prepare(
          "SELECT count(*) AS n FROM yi_provider_slots WHERE provider=$1",
        )
        .get(provider);
      if (Number(row?.n) >= cap) return false;
      await database
        .prepare(
          "INSERT INTO yi_provider_slots VALUES($1,$2,now()+interval '10 minutes')",
        )
        .run(id, provider);
      return true;
    });
    if (acquired) break;
    if (Date.now() - started > 600000)
      throw Error(
        "Provider capacity wait exceeded ten minutes; no new provider request started.",
      );
    await new Promise((r) => setTimeout(r, 100));
  }
  const timer = setInterval(() => {
    void database
      .prepare(
        "UPDATE yi_provider_slots SET lease_until=now()+interval '10 minutes' WHERE id=$1",
      )
      .run(id)
      .catch(() => undefined);
  }, 30000);
  timer.unref();
  try {
    return await operation();
  } finally {
    clearInterval(timer);
    await database.prepare("DELETE FROM yi_provider_slots WHERE id=$1").run(id);
  }
}
