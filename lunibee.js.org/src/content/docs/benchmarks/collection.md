---
title: Collection benchmarks
description: Lunibee's Collection against discord.js and a plain Map, and every Collection method.
---

Measured 2026-10-15 on Bun 1.4.2, Linux, a shared CPU. Absolute times move by about ±20% between runs and machines: compare ratios and orders of magnitude, not single digits.

## Against discord.js

```text
set, 200000 new keys
  Map                                      150.0 ns/op    1.0x
  discord.js Collection                    153.4 ns/op    1.0x
  Lunibee Collection                       155.7 ns/op    1.0x
  Lunibee, ttl                             601.6 ns/op    4.0x
  Lunibee, maxSize (evicting)              491.9 ns/op    3.3x
  Lunibee, ttl + maxSize (evicting)        663.9 ns/op    4.4x

get, 100000 hits
  Map                                       76.2 ns/op    1.3x
  discord.js Collection                     69.0 ns/op    1.2x
  Lunibee Collection                        59.1 ns/op    1.0x
  Lunibee, ttl                             184.8 ns/op    3.1x
  Lunibee, maxSize (evicting)              116.9 ns/op    2.0x
  Lunibee, ttl + maxSize (evicting)        191.5 ns/op    3.2x

filter, 1000 entries
  discord.js Collection                  49590.6 ns/op    1.8x
  Lunibee Collection                     27924.5 ns/op    1.0x

find (last match), 1000 entries
  discord.js Collection                  10193.0 ns/op    1.0x
  Lunibee Collection                     10169.3 ns/op    1.0x

random, 1000 entries
  discord.js Collection                  10007.6 ns/op    6.9x
  Lunibee Collection                      1458.0 ns/op    1.0x

at(500), 1000 entries
  discord.js Collection                  10820.6 ns/op    8.1x
  Lunibee Collection                      1332.4 ns/op    1.0x

empty instance (shallow bytes, bun:jsc)
  Map                                         32 B
  discord.js Collection                       32 B
  Lunibee Collection                          35 B
```

`bun benchmarks/collection.ts`: contenders take turns inside each round and the best run is kept, so the figures are steady on a busy machine. A `ttl` or `maxSize` collection does more work per write (a policy record per key); a plain one is within a small factor of `Map`.

## Every method

| Operation | Median time |
| --- | ---: |
| Map.set (reference) | 152 ns |
| Map.get (reference) | 23 ns |
| set | 47 ns |
| get | 61 ns |
| has | 53 ns |
| peek | 81 ns |
| delete + set | 174 ns |
| setWithoutTTL | 57 ns |
| set (ttl) | 141 ns |
| get (ttl, sliding) | 105 ns |
| ttlRemaining | 142 ns |
| purge (ttl, nothing due) | 325 ns |
| set (lru, evicting) | 158 ns |
| get (lru, promoting) | 88 ns |
| first | 407 ns |
| firstKey | 373 ns |
| firstEntry | 365 ns |
| last | 2.8 µs |
| lastKey | 3.2 µs |
| lastEntry | 23.3 µs |
| at | 2.0 µs |
| keyAt | 2.1 µs |
| random | 2.4 µs |
| randomKey | 1.8 µs |
| find (last item) | 15.3 µs |
| findKey (last item) | 14.4 µs |
| some (last item) | 15.9 µs |
| someEntry (last item) | 15.9 µs |
| every | 15.5 µs |
| filter | 37.4 µs |
| partition | 70.9 µs |
| each | 10.7 µs |
| tap | 59 ns |
| array | 12.2 µs |
| keyArray | 11.3 µs |
| entriesArray | 27.9 µs |
| toJSON | 28.6 µs |
| clone | 50.0 µs |
| sorted | 100.4 µs |
| union | 126.5 µs |
| intersection | 47.8 µs |
| difference | 50.5 µs |
| hasAll (3 keys) | 64 ns |
| hasAny (3 keys) | 53 ns |
| sweep (removes none) | 13.0 µs |

`bun run build && bun scripts/bench-runtime.mjs`
