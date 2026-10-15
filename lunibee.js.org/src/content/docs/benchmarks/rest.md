---
title: REST benchmarks
description: Sequential against concurrent bucket scheduling, with a fake Discord that enforces real rate-limit windows.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

```text
80 requests over 4 buckets, limit 5 per 250 ms, 20 ms latency
sequential       927 ms      0 429s      86 req/s
concurrent       837 ms      0 429s      96 req/s
```

`bun run bench:rest`. Since 0.3.1 requests on a bucket whose limit is known run concurrently, up to its remaining allowance (`concurrentBuckets: true`, the default). The gain appears when the round trip is longer than the bucket's window divided by its limit. Pass `concurrentBuckets: false` for strict per-bucket ordering. A separate 10,000-request soak test (`tests/rest.soak.test.ts`) checks that fewer than 1% of requests are rate limited.

## Several processes

```text
4 buckets x 25 requests per process, limit 5 per 200 ms, 5 ms latency, bun 1.4.2
1 process, memory                  869 ms     0 429    0 err  p50   429  p95   844  p99   844 ms   0.00 redis ops/req  38 MB rss
4 processes, memory (no coord)    3969 ms   859 429    0 err  p50  2067  p95  3920  p99  3937 ms   0.00 redis ops/req  42 MB rss
1 process, redis                   881 ms     0 429    0 err  p50   435  p95   852  p99   854 ms   4.24 redis ops/req  40 MB rss
4 processes, redis, 1 token       4007 ms     0 429    0 err  p50  2076  p95  3941  p99  3966 ms   5.45 redis ops/req  39 MB rss
4 processes, redis, 2 tokens      1926 ms     0 429    0 err  p50  1048  p95  1884  p99  1891 ms   4.66 redis ops/req  39 MB rss
```

`REDIS_URL=redis://… bun benchmarks/rest-distributed.ts`: each REST instance in its own Bun process (with its own Redis connection), against a fake Discord HTTP server that counts every request it had to reject (a 429 is a request sent over the limit). See [Distributed REST](/core-concepts/distributed-rest/#benchmarks) for the method and a before/after comparison.
