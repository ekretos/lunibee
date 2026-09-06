/**
 * Repro: measures REST throughput across N distinct channels.
 * Simulates Discord's real model: each (bucket_hash, major_param) pair has its
 * own independent limit. Here: 5 requests per 200ms window PER CHANNEL.
 */
import { REST } from "./packages/rest/src/index.ts";

const LIMIT = 5;
const WINDOW_MS = 200;
const SERVER_LATENCY_MS = 5;

type Win = { count: number; start: number };
const windows = new Map<string, Win>();

function majorOf(url: string): string {
  const m = /\/channels\/(\d+)/.exec(url);
  return m ? m[1]! : "global";
}

let served = 0;

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const major = majorOf(url);
  const now = Date.now();
  let w = windows.get(major);
  if (!w || now - w.start >= WINDOW_MS) {
    w = { count: 0, start: now };
    windows.set(major, w);
  }
  w.count++;
  await Bun.sleep(SERVER_LATENCY_MS);
  const resetAfter = Math.max(0, (w.start + WINDOW_MS - Date.now()) / 1000);

  if (w.count > LIMIT) {
    return new Response(JSON.stringify({ message: "rate limited", retry_after: resetAfter }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "X-RateLimit-Bucket": `bucket-messages`,
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset-After": String(resetAfter),
        "Retry-After": String(resetAfter),
      },
    });
  }
  served++;
  return new Response(JSON.stringify({ id: "1" }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      // Discord returns the SAME hash for the same endpoint across channels.
      "X-RateLimit-Bucket": `bucket-messages`,
      "X-RateLimit-Remaining": String(Math.max(0, LIMIT - w.count)),
      "X-RateLimit-Reset-After": String(resetAfter),
    },
  });
}) as any;

const CHANNELS = Number(process.env.CHANNELS ?? 8);
const PER_CHANNEL = Number(process.env.PER_CHANNEL ?? 5);

const rest = new REST({ token: "t", retries: 5 });

const start = Bun.nanoseconds();
const jobs: Promise<unknown>[] = [];
for (let c = 0; c < CHANNELS; c++) {
  const channelId = String(100000000000000000n + BigInt(c));
  for (let i = 0; i < PER_CHANNEL; i++) {
    jobs.push(rest.request("POST", `/channels/${channelId}/messages`, { content: "hi" }));
  }
}
await Promise.all(jobs);
const elapsedMs = (Bun.nanoseconds() - start) / 1e6;

const total = CHANNELS * PER_CHANNEL;
console.log(`channels=${CHANNELS} perChannel=${PER_CHANNEL} total=${total}`);
console.log(`elapsed: ${elapsedMs.toFixed(1)} ms`);
console.log(`throughput: ${(total / (elapsedMs / 1000)).toFixed(1)} req/s`);
console.log(`server-accepted (non-429): ${served}`);
