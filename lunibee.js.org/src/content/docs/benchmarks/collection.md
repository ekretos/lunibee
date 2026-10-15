---
title: Collection benchmarks
description: Lunibee's Collection against discord.js and a plain Map, and every Collection method.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

## Against discord.js

```text
set, 200000 new keys
  Map                                      131.1 ns/op    1.2x
  discord.js Collection                    113.0 ns/op    1.0x
  Lunibee Collection                       129.5 ns/op    1.1x
  Lunibee, ttl                             582.3 ns/op    5.2x
  Lunibee, maxSize (evicting)              497.2 ns/op    4.4x
  Lunibee, ttl + maxSize (evicting)        681.4 ns/op    6.0x

get, 100000 hits
  Map                                       62.0 ns/op    1.1x
  discord.js Collection                     66.5 ns/op    1.2x
  Lunibee Collection                        56.7 ns/op    1.0x
  Lunibee, ttl                             168.4 ns/op    3.0x
  Lunibee, maxSize (evicting)              112.1 ns/op    2.0x
  Lunibee, ttl + maxSize (evicting)        186.9 ns/op    3.3x

filter, 1000 entries
  discord.js Collection                  50625.1 ns/op    1.8x
  Lunibee Collection                     27679.4 ns/op    1.0x

find (last match), 1000 entries
  discord.js Collection                  10222.1 ns/op    1.0x
  Lunibee Collection                     10355.3 ns/op    1.0x

random, 1000 entries
  discord.js Collection                  10470.3 ns/op    6.3x
  Lunibee Collection                      1666.8 ns/op    1.0x

at(500), 1000 entries
  discord.js Collection                   9694.6 ns/op    6.7x
  Lunibee Collection                      1454.1 ns/op    1.0x

empty instance (shallow bytes, bun:jsc)
  Map                                         32 B
  discord.js Collection                       32 B
  Lunibee Collection                          35 B
```

`bun benchmarks/collection.ts`: contenders take turns inside each round and the best run is kept, so the figures are steady on a busy machine. A `ttl` or `maxSize` collection does more work per write (a policy record per key); a plain one is within a small factor of `Map`.

## Every method

| Operation | Median time |
| --- | ---: |
| Map.set (reference) | 35 ns |
| Map.get (reference) | 31 ns |
| set | 48 ns |
| get | 60 ns |
| has | 65 ns |
| peek | 124 ns |
| delete + set | 223 ns |
| setWithoutTTL | 60 ns |
| set (ttl) | 178 ns |
| get (ttl, sliding) | 117 ns |
| ttlRemaining | 160 ns |
| purge (ttl, nothing due) | 267 ns |
| set (lru, evicting) | 226 ns |
| get (lru, promoting) | 84 ns |
| first | 396 ns |
| firstKey | 383 ns |
| firstEntry | 544 ns |
| last | 4.1 µs |
| lastKey | 4.2 µs |
| lastEntry | 25.8 µs |
| at | 1.8 µs |
| keyAt | 2.0 µs |
| random | 2.2 µs |
| randomKey | 2.3 µs |
| find (last item) | 17.3 µs |
| findKey (last item) | 18.3 µs |
| some (last item) | 17.6 µs |
| someEntry (last item) | 20.6 µs |
| every | 13.1 µs |
| filter | 41.5 µs |
| partition | 71.3 µs |
| each | 13.5 µs |
| tap | 47 ns |
| array | 14.2 µs |
| keyArray | 13.3 µs |
| entriesArray | 26.3 µs |
| toJSON | 24.6 µs |
| clone | 46.2 µs |
| sorted | 99.6 µs |
| union | 125.0 µs |
| intersection | 46.7 µs |
| difference | 47.1 µs |
| hasAll (3 keys) | 76 ns |
| hasAny (3 keys) | 70 ns |
| sweep (removes none) | 13.4 µs |

`bun run build && bun scripts/bench-runtime.mjs`
