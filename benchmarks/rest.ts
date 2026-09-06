import { REST } from "../packages/rest/src/index.ts";

const iterations = Number(process.env.BENCH_ITERATIONS ?? 10_000);
if (!Number.isInteger(iterations) || iterations <= 0)
  throw new RangeError("BENCH_ITERATIONS must be a positive integer");

const originalFetch = globalThis.fetch;
(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-remaining": "999",
      "x-ratelimit-reset-after": "1",
      "x-ratelimit-bucket": "benchmark-bucket",
    },
  });

function bench(name: string, operation: () => Promise<void>): Promise<void> {
  return (async () => {
    for (let i = 0; i < Math.min(100, iterations); i++) await operation();
    const start = Bun.nanoseconds();
    for (let i = 0; i < iterations; i++) await operation();
    const elapsed = Bun.nanoseconds() - start;
    console.log(
      `${name}: ${(elapsed / iterations).toFixed(2)} ns/op (${iterations} iterations)`,
    );
  })();
}

try {
  const rest = new REST({ token: "benchmark", retries: 0 });
  await bench("rest.get", async () => {
    await rest.get<{ ok: boolean }>("/users/@me");
  });
  await bench("rest.post-json", async () => {
    await rest.post<{ ok: boolean }>("/channels/1/messages", {
      content: "benchmark",
    });
  });
  console.log(`Lunibee REST benchmarks complete (iterations=${iterations}).`);
} finally {
  globalThis.fetch = originalFetch;
}
