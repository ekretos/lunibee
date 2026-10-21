# REST compatibility matrix (`@lunibee/rest` ⇄ `@discordjs/rest`)

Audited by Aditya (T4-rest) against `docs/compatibility/api-conventions.md`. Lunibee's
REST design is **positional**: the body is the second argument and options the third. The
Discord.js-style call forms and aliases were removed in 0.4.0. Buckets:
✅ match · ⚑ intentionally-different · 🔧 same option under the options argument.

## Client surface

| Discord.js (`@discordjs/rest`) | Lunibee | Bucket | Notes |
|---|---|---|---|
| `new REST().setToken(token)` | `new REST({ token })` / `setToken(token)` | ✅ | `setToken` throws `TypeError` on empty token. |
| `rest.post/patch/put(path, { body, ... })` | `post(path, body?, options?)` | ⚑ | The second argument is always the body. `get(path, options?)` and `delete(path, options?)` take an optional `options.body`. |
| `rest.request(options)` (single object) | `request(method, path, body?, options?)` | ⚑ | The single-object form (and `fullRoute`) was removed in 0.4.0. |
| per-request `body` | positional body | ⚑ | |
| per-request `query` | `options.query` (`URLSearchParams` / record / string) | 🔧 | `undefined`/`null` record values are skipped. |
| per-request `headers` | `options.headers` | 🔧 | Merged first; library `Authorization`/`User-Agent`/`Content-Type` win. |
| per-request `reason` (`X-Audit-Log-Reason`) | `options.reason` | 🔧 | URI-encoded into the header. |
| per-request `auth: false` | `options.auth === false` | 🔧 | Omits `Authorization`. |
| `files` multipart | `options.files` **+** `postWithFiles`/`patchWithFiles` | ✅ | `files` in options upgrades any verb to `multipart/form-data`. |
| `DiscordAPIError` | `RESTError` | ⚑ | The `DiscordAPIError` alias was removed in 0.4.0. `status`/`code`/`errors`/`method`/`path` carried. |
| `HTTPError` / transport failure | `RESTError` with `status: 0`, `cause` set | ⚑ | Lunibee folds transport + timeout errors into `RESTError`. |
| `Routes` | `Routes` map | ✅ | Broad coverage; snowflake-validated params. |
| `WebhookClient` | `WebhookClient` | ⚑ | Payloads use the wire names `avatar_url`, `thread_id`, `allowed_mentions` (the camelCase aliases were removed in 0.4.0); `fetchMessage`/`deleteMessage` take `{ threadId }`. |
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

None open.

## Tests

- `tests/rest.test.ts` — JSON, retry, multipart, 429, abort (pre-existing).
- `tests/rest.compat.test.ts` — `RESTError`, positional body, query/headers/
  reason/auth, multipart via `options.files`, rate-limit hook + bucket-hash adoption.
- `tests/routes.test.ts`, `tests/webhook.test.ts` — route builders + webhook client (wire
  names, threads, positional `request`).
- `tests/rest.security.test.ts` — base URL rules, secret redaction, retry safety, bounded
  backoff (`maxBackoff`), multipart names, encoded path segments, store bounds.
- `tests/rest.coverage-complete.test.ts` — the remaining branches; every file in
  `packages/rest/src` is at 100% function and line coverage.
