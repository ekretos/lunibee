---
title: REST benchmarks
description: Sequential against concurrent bucket scheduling, with a fake Discord that enforces real rate-limit windows.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

```text
80 requests over 4 buckets, limit 5 per 250 ms, 20 ms latency
sequential       930 ms      0 429s      86 req/s
concurrent       838 ms      0 429s      95 req/s
```

`bun run bench:rest`. Since 0.3.1 requests on a bucket whose limit is known run concurrently, up to its remaining allowance (`concurrentBuckets: true`, the default). The gain appears when the round trip is longer than the bucket's window divided by its limit. Pass `concurrentBuckets: false` for strict per-bucket ordering. A separate 10,000-request soak test (`tests/rest.soak.test.ts`) checks that fewer than 1% of requests are rate limited.

## Several processes

```text
4 buckets x 25 requests per process, limit 5 per 200 ms, 5 ms latency, bun 1.4.2
1 process, memory                  884 ms     0 429    0 err  p50   429  p95   846  p99   847 ms   0.00 redis ops/req  38 MB rss
4 processes, memory (no coord)    3966 ms   992 429    0 err  p50  2071  p95  3925  p99  3937 ms   0.00 redis ops/req  41 MB rss
1 process, redis                   879 ms     0 429    0 err  p50   432  p95   849  p99   853 ms   4.28 redis ops/req  39 MB rss
4 processes, redis, 1 token       4005 ms     0 429    0 err  p50  2090  p95  3956  p99  3967 ms   5.41 redis ops/req  39 MB rss
4 processes, redis, 2 tokens      1930 ms     0 429    0 err  p50  1046  p95  1883  p99  1887 ms   4.67 redis ops/req  39 MB rss
```

`REDIS_URL=redis://… bun benchmarks/rest-distributed.ts`: each REST instance in its own Bun process (with its own Redis connection), against a fake Discord HTTP server that counts every request it had to reject (a 429 is a request sent over the limit). See [Distributed REST](/core-concepts/distributed-rest/#benchmarks) for the method and a before/after comparison.
