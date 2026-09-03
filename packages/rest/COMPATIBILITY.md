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
| `rest.request(options)` (single object) | `request(method, path, body?, options?)` | ⚑ | Single-object form **not** added: it is incompatible with `MockREST extends REST` (Priya's `testing` pkg) override checking. Option **names** aligned instead (see below). |
| per-request `body` | positional body **or** `options.body` via wrapper | 🔧 | |
| per-request `query` | `options.query` (`URLSearchParams` / record / string) | 🔧 | `undefined`/`null` record values are skipped. |
| per-request `headers` | `options.headers` | 🔧 | Merged first; library `Authorization`/`User-Agent`/`Content-Type` win. |
| per-request `reason` (`X-Audit-Log-Reason`) | `options.reason` | 🔧 | URI-encoded into the header. |
| per-request `auth: false` | `options.auth === false` | 🔧 | Omits `Authorization`. |
| `files` multipart | `options.files` **+** `postWithFiles`/`patchWithFiles` | ✅ | `files` in options upgrades any verb to `multipart/form-data`. |
| `DiscordAPIError` | `RESTError` **+ `export { RESTError as DiscordAPIError }`** | 🔀 | One class, one alias. `status`/`code`/`errors`/`method`/`path` carried. |
| `HTTPError` / transport failure | `RESTError` with `status: 0`, `cause` set | ⚑ | Lunibee folds transport + timeout errors into `RESTError`. |
| `Routes` | `Routes` map | ✅ | Broad coverage; snowflake-validated params. |
| `WebhookClient` | `WebhookClient` | ✅ | See gap below re: camelCase option aliases. |
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

## Known gaps / follow-ups (not in this change)

1. `request(options)` single-object form — blocked by subclass override compatibility;
   revisit if `MockREST` is updated to declare the overload (coordinate via Arjun/Priya).
2. `WebhookClient` message options use Discord wire names (`avatar_url`, `thread_id`);
   Discord.js uses camelCase (`avatarURL`, `threadId`). Additive camelCase aliases are a
   candidate follow-up (kept out here to stay within the sanctioned gap list).

## Tests

- `tests/rest.test.ts` — JSON, retry, multipart, 429, abort (pre-existing).
- `tests/rest.compat.test.ts` — DiscordAPIError alias, `{ body }` overload, query/headers/
  reason/auth, multipart via `options.files`, rate-limit hook + bucket-hash adoption (new).
- `tests/routes.test.ts`, `tests/webhook.test.ts` — route builders + webhook client.
