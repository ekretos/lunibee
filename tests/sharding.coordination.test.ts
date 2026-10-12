import { describe, expect, test } from "bun:test";
import {
    IdentifyCoordinator,
    RequestTracker,
    allocateShards,
    assertCompleteAllocation,
    readClusterContext,
    validateShardIds,
} from "../packages/sharding/src/index.ts";
import {
    parseChildFrame,
    parseParentFrame,
} from "../packages/sharding/src/protocol.ts";

/** A coordinator on a fake clock: nothing fires until the test says so. */
function fakeCoordinator(
    options: ConstructorParameters<typeof IdentifyCoordinator>[0] = {},
) {
    const clock = { now: 1_000 };
    const timers = new Map<number, { at: number; callback: () => void }>();
    let nextHandle = 0;
    const coordinator = new IdentifyCoordinator({
        ...options,
        now: () => clock.now,
        schedule: (callback, ms) => {
            const handle = ++nextHandle;
            timers.set(handle, { at: clock.now + ms, callback });
            return handle;
        },
        cancel: (handle) => void timers.delete(handle as number),
    });
    const advance = (ms: number): void => {
        clock.now += ms;
        for (const [handle, timer] of [...timers])
            if (timer.at <= clock.now) {
                timers.delete(handle);
                timer.callback();
            }
    };
    return { coordinator, advance, timers, clock };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("IdentifyCoordinator", () => {
    test("grants one IDENTIFY per key per interval, across owners", async () => {
        const { coordinator, advance } = fakeCoordinator({ interval: 5000 });
        const order: string[] = [];
        for (const [owner, shard] of [
            [0, 0],
            [1, 1],
            [2, 2],
        ] as const)
            void coordinator.acquire(owner, shard).then(() => {
                order.push(`s${shard}`);
                coordinator.release(owner, shard);
            });
        await settle();
        expect(order).toEqual(["s0"]);
        advance(4999);
        await settle();
        expect(order).toEqual(["s0"]);
        advance(1);
        await settle();
        expect(order).toEqual(["s0", "s1"]);
        advance(5000);
        await settle();
        expect(order).toEqual(["s0", "s1", "s2"]);
        coordinator.close();
    });

    test("max_concurrency lets different keys start together", async () => {
        const { coordinator } = fakeCoordinator({ maxConcurrency: 2 });
        const granted: number[] = [];
        for (const shard of [0, 1, 2, 3])
            coordinator
                .acquire(shard, shard)
                .then(() => void granted.push(shard))
                .catch(() => undefined);
        await settle();
        // Shards 0 and 1 use keys 0 and 1; 2 and 3 wait behind them.
        expect(granted).toEqual([0, 1]);
        expect(coordinator.holding).toBe(2);
        expect(coordinator.waiting).toBe(2);
        coordinator.close();
    });

    test("a slot the worker never releases is released after holdTimeout", async () => {
        const { coordinator, advance } = fakeCoordinator({
            interval: 100,
            holdTimeout: 1000,
        });
        const granted: number[] = [];
        for (const shard of [0, 1])
            coordinator
                .acquire(shard, shard)
                .then(() => void granted.push(shard))
                .catch(() => undefined);
        await settle();
        expect(granted).toEqual([0]);
        advance(1000);
        advance(100);
        await settle();
        expect(granted).toEqual([0, 1]);
        coordinator.close();
    });

    test("drop() rejects the owner's waiters and frees its held slot", async () => {
        const { coordinator, advance } = fakeCoordinator({ interval: 100 });
        const holder = coordinator.acquire(0, 0);
        const waiting = coordinator.acquire(0, 1);
        const other = coordinator.acquire(1, 2);
        await holder;
        const failure = waiting.catch((error: Error) => error.message);
        coordinator.drop(0, "gone");
        expect(await failure).toBe("gone");
        advance(100);
        await other;
        expect(coordinator.holding).toBe(1);
        coordinator.close();
    });

    test("release() from a non-holder is ignored", async () => {
        const { coordinator } = fakeCoordinator();
        await coordinator.acquire(0, 0);
        coordinator.release(1, 0);
        coordinator.release(0, 4);
        expect(coordinator.holding).toBe(1);
        coordinator.close();
    });

    test("waits for the session budget to reset instead of exceeding it", async () => {
        const waits: number[] = [];
        const { coordinator, advance } = fakeCoordinator({
            interval: 0,
            budget: { total: 1000, remaining: 1, resetAfter: 60_000 },
            onBudgetWait: ({ waitMs }) => waits.push(waitMs),
        });
        const granted: number[] = [];
        for (const shard of [0, 1])
            void coordinator.acquire(shard, shard).then(() => {
                granted.push(shard);
                coordinator.release(shard, shard);
            });
        await settle();
        expect(granted).toEqual([0]);
        expect(coordinator.remaining).toBe(0);
        expect(waits[0]).toBe(60_000);
        advance(59_999);
        await settle();
        expect(granted).toEqual([0]);
        advance(1);
        await settle();
        expect(granted).toEqual([0, 1]);
        expect(coordinator.remaining).toBe(999);
        coordinator.close();
    });

    test("close() rejects waiters, stops the timer and refuses new requests", async () => {
        const { coordinator, timers } = fakeCoordinator();
        await coordinator.acquire(0, 0);
        const waiting = coordinator.acquire(1, 1);
        const failure = waiting.catch((error: Error) => error.message);
        coordinator.close();
        expect(await failure).toMatch(/closed/);
        await expect(coordinator.acquire(2, 2)).rejects.toThrow(/closed/);
        expect(timers.size).toBe(0);
    });

    test("validates options", () => {
        expect(() => new IdentifyCoordinator({ maxConcurrency: 0 })).toThrow(
            RangeError,
        );
        expect(() => new IdentifyCoordinator({ interval: -1 })).toThrow(
            RangeError,
        );
    });
});

describe("RequestTracker", () => {
    const keys = (...entries: [string, number][]) => new Map(entries);

    test("settles when every key answered", async () => {
        const tracker = new RequestTracker();
        const { id, done } = tracker.begin<number>({
            keys: keys(["s:0", 0], ["s:1", 1]),
            timeoutMs: 1000,
        });
        expect(tracker.answer(id, "s:0", 0, { result: 1 })).toBe(true);
        expect(tracker.size).toBe(1);
        expect(tracker.answer(id, "s:1", 1, { error: "boom" })).toBe(true);
        const { replies, missing } = await done;
        expect(replies.map((r) => r.key)).toEqual(["s:0", "s:1"]);
        expect(missing).toEqual([]);
        expect(tracker.size).toBe(0);
    });

    test("ignores unknown, duplicate, wrong-owner and late answers", async () => {
        const tracker = new RequestTracker();
        const { id, done } = tracker.begin({
            keys: keys(["s:0", 0], ["s:1", 1]),
            timeoutMs: 20,
        });
        expect(tracker.answer("nope", "s:0", 0, {})).toBe(false);
        expect(tracker.answer(id, "s:9", 0, {})).toBe(false);
        // Cluster 1 may not answer for shard 0.
        expect(tracker.answer(id, "s:0", 1, { result: "spoof" })).toBe(false);
        expect(tracker.answer(id, "s:0", 0, { result: "ok" })).toBe(true);
        expect(tracker.answer(id, "s:0", 0, { result: "again" })).toBe(false);
        const { replies, missing } = await done;
        expect(replies).toEqual([{ key: "s:0", result: "ok" }]);
        expect(missing).toEqual(["s:1"]);
        // Late answer after the timeout.
        expect(tracker.answer(id, "s:1", 1, { result: "late" })).toBe(false);
        expect(tracker.size).toBe(0);
    });

    test("failOwner() settles the keys of a dead cluster with an error", async () => {
        const tracker = new RequestTracker();
        const { id, done } = tracker.begin({
            keys: keys(["s:0", 0], ["s:1", 1]),
            timeoutMs: 1000,
        });
        tracker.answer(id, "s:1", 1, { result: 1 });
        tracker.failOwner(0, "Cluster 0 exited.");
        const { replies, missing } = await done;
        expect(replies.find((r) => r.key === "s:0")?.error).toBe(
            "Cluster 0 exited.",
        );
        expect(missing).toEqual([]);
    });

    test("is bounded, abortable and closable", async () => {
        const tracker = new RequestTracker("t", 2);
        const controller = new AbortController();
        const first = tracker.begin({
            keys: keys(["s:0", 0]),
            timeoutMs: 10_000,
            signal: controller.signal,
        });
        const second = tracker.begin({
            keys: keys(["s:1", 0]),
            timeoutMs: 10_000,
        });
        expect(() =>
            tracker.begin({ keys: keys(["s:2", 0]), timeoutMs: 1 }),
        ).toThrow(/Too many/);
        controller.abort();
        expect((await first.done).missing).toEqual(["s:0"]);
        tracker.close();
        expect((await second.done).missing).toEqual(["s:1"]);
        expect(tracker.size).toBe(0);
    });

    test("a request with no keys settles at once", async () => {
        const tracker = new RequestTracker();
        const { done } = tracker.begin({ keys: new Map(), timeoutMs: 10_000 });
        expect(await done).toEqual({ replies: [], missing: [] });
        expect(() => new RequestTracker("t", 0)).toThrow(RangeError);
    });
});

describe("shard allocation and the worker contract", () => {
    test("allocates deterministically, round-robin", () => {
        expect(allocateShards([0, 1, 2, 3, 4], 3)).toEqual([
            [0, 3],
            [1, 4],
            [2],
        ]);
        expect(allocateShards([0, 1, 2, 3, 4], 3)).toEqual(
            allocateShards([0, 1, 2, 3, 4], 3),
        );
        expect(allocateShards([0, 1, 2], 3)).toEqual([[0], [1], [2]]);
        expect(allocateShards([0, 1], 4)).toEqual([[0], [1], [], []]);
        expect(allocateShards([4, 5, 6, 7], 2)).toEqual([
            [4, 6],
            [5, 7],
        ]);
        expect(() => allocateShards([0], 0)).toThrow(RangeError);
    });

    test("assertCompleteAllocation names duplicate, missing and unexpected IDs", () => {
        assertCompleteAllocation([[0, 2], [1]], [0, 1, 2]);
        expect(() => assertCompleteAllocation([[0, 1], [1]], [0, 1])).toThrow(
            /duplicate \[1\]/,
        );
        expect(() => assertCompleteAllocation([[0]], [0, 1])).toThrow(
            /missing \[1\]/,
        );
        expect(() => assertCompleteAllocation([[0, 5]], [0])).toThrow(
            /unexpected \[5\]/,
        );
    });

    test("validateShardIds rejects out-of-range, fractional and repeated IDs", () => {
        validateShardIds([0, 3], 4);
        expect(() => validateShardIds([4], 4)).toThrow(/outside 0-3/);
        expect(() => validateShardIds([-1], 4)).toThrow(RangeError);
        expect(() => validateShardIds([1.5], 4)).toThrow(RangeError);
        expect(() => validateShardIds([1, 1], 4)).toThrow(/twice/);
        expect(() => validateShardIds([], 0)).toThrow(RangeError);
    });

    test("readClusterContext reads the environment only in a marked worker", () => {
        const env = {
            CLUSTER_ID: "1",
            CLUSTER_COUNT: "3",
            SHARD_COUNT: "6",
            SHARD_LIST: "1,4",
            LUNIBEE_IDENTIFY: "coordinated",
        };
        expect(readClusterContext(env)).toBeNull();
        expect(
            readClusterContext({ ...env, LUNIBEE_CLUSTER_WORKER: "1" }),
        ).toEqual({
            clusterId: 1,
            clusterCount: 3,
            shardCount: 6,
            shardIds: [1, 4],
            coordinatedIdentify: true,
        });
        expect(
            readClusterContext({
                ...env,
                LUNIBEE_CLUSTER_WORKER: "1",
                LUNIBEE_IDENTIFY: "local",
            })?.coordinatedIdentify,
        ).toBe(false);
        for (const bad of [
            { SHARD_COUNT: "x" },
            { SHARD_LIST: "1,a" },
            { SHARD_LIST: "9" },
            { SHARD_LIST: "1,1" },
            { CLUSTER_ID: "" },
        ])
            expect(() =>
                readClusterContext({
                    ...env,
                    LUNIBEE_CLUSTER_WORKER: "1",
                    ...bad,
                }),
            ).toThrow(RangeError);
    });

    test("control frames are validated", () => {
        expect(parseChildFrame({ kind: "ready", shardIds: [0, 1] })).toEqual({
            kind: "ready",
            shardIds: [0, 1],
        });
        expect(parseChildFrame({ kind: "ready", shardIds: [-1] })).toBeNull();
        expect(parseChildFrame({ kind: "ready", shardIds: "0" })).toBeNull();
        expect(
            parseChildFrame({ kind: "identify", id: 1, shardId: 2 }),
        ).toEqual({ kind: "identify", id: 1, shardId: 2 });
        expect(
            parseChildFrame({ kind: "identify", id: "1", shardId: 2 }),
        ).toBeNull();
        expect(
            parseChildFrame({ kind: "identify-done", shardId: 1.5 }),
        ).toBeNull();
        expect(
            parseChildFrame({ kind: "reply", id: "p:1", result: 5 }),
        ).toEqual({ kind: "reply", id: "p:1", result: 5 });
        expect(
            parseChildFrame({ kind: "reply", id: "p:1", error: "x" }),
        ).toEqual({ kind: "reply", id: "p:1", error: "x" });
        expect(parseChildFrame({ kind: "reply", id: 1 })).toBeNull();
        expect(
            parseChildFrame({
                kind: "health",
                report: { shards: [], reportedAt: 1 },
            })?.kind,
        ).toBe("health");
        expect(parseChildFrame({ kind: "health", report: {} })).toBeNull();
        expect(parseChildFrame({ kind: "other" })).toBeNull();
        expect(parseChildFrame("ready")).toBeNull();
        expect(parseChildFrame(null)).toBeNull();

        expect(parseParentFrame({ kind: "identify-grant", id: 3 })).toEqual({
            kind: "identify-grant",
            id: 3,
        });
        expect(
            parseParentFrame({ kind: "identify-deny", id: 3, error: "no" }),
        ).toEqual({ kind: "identify-deny", id: 3, error: "no" });
        expect(parseParentFrame({ kind: "identify-deny", id: 3 })).toBeNull();
        expect(
            parseParentFrame({
                kind: "request",
                id: "c:1",
                type: "t",
                data: 1,
            }),
        ).toEqual({ kind: "request", id: "c:1", type: "t", data: 1 });
        expect(
            parseParentFrame({ kind: "request", id: 1, type: "t" }),
        ).toBeNull();
        expect(parseParentFrame({ kind: "x" })).toBeNull();
        expect(parseParentFrame(undefined)).toBeNull();
    });
});
