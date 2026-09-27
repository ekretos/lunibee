import { describe, expect, test } from "bun:test";
import { Client, Collector } from "../packages/core/src/index.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const emit = (client: Client, ...args: unknown[]) =>
    (client as unknown as { emit(...a: unknown[]): void }).emit(...args);

describe("Collector", () => {
    test("idle timeout resets on each collected item", async () => {
        const collector = new Collector<string, number>({ idle: 30 });
        await sleep(15);
        await collector.handle("a", 1);
        await sleep(20);
        expect(collector.ended).toBe(false);
        expect(await collector.wait()).toHaveProperty("size", 1);
        expect(collector.endReason).toBe("idle");
        expect(await collector.wait()).toHaveProperty("size", 1);
    });

    test("stops on abort, including an already-aborted signal", () => {
        const controller = new AbortController();
        const collector = new Collector({ signal: controller.signal });
        controller.abort();
        expect(collector.endReason).toBe("abort");
        const early = new Collector({ signal: AbortSignal.abort() });
        expect(early.endReason).toBe("abort");
    });

    test("async iteration buffers items and ends with the collector", async () => {
        const collector = new Collector<string, number>({ max: 3 });
        const seen: number[] = [];
        const done = (async () => {
            for await (const item of collector) seen.push(item);
        })();
        await collector.handle("a", 1);
        await collector.handle("b", 2);
        await sleep(1);
        await collector.handle("c", 3);
        await done;
        expect(seen).toEqual([1, 2, 3]);
        const after: number[] = [];
        for await (const item of collector) after.push(item);
        expect(after).toEqual([]);
    });

    test("dispose stops and runs cleanups once", () => {
        const calls: string[] = [];
        const collector = new Collector();
        collector.onDispose(() => calls.push("a"));
        collector.onDispose(() => {
            throw new Error("ignored");
        });
        collector[Symbol.dispose]();
        collector.onDispose(() => calls.push("late"));
        expect(collector.endReason).toBe("disposed");
        expect(calls).toEqual(["a", "late"]);
    });
});

describe("Client.createCollector", () => {
    test("collects client events and unsubscribes on end", async () => {
        const client = new Client({ token: "a.b", intents: 0 });
        const collector = client.createCollector("guildDelete", {
            max: 2,
            filter: (guild) => guild.id !== "skip",
        });
        emit(client, "guildDelete", { id: "1" });
        emit(client, "guildDelete", { id: "skip" });
        emit(client, "guildDelete", { id: "2" });
        const collected = await collector.wait();
        expect([...collected.keys()]).toEqual(["1", "2"]);
        emit(client, "guildDelete", { id: "3" });
        expect(collected.size).toBe(2);
    });

    test("keys by option or order, and reports filter errors", async () => {
        const client = new Client({ token: "a.b", intents: 0 });
        const errors: Error[] = [];
        client.on("error", (error) => errors.push(error));
        const byKey = client.createCollector("resumed", {
            key: () => "k",
            max: 1,
        });
        emit(client, "resumed");
        expect([...(await byKey.wait()).keys()]).toEqual(["k"]);
        const ordered = client.createCollector("resumed", { max: 1 });
        emit(client, "resumed");
        expect([...(await ordered.wait()).keys()]).toEqual(["0"]);
        const failing = client.createCollector("resumed", {
            filter: () => {
                throw "bad";
            },
        });
        emit(client, "resumed");
        await sleep(1);
        expect(errors[0]?.message).toBe("bad");
        failing.stop();
    });
});
