import { expect, test } from "bun:test";
import { fakeFetch } from "./helpers/fetch.ts";

test("fakeFetch passes the URL as text, whatever kind of input it got", async () => {
    const seen: string[] = [];
    const fetcher = fakeFetch((url) => {
        seen.push(url);
        return new Response("ok");
    });
    await fetcher("https://example.test/a");
    await fetcher(new URL("https://example.test/b"));
    await fetcher(new Request("https://example.test/c"));
    expect(seen).toEqual([
        "https://example.test/a",
        "https://example.test/b",
        "https://example.test/c",
    ]);
    expect(fetcher.preconnect("https://example.test")).toBeUndefined();
});
