# @lunibee/testing

> Test helpers for Lunibee apps, and Lunibee's own discord.js compatibility suite.

```bash
bun add -d @lunibee/testing
```

```ts
import { test, expect } from "bun:test";
import { MockREST, deferred, waitFor } from "@lunibee/testing";

test("records REST calls", async () => {
    const rest = new MockREST({ "/users/@me": { id: "1", username: "bee" } });
    const me = await rest.get<{ id: string; username: string }>("/users/@me");
    expect(me).toEqual({ id: "1", username: "bee" });
    expect(rest.requests).toEqual([{ method: "GET", path: "/users/@me", body: undefined }]);
});

test("waits for async work", async () => {
    const done = deferred<string>();
    let seen = "";
    setTimeout(() => done.resolve("ok"), 10);
    void done.promise.then((value) => (seen = value));
    await waitFor(() => seen === "ok");
});
```

| Export | Description |
|---|---|
| `MockREST` | A `REST` that records requests and returns configured responses per path (throws for unconfigured paths). |
| `deferred<T>()` | `{ promise, resolve, reject }` for controlling async flow in tests. |
| `waitFor(predicate, timeout?, interval?)` | Polls until `predicate()` is true or throws after `timeout` ms. |

The `src/compat.*.test.ts` files check Lunibee's discord.js-familiar APIs; they run in
the repository's `ci:test`.
