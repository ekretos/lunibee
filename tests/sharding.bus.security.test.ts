import { describe, expect, test } from "bun:test";
import {
    ShardBus,
    type ShardBusTransport,
    type ShardMessage,
} from "../packages/sharding/src/index.ts";

/** An in-memory network: every transport hears every other one. */
class Hub {
    readonly #members = new Set<MemberTransport>();
    public join(): MemberTransport {
        const member = new MemberTransport(this);
        this.#members.add(member);
        return member;
    }
    public deliver(from: MemberTransport, message: unknown): void {
        for (const member of this.#members)
            if (member !== from)
                queueMicrotask(() => member.receive(message as ShardMessage));
    }
    public leave(member: MemberTransport): void {
        this.#members.delete(member);
    }
}
class MemberTransport implements ShardBusTransport {
    public closed = false;
    #listener?: (message: ShardMessage) => void;
    #down?: (ids: readonly number[]) => void;
    public constructor(private readonly hub: Hub) {}
    public post(message: ShardMessage): void {
        if (this.closed) throw new Error("channel closed");
        this.hub.deliver(this, message);
    }
    public onMessage(listener: (message: ShardMessage) => void): void {
        this.#listener = listener;
    }
    public onPeerDown(listener: (ids: readonly number[]) => void): void {
        this.#down = listener;
    }
    public receive(message: ShardMessage): void {
        if (!this.closed) this.#listener?.(message);
    }
    public peerDown(ids: number[]): void {
        this.#down?.(ids);
    }
    public close(): void {
        this.closed = true;
        this.hub.leave(this);
    }
}

function network(count: number, maxPending?: number) {
    const hub = new Hub();
    const transports = Array.from({ length: count }, () => hub.join());
    const buses = transports.map(
        (transport, id) => new ShardBus(id, "sec", { transport, maxPending }),
    );
    return { hub, transports, buses };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const forge = (over: Record<string, unknown>) => ({
    source: 1,
    target: 0,
    type: "t",
    data: null,
    id: "x:1",
    ...over,
});

describe("replies", () => {
    test("only the shard that was asked can answer a request", async () => {
        const { buses, transports } = network(3);
        buses[1]!.respond("secret", async () => {
            await tick(30);
            return "real";
        });
        buses[2]!.on("secret", (message) => {
            // Shard 2 sees the broadcast-free request? It is targeted at 1, so
            // it never does. It forges the answer by guessing the ID instead.
            void message;
        });
        const pending = buses[0]!.request<string>(1, "secret", null, 2000);
        await tick();
        // Shard 2 forges a reply to request "sec:0:1".
        transports[2]!.post({
            source: 2,
            target: 0,
            type: "__lunibee:reply",
            id: "forged",
            data: { requestId: "sec:0:1", result: "forged" },
        });
        expect(await pending).toBe("real");
    });

    test("a shard counts once in a broadcast, however many times it answers", async () => {
        const { buses, transports } = network(3);
        buses[2]!.respond("who", async () => {
            await tick(40);
            return 2;
        });
        const replies = buses[0]!.broadcastRequest<number>("who", null, {
            expected: 2,
            timeoutMs: 200,
        });
        await tick();
        // Shard 1 answers the same request three times.
        for (let i = 0; i < 3; i++)
            transports[1]!.post({
                source: 1,
                target: 0,
                type: "__lunibee:reply",
                id: `r${i}`,
                data: { requestId: "sec:0:1", result: 1 },
            });
        const result = await replies;
        expect(result.map((r) => r.shardId).sort()).toEqual([1, 2]);
    });

    test("late and unknown replies are ignored", async () => {
        const { buses, transports } = network(2);
        const request = buses[0]!.request(1, "never", null, 15);
        await expect(request).rejects.toThrow(/did not reply/);
        transports[1]!.post({
            source: 1,
            target: 0,
            type: "__lunibee:reply",
            id: "late",
            data: { requestId: "sec:0:1", result: "late" },
        });
        transports[1]!.post({
            source: 1,
            target: 0,
            type: "__lunibee:reply",
            id: "unknown",
            data: { requestId: "nope", result: 1 },
        });
        transports[1]!.post({
            source: 1,
            target: 0,
            type: "__lunibee:reply",
            id: "odd",
            data: "not an object",
        });
        await tick(10);
    });
});

describe("close", () => {
    test("settles pending requests at once instead of leaving timers behind", async () => {
        const { buses } = network(2);
        const request = buses[0]!.request(1, "slow", null, 60_000);
        const broadcast = buses[0]!.broadcastRequest("slow", null, {
            timeoutMs: 60_000,
        });
        const settled = Promise.allSettled([request, broadcast]);
        await tick();
        const started = Date.now();
        buses[0]!.close();
        const [one, many] = await settled;
        expect(Date.now() - started).toBeLessThan(500);
        expect(one).toMatchObject({ status: "rejected" });
        expect((one as PromiseRejectedResult).reason.message).toMatch(/closed/);
        expect(many).toEqual({ status: "fulfilled", value: [] });
    });

    test("a closed bus refuses to send or request, and close() is idempotent", async () => {
        const { buses } = network(2);
        buses[0]!.close();
        buses[0]!.close();
        expect(() => buses[0]!.send(1, "t", 1)).toThrow(/closed/);
        expect(() => buses[0]!.broadcast("t", 1)).toThrow(/closed/);
        await expect(buses[0]!.request(1, "t", 1)).rejects.toThrow(/closed/);
        await expect(buses[0]!.broadcastRequest("t", 1)).rejects.toThrow(
            /closed/,
        );
    });

    test("a peer going away rejects only requests addressed to it, once", async () => {
        const { buses, transports } = network(3);
        const toOne = buses[0]!.request(1, "slow", null, 5000);
        const toTwo = buses[0]!.request(2, "slow", null, 40);
        const outcome = Promise.allSettled([toOne, toTwo]);
        await tick();
        transports[0]!.peerDown([1]);
        transports[0]!.peerDown([1]);
        const [a, b] = await outcome;
        expect((a as PromiseRejectedResult).reason.message).toMatch(
            /went away/,
        );
        expect((b as PromiseRejectedResult).reason.message).toMatch(
            /did not reply/,
        );
    });
});

describe("validation", () => {
    test("malformed messages are dropped without calling handlers or crashing", async () => {
        const { buses, transports } = network(2);
        const seen: unknown[] = [];
        buses[0]!.on("t", (message) => seen.push(message.data));
        const bad: unknown[] = [
            null,
            "text",
            42,
            [],
            forge({ type: 5 }),
            forge({ type: "" }),
            forge({ type: "x".repeat(300) }),
            forge({ source: "1" }),
            forge({ source: 1.5 }),
            forge({ source: -5 }),
            forge({ target: "0" }),
            forge({ target: 0.5 }),
            forge({ id: 7 }),
            forge({ id: "i".repeat(300) }),
        ];
        for (const message of bad) transports[1]!.post(message as never);
        // A well-formed one still arrives.
        transports[1]!.post(forge({ data: "ok" }) as never);
        await tick(10);
        expect(seen).toEqual(["ok"]);
    });

    test("pending requests are bounded and released when they settle", async () => {
        const { buses } = network(2, 2);
        const a = buses[0]!.request(1, "slow", null, 30);
        const b = buses[0]!.request(1, "slow", null, 30);
        const settled = Promise.allSettled([a, b]);
        await expect(buses[0]!.request(1, "slow", null, 30)).rejects.toThrow(
            /Too many/,
        );
        await settled;
        buses[1]!.respond("fast", () => 1);
        expect(await buses[0]!.request<number>(1, "fast", null, 500)).toBe(1);
    });

    test("a handler that throws reaches the error listener and does not stop later messages", async () => {
        const { buses, transports } = network(2);
        const errors: string[] = [];
        const seen: unknown[] = [];
        buses[0]!.onError((error) => errors.push((error as Error).message));
        buses[0]!.on("boom", () => {
            throw new Error("handler failed");
        });
        buses[0]!.on("ok", (message) => seen.push(message.data));
        transports[1]!.post(forge({ type: "boom" }) as never);
        transports[1]!.post(forge({ type: "ok", data: 1 }) as never);
        await tick(10);
        expect(errors).toEqual(["handler failed"]);
        expect(seen).toEqual([1]);
    });
});
