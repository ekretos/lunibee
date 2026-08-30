import { describe, expect, test } from "bun:test";
import { deferred, waitFor } from "../packages/testing/src/index.ts";
import { MockREST } from "../packages/testing/src/rest.ts";

describe("Testing Utilities", () => {
  test("deferred creates a resolvable and rejectable promise", async () => {
    const d = deferred<string>();
    setTimeout(() => d.resolve("done"), 10);
    const result = await d.promise;
    expect(result).toBe("done");

    const dReject = deferred<number>();
    setTimeout(() => dReject.reject(new Error("failed")), 10);
    expect(dReject.promise).rejects.toThrow("failed");
  });

  test("waitFor polls condition until truthy", async () => {
    let flag = false;
    setTimeout(() => {
      flag = true;
    }, 20);

    await waitFor(() => flag, 200, 5);
    expect(flag).toBe(true);

    expect(waitFor(() => false, 30, 5)).rejects.toThrow(
      "Timed out waiting for condition",
    );
  });

  test("MockREST records requests and returns configured mock responses", async () => {
    const rest = new MockREST({
      "/test/path": { data: "success" },
    });

    const res = await rest.request<any>("GET", "/test/path", { query: 1 });
    expect(res).toEqual({ data: "success" });
    expect(rest.requests).toHaveLength(1);
    expect(rest.requests[0]).toEqual({
      method: "GET",
      path: "/test/path",
      body: { query: 1 },
    });

    expect(rest.request("POST", "/unconfigured")).rejects.toThrow(
      "No mock response configured for /unconfigured",
    );
  });
});
