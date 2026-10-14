# REST compatibility matrix (`@lunibee/rest` ⇄ `@discordjs/rest`)

Audited by Aditya (T4-rest) against `docs/compatibility/api-conventions.md`. Lunibee keeps
its **positional** REST design as canonical; Discord.js familiarity is added **additively**
(aliases, extra option names, overloads) without changing existing behaviour. Buckets:
✅ match · 🔀 alias added · ⚑ intentionally-different (kept) · 🔧 additive adapt.

## Client surface

| Discord.js (`@discordjs/rest`) | Lunibee | Bucket | Notes |
|---|---|---|---|
| `new REST().setToken(token)` | `new REST({ token })` / `setToken(token)` | ✅ | `setToken` throws `TypeError` on empty token. |
| `rest.get/post/patch/put/delete(path, { body })` | positional `post(path, body)` **+ `{ body }` overload** | ⚑→🔧 | Positional stays canonical; `verb(path, { body, query, headers, reason, files })` now also works. |
| `rest.request(options)` (single object) | `request({ method, path \| fullRoute, body, ... })` **+** `request(method, path, body?, options?)` | 🔧 | Both forms work; `MockREST` declares both overloads. |
| per-request `body` | positional body **or** `options.body` via wrapper | 🔧 | |
| per-request `query` | `options.query` (`URLSearchParams` / record / string) | 🔧 | `undefined`/`null` record values are skipped. |
| per-request `headers` | `options.headers` | 🔧 | Merged first; library `Authorization`/`User-Agent`/`Content-Type` win. |
| per-request `reason` (`X-Audit-Log-Reason`) | `options.reason` | 🔧 | URI-encoded into the header. |
| per-request `auth: false` | `options.auth === false` | 🔧 | Omits `Authorization`. |
| `files` multipart | `options.files` **+** `postWithFiles`/`patchWithFiles` | ✅ | `files` in options upgrades any verb to `multipart/form-data`. |
| `DiscordAPIError` | `RESTError` **+ `export { RESTError as DiscordAPIError }`** | 🔀 | One class, one alias. `status`/`code`/`errors`/`method`/`path` carried. |
| `HTTPError` / transport failure | `RESTError` with `status: 0`, `cause` set | ⚑ | Lunibee folds transport + timeout errors into `RESTError`. |
| `Routes` | `Routes` map | ✅ | Broad coverage; snowflake-validated params. |
| `WebhookClient` | `WebhookClient` | ✅ | Accepts `avatarURL`, `threadId`, `allowedMentions` beside the wire names; `fetchMessage`/`editMessage`/`deleteMessage` take `threadId`. |
| rate-limit buckets / retries / global | `RateLimitStore` (memory + Redis) + `RetryPolicy` | ✅ | Server `X-RateLimit-Bucket` hash adopted per normalized route; global 429 tracked. |

## Auth, headers & serialization

- `Authorization: Bot <token>` sent when a token is set and `auth !== false`.
- `User-Agent: DiscordBot (<repo>, <version>)` — Discord-compliant.
- JSON bodies `Content-Type: application/json`; multipart bodies leave `fetch` to set the
  boundary (`Content-Type` is **not** forced to JSON). `payload_json` + `files[n]` fields.

## Rate limits / errors / retries (verified by tests)

- Route normalization collapses `/\d+/ → /:id` and strips query before bucket keying.
- 429 honours `Retry-After` header and JSON `retry_after`; global limit stored/awaited.
- Default `RetryPolicy` retries 429 + idempotent 5xx (`GET/HEAD/PUT/DELETE`) with backoff.
- `AbortSignal` cancels both in-flight requests and queued rate-limit waits.

## Known gaps / follow-ups

None open. Both earlier gaps closed in 0.3.1:

1. `request({ method, path | fullRoute, body, ... })` — the single-object form works beside
   `request(method, path, body, options)`; `MockREST` declares both.
2. `WebhookClient` accepts the Discord.js spellings `avatarURL`, `threadId` and
   `allowedMentions` beside the wire names (the wire names win if both are given).
   `editMessage` takes the full message options, files included; `fetchMessage()` is new;
   `fetchMessage()`, `editMessage()` and `deleteMessage()` accept `threadId`.

## Tests

- `tests/rest.test.ts` — JSON, retry, multipart, 429, abort (pre-existing).
- `tests/rest.compat.test.ts` — DiscordAPIError alias, `{ body }` overload, query/headers/
  reason/auth, multipart via `options.files`, rate-limit hook + bucket-hash adoption (new).
- `tests/routes.test.ts`, `tests/webhook.test.ts` — route builders + webhook client (aliases,
  threads, single-object `request`).
- `tests/rest.security.test.ts` — base URL rules, secret redaction, retry safety, bounded
  backoff (`maxBackoff`), multipart names, encoded path segments, store bounds.
- `tests/rest.coverage-complete.test.ts` — the remaining branches; every file in
  `packages/rest/src` is at 100% function and line coverage.
