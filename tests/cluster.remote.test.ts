import { afterEach, describe, expect, test } from "bun:test";
import {
    ClusterHost,
    ClusterManager,
    REMOTE_PROTOCOL_VERSION,
    RemoteClose,
    type ClusterManagerOptions,
} from "../packages/sharding/src/index.ts";
import {
    parseToCoordinator,
    parseToHost,
    signChallenge,
    verifyChallenge,
} from "../packages/sharding/src/remote-protocol.ts";
import { CLUSTER_FRAME } from "../packages/sharding/src/protocol.ts";
import { fakeFork, tick, type FakeChild } from "./helpers/fake-cluster.ts";

const SECRET = "a-shared-secret-of-sufficient-length";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** Polls until `check` returns something truthy. */
async function until<T>(
    check: () => T | undefined | false,
    ms = 3000,
): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) throw new Error("until() timed out");
        await tick(5);
    }
}

/** A coordinator with fake local processes and real agents over real sockets. */
async function deployment(
    hostIds: string[],
    options: Partial<ClusterManagerOptions> = {},
    remote: Partial<NonNullable<ClusterManagerOptions["remote"]>> = {},
) {
    const local = fakeFork();
    const manager = new ClusterManager({
        token: "t",
        script: "local.js",
        shardCount: 4,
        clusterCount: 2,
        spawnInterval: 0,
        restartDelay: 20,
        fork: local.fork,
        remote: { port: 0, secret: SECRET, hosts: hostIds, ...remote },
        ...options,
    });
    cleanup.push(() => manager.killAll());
    const errors: Error[] = [];
    manager.on("error", (error) => errors.push(error));
    const spawning = manager.spawn();
    spawning.catch(() => undefined);
    const port = await until(() => manager.remotePort);
    const agents = new Map<
        string,
        { host: ClusterHost; children: FakeChild[]; errors: Error[] }
    >();
    for (const id of hostIds) {
        const forked = fakeFork();
        const host = new ClusterHost({
            url: `ws://127.0.0.1:${port}`,
            secret: SECRET,
            id,
            script: "worker.js",
            fork: forked.fork,
            reconnectDelay: 10,
        });
        const hostErrors: Error[] = [];
        host.on("error", (error) => hostErrors.push(error));
        cleanup.push(() => host.close());
        agents.set(id, { host, children: forked.children, errors: hostErrors });
        await host.connect();
    }
    return { manager, agents, spawning, local, errors, port };
}

/** A hand-driven host: speaks the protocol itself so tests can misbehave. */
async function rawHost(
    port: number,
    id: string,
    opts: { secret?: string; version?: number; hello?: boolean } = {},
) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const received: Record<string, unknown>[] = [];
    let closed: { code: number; reason: string } | undefined;
    socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string) as Record<
            string,
            unknown
        >;
        received.push(message);
        if (message.t === "challenge" && opts.hello !== false)
            socket.send(
                JSON.stringify({
                    t: "hello",
                    id,
                    mac: signChallenge(
                        opts.secret ?? SECRET,
                        message.nonce as string,
                        id,
                    ),
                    version: opts.version ?? REMOTE_PROTOCOL_VERSION,
                }),
            );
    });
    socket.addEventListener("close", (event) => {
        closed = { code: event.code, reason: event.reason };
    });
    cleanup.push(() => socket.close());
    return {
        socket,
        received,
        send: (message: unknown) => socket.send(JSON.stringify(message)),
        closed: () => closed,
        find: (t: string) => received.find((m) => m.t === t),
        all: (t: string) => received.filter((m) => m.t === t),
    };
}

describe("wire protocol", () => {
    test("the challenge proves the secret without sending it", () => {
        const mac = signChallenge(SECRET, "nonce", "host-a");
        expect(mac).toMatch(/^[0-9a-f]{64}$/);
        expect(verifyChallenge(SECRET, "nonce", "host-a", mac)).toBe(true);
        expect(verifyChallenge(SECRET, "nonce", "host-b", mac)).toBe(false);
        expect(verifyChallenge(SECRET, "other", "host-a", mac)).toBe(false);
        expect(
            verifyChallenge(
                "wrong-secret-wrong-secret",
                "nonce",
                "host-a",
                mac,
            ),
        ).toBe(false);
        expect(verifyChallenge(SECRET, "nonce", "host-a", "zz")).toBe(false);
        expect(verifyChallenge(SECRET, "nonce", "host-a", 5)).toBe(false);
        expect(verifyChallenge(SECRET, "nonce", "host-a", mac.slice(2))).toBe(
            false,
        );
    });

    test("frames from the coordinator are validated", () => {
        const ok = (value: unknown) => parseToHost(JSON.stringify(value));
        expect(ok({ t: "challenge", nonce: "n", version: 1 })).not.toBeNull();
        expect(ok({ t: "welcome", leaseMs: 10, pingMs: 3 })).not.toBeNull();
        expect(ok({ t: "ping", n: 1 })).not.toBeNull();
        expect(
            ok({ t: "frame", cluster: 0, epoch: 1, frame: { a: 1 } }),
        ).not.toBeNull();
        expect(
            ok({ t: "kill", cluster: 0, epoch: 1, signal: "SIGTERM" }),
        ).not.toBeNull();
        expect(ok({ t: "bye", reason: "x" })).not.toBeNull();
        expect(
            ok({
                t: "spawn",
                cluster: 0,
                epoch: 1,
                env: { SHARD_LIST: "0,1", CLUSTER_ID: "0" },
            }),
        ).not.toBeNull();
        // Only the worker contract may be set remotely.
        expect(
            ok({
                t: "spawn",
                cluster: 0,
                epoch: 1,
                env: { NODE_OPTIONS: "--require x" },
            }),
        ).toBeNull();
        expect(
            ok({ t: "spawn", cluster: 0, epoch: 1, env: { SHARD_LIST: 5 } }),
        ).toBeNull();
        expect(ok({ t: "spawn", cluster: 0, epoch: 1, env: "x" })).toBeNull();
        expect(
            ok({ t: "kill", cluster: 0, epoch: 1, signal: "SIGHUP" }),
        ).toBeNull();
        expect(
            ok({ t: "kill", cluster: -1, epoch: 1, signal: "SIGTERM" }),
        ).toBeNull();
        expect(ok({ t: "nope" })).toBeNull();
        expect(parseToHost("not json")).toBeNull();
        expect(parseToHost("[1]")).toBeNull();
        expect(parseToHost(5)).toBeNull();
        expect(parseToHost("x".repeat(9 * 1024 * 1024))).toBeNull();
    });

    test("frames from a host are validated", () => {
        const ok = (value: unknown) =>
            parseToCoordinator(JSON.stringify(value));
        expect(
            ok({ t: "hello", id: "a", mac: "00", version: 1 }),
        ).not.toBeNull();
        expect(ok({ t: "pong", n: 1 })).not.toBeNull();
        expect(ok({ t: "spawned", cluster: 0, epoch: 1 })).toEqual({
            t: "spawned",
            cluster: 0,
            epoch: 1,
        });
        expect(
            ok({ t: "spawned", cluster: 0, epoch: 1, pid: 7 }),
        ).toMatchObject({ pid: 7 });
        expect(ok({ t: "spawned", cluster: 0, epoch: 1, pid: -1 })).toBeNull();
        expect(
            ok({ t: "frame", cluster: 0, epoch: 1, frame: null }),
        ).not.toBeNull();
        expect(
            ok({ t: "exit", cluster: 0, epoch: 1, code: 1, signal: null }),
        ).not.toBeNull();
        expect(
            ok({ t: "exit", cluster: 0, epoch: 1, code: "1", signal: null }),
        ).toBeNull();
        expect(
            ok({ t: "error", cluster: 0, epoch: 1, message: "m" }),
        ).not.toBeNull();
        expect(ok({ t: "error", cluster: 0, epoch: 1 })).toBeNull();
        expect(ok({ t: "hello", id: 1 })).toBeNull();
        expect(ok({ t: "other" })).toBeNull();
    });
});

describe("joining a deployment", () => {
    test("rejects invalid remote options", () => {
        const make = (remote: object) =>
            new ClusterManager({
                token: "t",
                script: "w",
                remote: { port: 0, secret: SECRET, ...remote },
            });
        expect(() => make({ secret: "short" })).toThrow(/at least 16/);
        expect(() => make({ port: -1 })).toThrow(RangeError);
        expect(() => make({ port: 1.5 })).toThrow(RangeError);
        expect(() => make({ lease: 5 })).toThrow(/lease/);
        expect(() => make({ hosts: ["bad id"] })).toThrow(
            /not a valid host ID/,
        );
        expect(() => make({ hosts: [] })).toThrow(/not empty/);
        expect(() => make({ hosts: ["a", "a"] })).toThrow(/unique/);
        expect(() => make({ minHosts: 0 })).toThrow(RangeError);
        expect(
            () =>
                new ClusterHost({
                    url: "ws://x",
                    secret: SECRET,
                    id: "a b",
                    script: "w",
                }),
        ).toThrow(RangeError);
        expect(
            () =>
                new ClusterHost({
                    url: "ws://x",
                    secret: "short",
                    id: "a",
                    script: "w",
                }),
        ).toThrow(RangeError);
        expect(
            () =>
                new ClusterHost({
                    url: "ws://x",
                    secret: SECRET,
                    id: "a",
                    script: " ",
                }),
        ).toThrow(TypeError);
        expect(
            () =>
                new ClusterHost({
                    url: "http://x",
                    secret: SECRET,
                    id: "a",
                    script: "w",
                }),
        ).toThrow(TypeError);
    });

    test("a wrong secret, an unknown host and a duplicate are refused", async () => {
        const { manager, port } = await deployment(["a"]);
        const wrong = await rawHost(port, "a", {
            secret: "wrong-secret-wrong-secret",
        });
        await until(wrong.closed);
        expect(wrong.closed()!.code).toBe(RemoteClose.AuthFailed);

        const stranger = await rawHost(port, "zzz");
        await until(stranger.closed);
        expect(stranger.closed()!.code).toBe(RemoteClose.UnknownHost);

        const duplicate = await rawHost(port, "a");
        await until(duplicate.closed);
        expect(duplicate.closed()!.code).toBe(RemoteClose.DuplicateHost);

        const old = await rawHost(port, "a", { version: 99 });
        await until(old.closed);
        expect(old.closed()!.code).toBe(RemoteClose.VersionMismatch);

        const badId = await rawHost(port, "bad id!");
        await until(badId.closed);
        expect(badId.closed()!.code).toBe(RemoteClose.AuthFailed);
        expect(manager.hosts().find((h) => h.id === "a")!.connected).toBe(true);
    });

    test("malformed, binary and out-of-order frames close the connection", async () => {
        const { port } = await deployment(["a"]);
        const garbage = await rawHost(port, "x", { hello: false });
        await until(() => garbage.find("challenge"));
        garbage.socket.send("not json");
        await until(garbage.closed);
        expect(garbage.closed()!.code).toBe(RemoteClose.BadRequest);

        const binary = await rawHost(port, "x", { hello: false });
        await until(() => binary.find("challenge"));
        binary.socket.send(new Uint8Array([1, 2, 3]));
        await until(binary.closed);
        expect(binary.closed()!.code).toBe(RemoteClose.BadRequest);

        const early = await rawHost(port, "x", { hello: false });
        await until(() => early.find("challenge"));
        early.send({ t: "pong", n: 1 });
        await until(early.closed);
        expect(early.closed()!.code).toBe(RemoteClose.BadRequest);
    });

    test("a connection that never says hello is closed", async () => {
        const { port } = await deployment(["a"], {}, { helloTimeout: 40 });
        const silent = await rawHost(port, "x", { hello: false });
        await until(silent.closed);
        expect(silent.closed()!.code).toBe(RemoteClose.HelloTimeout);
    });

    test("ClusterHost.connect() rejects when the coordinator refuses it", async () => {
        const { port } = await deployment(["a"]);
        const host = new ClusterHost({
            url: `ws://127.0.0.1:${port}`,
            secret: "wrong-secret-wrong-secret",
            id: "a",
            script: "w.js",
        });
        cleanup.push(() => host.close());
        await expect(host.connect()).rejects.toThrow(
            /refused this host \(4401/,
        );
        expect(host.connected).toBe(false);
    });

    test("spawn() fails when the hosts do not join, and frees the port", async () => {
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 2,
            remote: {
                port: 0,
                secret: SECRET,
                hosts: ["a", "b"],
                joinTimeout: 50,
            },
        });
        cleanup.push(() => manager.killAll());
        await expect(manager.spawn()).rejects.toThrow(
            /Hosts did not join within 50ms: \[a,b\]/,
        );
        expect(manager.remotePort).toBeUndefined();

        const counted = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 2,
            remote: { port: 0, secret: SECRET, minHosts: 2, joinTimeout: 30 },
        });
        cleanup.push(() => counted.killAll());
        await expect(counted.spawn()).rejects.toThrow(
            /Only 0 of 2 hosts joined/,
        );
    });

    test("shutting down while waiting for hosts ends the wait", async () => {
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 2,
            remote: {
                port: 0,
                secret: SECRET,
                hosts: ["a"],
                joinTimeout: 30_000,
            },
        });
        cleanup.push(() => manager.killAll());
        const spawning = manager.spawn();
        await until(() => manager.remotePort);
        await manager.shutdownAll();
        await spawning;
        expect(manager.remotePort).toBeUndefined();
    });

    test("without declared hosts, the hosts that joined are used", async () => {
        const local = fakeFork();
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 4,
            clusterCount: 2,
            spawnInterval: 0,
            fork: local.fork,
            remote: { port: 0, secret: SECRET, minHosts: 2 },
        });
        cleanup.push(() => manager.killAll());
        const spawning = manager.spawn();
        const port = await until(() => manager.remotePort);
        const forks = ["z", "y"].map((id) => {
            const forked = fakeFork();
            const host = new ClusterHost({
                url: `ws://127.0.0.1:${port}`,
                secret: SECRET,
                id,
                script: "w.js",
                fork: forked.fork,
            });
            cleanup.push(() => host.close());
            return { id, forked, host };
        });
        for (const { host } of forks) await host.connect();
        await spawning;
        // Sorted by ID: cluster 0 on "y", cluster 1 on "z".
        expect(manager.clusters.get(0)!.host).toBe("y");
        expect(manager.clusters.get(1)!.host).toBe("z");
    });
});

describe("clusters on hosts", () => {
    test("clusters are placed round-robin across the declared hosts", async () => {
        const { manager, agents, spawning } = await deployment(["a", "b"], {
            shardCount: 8,
            clusterCount: 4,
        });
        await spawning;
        await until(
            () =>
                agents.get("a")!.children.length === 2 &&
                agents.get("b")!.children.length === 2,
        );
        expect(agents.get("a")!.children.map((c) => c.env.CLUSTER_ID)).toEqual([
            "0",
            "2",
        ]);
        expect(agents.get("b")!.children.map((c) => c.env.CLUSTER_ID)).toEqual([
            "1",
            "3",
        ]);
        expect(agents.get("a")!.children.map((c) => c.env.SHARD_LIST)).toEqual([
            "0,4",
            "2,6",
        ]);
        expect([...manager.clusters.values()].map((c) => c.host)).toEqual([
            "a",
            "b",
            "a",
            "b",
        ]);
        expect(agents.get("a")!.children[0]!.env).toMatchObject({
            SHARD_COUNT: "8",
            CLUSTER_COUNT: "4",
            LUNIBEE_CLUSTER_WORKER: "1",
            LUNIBEE_SHARD_BUS: "ipc",
            LUNIBEE_IDENTIFY: "coordinated",
        });
        expect(agents.get("b")!.host.clusters()).toEqual([1, 3]);
        expect(manager.hosts()).toEqual([
            expect.objectContaining({
                id: "a",
                connected: true,
                clusters: [0, 2],
            }),
            expect.objectContaining({
                id: "b",
                connected: true,
                clusters: [1, 3],
            }),
        ]);
        // A remote worker's pid is the pid on its host.
        expect(manager.clusters.get(0)!.process.pid).toBe(
            agents.get("a")!.children[0]!.pid,
        );
    });

    test("only the worker contract crosses the wire", async () => {
        const { manager, port } = await deployment(["a"]);
        const raw = await rawHost(port, "a"); // duplicate: refused
        await until(raw.closed);
        const second = new ClusterManager({
            token: "secret-token",
            script: "w.js",
            shardCount: 2,
            clusterCount: 1,
            spawnInterval: 0,
            remote: { port: 0, secret: SECRET, hosts: ["a"] },
        });
        cleanup.push(() => second.killAll());
        process.env.COORDINATOR_ONLY = "do-not-leak";
        cleanup.push(() => delete process.env.COORDINATOR_ONLY);
        const spawning = second.spawn();
        const secondPort = await until(() => second.remotePort);
        const spy = await rawHost(secondPort, "a");
        const spawn = await until(() => spy.find("spawn"));
        await spawning;
        expect(Object.keys(spawn.env as object).sort()).toEqual([
            "CLUSTER_COUNT",
            "CLUSTER_ID",
            "LUNIBEE_CLUSTER_WORKER",
            "LUNIBEE_IDENTIFY",
            "LUNIBEE_SHARD_BUS",
            "SHARD_COUNT",
            "SHARD_LIST",
        ]);
        expect(JSON.stringify(spawn)).not.toContain("do-not-leak");
        expect(JSON.stringify(spawn)).not.toContain("secret-token");
        void manager;
    });

    test("mixes the coordinator's own machine with remote hosts", async () => {
        const { manager, agents, spawning, local } = await deployment(
            ["a"],
            { shardCount: 4, clusterCount: 2 },
            { local: true },
        );
        await spawning;
        expect(manager.clusters.get(0)!.host).toBe("local");
        expect(manager.clusters.get(1)!.host).toBe("a");
        expect(local.children).toHaveLength(1);
        await until(() => agents.get("a")!.children.length === 1);
    });

    test("readiness, health and routing work across hosts", async () => {
        const { manager, agents, spawning } = await deployment(["a", "b"]);
        await spawning;
        await until(
            () => agents.get("a")!.children[0] && agents.get("b")!.children[0],
        );
        agents.get("a")!.children[0]!.ready();
        agents.get("b")!.children[0]!.ready();
        await manager.ready(2000);
        expect(manager.health()).toMatchObject({
            state: "ready",
            readyClusters: 2,
        });
        expect(manager.health().clusters.map((c) => c.host)).toEqual([
            "a",
            "b",
        ]);

        // Shard 1 lives on host b, shard 0 on host a.
        const one = await manager.request<{ shard: number }>(1, "stats", 1);
        expect(one.shard).toBe(1);
        const all = await manager.broadcast("stats", null, { timeoutMs: 2000 });
        expect(all.replies.map((r) => r.shardId).sort()).toEqual([0, 1, 2, 3]);
        expect(all.missing).toEqual([]);
        const health = await manager.refreshHealth({ metrics: true });
        expect(health.clusters[1]!.metrics?.rssBytes).toBe(1);
        expect(await manager.requestCluster(1, "echo", 5)).toMatchObject({
            cluster: "1",
        });

        // A message between workers on different hosts reaches only the owner.
        agents.get("a")!.children[0]!.bus({
            source: 0,
            target: 1,
            type: "ping",
            data: 1,
            id: "m",
        });
        await until(
            () => agents.get("b")!.children[0]!.busFrames().length >= 1,
        );
        expect(
            agents
                .get("a")!
                .children[0]!.busFrames()
                .filter((m) => m.type === "ping"),
        ).toHaveLength(0);
    });

    test("IDENTIFY slots are shared by clusters on different hosts", async () => {
        const { manager, agents, spawning } = await deployment(["a", "b"], {
            maxConcurrency: 1,
            identify: { interval: 120 },
        });
        await spawning;
        const a = await until(() => agents.get("a")!.children[0]);
        const b = await until(() => agents.get("b")!.children[0]);
        a.control({ kind: "identify", id: 1, shardId: 0 });
        b.control({ kind: "identify", id: 1, shardId: 1 });
        await until(() => a.controlFrames("identify-grant").length === 1);
        expect(b.controlFrames("identify-grant")).toHaveLength(0);
        const first =
            a.sentAt[
                a.sent.findIndex(
                    (f) =>
                        (f[CLUSTER_FRAME] as { kind?: string })?.kind ===
                        "identify-grant",
                )
            ]!;
        a.control({ kind: "identify-done", shardId: 0 });
        await until(() => b.controlFrames("identify-grant").length === 1);
        const second =
            b.sentAt[
                b.sent.findIndex(
                    (f) =>
                        (f[CLUSTER_FRAME] as { kind?: string })?.kind ===
                        "identify-grant",
                )
            ]!;
        expect(second - first).toBeGreaterThanOrEqual(100);
        void manager;
    });

    test("a worker that exits on its host is restarted on the same host", async () => {
        const { manager, agents, spawning } = await deployment(["a", "b"]);
        await spawning;
        const b = agents.get("b")!;
        await until(() => b.children[0]);
        b.children[0]!.ready();
        await until(() => manager.clusters.get(1)?.state === "ready");
        b.children[0]!.exit(1, null);
        await until(() => b.children.length === 2);
        expect(b.children[1]!.env.SHARD_LIST).toBe(
            b.children[0]!.env.SHARD_LIST,
        );
        expect(manager.clusters.get(1)!.restarts).toBe(1);
        expect(manager.clusters.get(1)!.host).toBe("b");
    });
});

describe("host loss and fencing", () => {
    test("a host that disconnects kills its workers, and its clusters return when it does", async () => {
        const { manager, agents, spawning, port } = await deployment([
            "a",
            "b",
        ]);
        await spawning;
        const b = agents.get("b")!;
        const events: string[] = [];
        manager.on("hostLeave", (id) => events.push(`leave:${id}`));
        manager.on("hostJoin", (id) => events.push(`join:${id}`));
        await until(() => b.children[0]);
        b.children[0]!.ready();
        await until(() => manager.clusters.get(1)?.state === "ready");

        await b.host.close();
        // Fencing: the host killed its worker the moment the link went away.
        expect(b.children[0]!.kills).toContain("SIGKILL");
        await until(() => events.includes("leave:b"));
        expect(manager.hosts().find((h) => h.id === "b")!.connected).toBe(
            false,
        );
        expect(manager.health().missingShards.length).toBeGreaterThan(0);
        expect(manager.health().clusters[1]!.state).not.toBe("ready");

        // The same host comes back and its cluster is started again there.
        const forked = fakeFork();
        const again = new ClusterHost({
            url: `ws://127.0.0.1:${port}`,
            secret: SECRET,
            id: "b",
            script: "w.js",
            fork: forked.fork,
        });
        cleanup.push(() => again.close());
        await again.connect();
        await until(() => forked.children.length === 1, 4000);
        expect(forked.children[0]!.env.CLUSTER_ID).toBe("1");
        expect(events).toContain("join:b");
        forked.children[0]!.ready();
        agents.get("a")!.children[0]!.ready();
        await manager.ready(3000);
    });

    test("a coordinator that goes silent makes the host kill its workers", async () => {
        const server = Bun.serve({
            port: 0,
            fetch: (req, s) =>
                s.upgrade(req) ? undefined : new Response("x", { status: 426 }),
            websocket: {
                open: (ws) => {
                    ws.send(
                        JSON.stringify({
                            t: "challenge",
                            nonce: "n",
                            version: REMOTE_PROTOCOL_VERSION,
                        }),
                    );
                },
                message: (ws, raw) => {
                    const message = JSON.parse(raw as string) as { t: string };
                    if (message.t === "hello") {
                        ws.send(
                            JSON.stringify({
                                t: "welcome",
                                leaseMs: 90,
                                pingMs: 30,
                            }),
                        );
                        ws.send(
                            JSON.stringify({
                                t: "spawn",
                                cluster: 0,
                                epoch: 1,
                                env: { SHARD_LIST: "0", CLUSTER_ID: "0" },
                            }),
                        );
                    }
                },
            },
        });
        cleanup.push(() => server.stop(true));
        const forked = fakeFork();
        const host = new ClusterHost({
            url: `ws://127.0.0.1:${server.port}`,
            secret: SECRET,
            id: "quiet",
            script: "w.js",
            fork: forked.fork,
            reconnectDelay: 10_000,
        });
        const disconnects: number[] = [];
        host.on("disconnected", ({ code }) => disconnects.push(code));
        cleanup.push(() => host.close());
        await host.connect();
        await until(() => forked.children.length === 1);
        expect(host.clusters()).toEqual([0]);
        // No pings arrive: after one lease the host fences itself.
        await until(() => forked.children[0]!.kills.includes("SIGKILL"), 2000);
        await until(() => disconnects.length === 1);
        expect(disconnects[0]).toBe(RemoteClose.HostLost);
        expect(host.connected).toBe(false);
    });

    test("a host that stops answering is dropped after two leases", async () => {
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 1,
            clusterCount: 1,
            spawnInterval: 0,
            restartDelay: 10_000,
            remote: { port: 0, secret: SECRET, hosts: ["a"], lease: 100 },
        });
        cleanup.push(() => manager.killAll());
        const left: string[] = [];
        manager.on("hostLeave", (id, reason) => left.push(`${id}:${reason}`));
        const spawning = manager.spawn();
        const port = await until(() => manager.remotePort);
        // Authenticates, then never answers a ping.
        const mute = await rawHost(port, "a");
        await spawning;
        await until(() => mute.find("spawn"));
        const started = Date.now();
        await until(() => left.length === 1, 2000);
        expect(left[0]).toBe("a:The host stopped answering.");
        // Not before two leases of silence, so the host has fenced itself first.
        expect(Date.now() - started).toBeGreaterThanOrEqual(150);
        await until(mute.closed);
        expect(mute.closed()!.code).toBe(RemoteClose.HostLost);
        expect(manager.health().clusters[0]!.state).toBe("restarting");
    });

    test("stale frames from an earlier process are ignored", async () => {
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 2,
            clusterCount: 1,
            spawnInterval: 0,
            restartDelay: 10,
            remote: { port: 0, secret: SECRET, hosts: ["a"] },
        });
        cleanup.push(() => manager.killAll());
        const spawning = manager.spawn();
        const port = await until(() => manager.remotePort);
        const raw = await rawHost(port, "a");
        await spawning;
        const first = (await until(() => raw.all("spawn")[0])) as {
            epoch: number;
        };
        raw.send({ t: "spawned", cluster: 0, epoch: first.epoch, pid: 4242 });
        await until(() => manager.clusters.get(0)!.process.pid === 4242);
        // The worker exits and is started again with a new epoch.
        raw.send({
            t: "exit",
            cluster: 0,
            epoch: first.epoch,
            code: 1,
            signal: null,
        });
        const second = (await until(() => raw.all("spawn")[1], 4000)) as {
            epoch: number;
        };
        expect(second.epoch).toBeGreaterThan(first.epoch);
        // A ready frame from the first process must not mark the new one ready.
        raw.send({
            t: "frame",
            cluster: 0,
            epoch: first.epoch,
            frame: { [CLUSTER_FRAME]: { kind: "ready", shardIds: [0, 1] } },
        });
        await tick(30);
        expect(manager.clusters.get(0)!.state).toBe("starting");
        raw.send({
            t: "frame",
            cluster: 0,
            epoch: second.epoch,
            frame: { [CLUSTER_FRAME]: { kind: "ready", shardIds: [0, 1] } },
        });
        await until(() => manager.clusters.get(0)!.state === "ready");
        // A spawn error from the host is reported and treated as an exit.
        raw.send({
            t: "error",
            cluster: 0,
            epoch: second.epoch,
            message: "no such script",
        });
        await until(
            () =>
                manager.clusters.get(0) === undefined ||
                manager.clusters.get(0)!.restarts >= 2,
        );
    });

    test("a host that cannot start a worker reports it", async () => {
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 1,
            clusterCount: 1,
            spawnInterval: 0,
            restartDelay: 10_000,
            remote: { port: 0, secret: SECRET, hosts: ["a"] },
        });
        cleanup.push(() => manager.killAll());
        const errors: Error[] = [];
        manager.on("error", (error) => errors.push(error));
        const spawning = manager.spawn();
        const port = await until(() => manager.remotePort);
        const host = new ClusterHost({
            url: `ws://127.0.0.1:${port}`,
            secret: SECRET,
            id: "a",
            script: "missing.js",
            fork: () => {
                throw new Error("script not found");
            },
        });
        cleanup.push(() => host.close());
        await host.connect();
        await spawning;
        await until(() => errors.length === 1);
        expect(errors[0]!.message).toBe(
            "Host a could not run cluster 0: script not found",
        );
        expect(manager.health().clusters[0]!.state).toBe("restarting");
    });

    test("the host refuses a second worker for the same cluster", async () => {
        const forked = fakeFork();
        const server = Bun.serve({
            port: 0,
            fetch: (req, s) =>
                s.upgrade(req) ? undefined : new Response("x", { status: 426 }),
            websocket: {
                open: (ws) => {
                    ws.send(
                        JSON.stringify({
                            t: "challenge",
                            nonce: "n",
                            version: REMOTE_PROTOCOL_VERSION,
                        }),
                    );
                },
                message: (ws, raw) => {
                    if (
                        (JSON.parse(raw as string) as { t: string }).t ===
                        "hello"
                    ) {
                        ws.send(
                            JSON.stringify({
                                t: "welcome",
                                leaseMs: 5000,
                                pingMs: 1000,
                            }),
                        );
                        for (const epoch of [1, 2])
                            ws.send(
                                JSON.stringify({
                                    t: "spawn",
                                    cluster: 0,
                                    epoch,
                                    env: { SHARD_LIST: "0" },
                                }),
                            );
                        // Frames for the wrong epoch, a refused signal and junk are all ignored.
                        ws.send(
                            JSON.stringify({
                                t: "kill",
                                cluster: 0,
                                epoch: 9,
                                signal: "SIGKILL",
                            }),
                        );
                        ws.send(
                            JSON.stringify({
                                t: "frame",
                                cluster: 0,
                                epoch: 9,
                                frame: 1,
                            }),
                        );
                        ws.send("garbage");
                        ws.send(JSON.stringify({ t: "bye", reason: "done" }));
                    }
                },
            },
        });
        cleanup.push(() => server.stop(true));
        const host = new ClusterHost({
            url: `ws://127.0.0.1:${server.port}`,
            secret: SECRET,
            id: "h",
            script: "w.js",
            fork: forked.fork,
            reconnectDelay: 60_000,
        });
        const errors: string[] = [];
        host.on("error", (error) => errors.push(error.message));
        cleanup.push(() => host.close());
        await host.connect();
        await until(() => errors.length >= 1);
        expect(errors[0]).toBe("The coordinator sent a malformed frame.");
        expect(forked.children).toHaveLength(1);
        // "bye" fences everything.
        await until(() => forked.children[0]!.kills.includes("SIGKILL"));
    });
});

describe("shutdown", () => {
    test("shutdownAll stops remote workers and the listener, repeatedly", async () => {
        const { manager, agents, spawning } = await deployment(["a", "b"]);
        await spawning;
        await until(
            () => agents.get("a")!.children[0] && agents.get("b")!.children[0],
        );
        const port = manager.remotePort!;
        await manager.shutdownAll();
        expect(agents.get("a")!.children[0]!.kills).toContain("SIGTERM");
        expect(agents.get("b")!.children[0]!.kills).toContain("SIGTERM");
        expect(manager.remotePort).toBeUndefined();
        await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
        await manager.shutdownAll();
        // A deliberate stop is not restarted.
        await tick(60);
        expect(agents.get("a")!.children).toHaveLength(1);
    });

    test("respawn keeps hosts connected", async () => {
        const { manager, agents, spawning } = await deployment(["a", "b"]);
        await spawning;
        await until(() => agents.get("a")!.children[0]);
        const port = manager.remotePort;
        await manager.respawn(6);
        expect(manager.remotePort).toBe(port);
        expect(agents.get("a")!.host.connected).toBe(true);
        await until(() => agents.get("a")!.children.length === 2);
        expect(agents.get("a")!.children[1]!.env.SHARD_COUNT).toBe("6");
    });

    test("killAll closes the listener and hosts fence themselves", async () => {
        const { manager, agents, spawning } = await deployment(["a"]);
        await spawning;
        await until(() => agents.get("a")!.children[0]);
        manager.killAll();
        await until(() => !agents.get("a")!.host.connected);
        expect(agents.get("a")!.children[0]!.kills.length).toBeGreaterThan(0);
        expect(manager.remotePort).toBeUndefined();
    });

    test("ClusterHost reconnects with backoff after the connection drops", async () => {
        let welcomes = 0;
        const server = Bun.serve({
            port: 0,
            fetch: (req, s) =>
                s.upgrade(req) ? undefined : new Response("x", { status: 426 }),
            websocket: {
                open: (ws) => {
                    ws.send(
                        JSON.stringify({
                            t: "challenge",
                            nonce: "n",
                            version: REMOTE_PROTOCOL_VERSION,
                        }),
                    );
                },
                message: (ws, raw) => {
                    if (
                        (JSON.parse(raw as string) as { t: string }).t !==
                        "hello"
                    )
                        return;
                    welcomes++;
                    ws.send(
                        JSON.stringify({
                            t: "welcome",
                            leaseMs: 5000,
                            pingMs: 1000,
                        }),
                    );
                    if (welcomes === 1)
                        setTimeout(() => ws.close(1001, "restart"), 10);
                },
            },
        });
        cleanup.push(() => server.stop(true));
        const host = new ClusterHost({
            url: `ws://127.0.0.1:${server.port}`,
            secret: SECRET,
            id: "flaky",
            script: "w.js",
            fork: fakeFork().fork,
            reconnectDelay: 10,
            maxReconnectDelay: 20,
        });
        const log: string[] = [];
        host.on("connected", () => log.push("up"));
        host.on("disconnected", () => log.push("down"));
        cleanup.push(() => host.close());
        await host.connect();
        await until(() => welcomes === 2);
        await until(() => log.join() === "up,down,up");
        await host.close();
        await host.close();
        expect(host.connected).toBe(false);
    });
});

describe("resource limits", () => {
    test("connections that have not authenticated are capped", async () => {
        const { port } = await deployment(
            ["a"],
            {},
            { maxUnauthenticated: 3, helloTimeout: 5000 },
        );
        const sockets: Awaited<ReturnType<typeof rawHost>>[] = [];
        for (let i = 0; i < 6; i++)
            sockets.push(await rawHost(port, `x${i}`, { hello: false }));
        await until(() => sockets.filter((s) => s.closed()).length >= 3);
        const refused = sockets.filter(
            (s) => s.closed()?.code === RemoteClose.TooManyConnections,
        );
        expect(refused).toHaveLength(3);
        // Closing one frees a place.
        sockets[0]!.socket.close();
        await tick(30);
        const again = await rawHost(port, "later", { hello: false });
        await until(() => again.find("challenge"));
        expect(again.closed()).toBeUndefined();
    });

    test("a worker cannot queue many IDENTIFY requests for one shard", async () => {
        const { manager, agents, spawning } = await deployment(["a"], {
            shardCount: 2,
            clusterCount: 1,
            maxConcurrency: 1,
            identify: { interval: 10_000 },
        });
        await spawning;
        const child = await until(() => agents.get("a")!.children[0]);
        for (let id = 1; id <= 50; id++)
            child.control({ kind: "identify", id, shardId: 0 });
        await until(() => child.controlFrames("identify-deny").length >= 48);
        expect(child.controlFrames("identify-grant")).toHaveLength(1);
        const denied = child.controlFrames("identify-deny");
        // One request holds the slot, one waits behind it, the rest are refused.
        expect(denied).toHaveLength(48);
        expect(denied[0]!.error).toMatch(/already waiting/);
        void manager;
    });
});

describe("transport security defaults", () => {
    const make = (remote: object) =>
        new ClusterManager({
            token: "t",
            script: "w.js",
            remote: { port: 0, secret: SECRET, ...remote },
        });

    test("listening on a network address needs TLS or an explicit opt-in", () => {
        // Loopback is the default and needs nothing.
        expect(() => make({})).not.toThrow();
        for (const hostname of ["127.0.0.1", "localhost", "[::1]", "127.0.0.2"])
            expect(() => make({ hostname })).not.toThrow();
        for (const hostname of [
            "0.0.0.0",
            "10.0.0.5",
            "coordinator.example.com",
            "::",
        ])
            expect({
                hostname,
                error: String(catchError(() => make({ hostname }))),
            }).toEqual({
                hostname,
                error: expect.stringContaining("without TLS"),
            });
        expect(() =>
            make({ hostname: "0.0.0.0", allowInsecure: true }),
        ).not.toThrow();
        expect(() =>
            make({ hostname: "0.0.0.0", tls: { cert: "CERT", key: "KEY" } }),
        ).not.toThrow();
        expect(() => make({ tls: { cert: "", key: "KEY" } })).toThrow(
            /cert and key/,
        );
        expect(() => make({ tls: { cert: "CERT" } })).toThrow(/cert and key/);
    });

    test("the default listener is reachable from this machine only", async () => {
        const { manager } = await deployment(["a"]);
        const response = await fetch(`http://127.0.0.1:${manager.remotePort}`);
        expect(response.status).toBe(426);
    });

    test("a host connects over ws:// only to this machine, unless told otherwise", () => {
        const host = (url: string, extra: object = {}) =>
            new ClusterHost({
                url,
                secret: SECRET,
                id: "a",
                script: "w.js",
                ...extra,
            });
        for (const url of [
            "wss://coordinator.example.com:7070",
            "ws://localhost:7070",
            "ws://127.0.0.1:7070",
            "ws://[::1]:7070",
        ])
            expect(() => host(url)).not.toThrow();
        expect(() => host("ws://coordinator.example.com:7070")).toThrow(
            /wss:\/\//,
        );
        expect(() => host("ws://10.0.0.5:7070")).toThrow(/wss:\/\//);
        expect(() =>
            host("ws://10.0.0.5:7070", { allowInsecure: true }),
        ).not.toThrow();
        expect(() => host("wss://user:pass@example.com")).toThrow(
            /credentials/,
        );
        expect(() => host("not a url")).toThrow(/absolute/);
        try {
            host("wss://user:hunter2@example.com");
        } catch (error) {
            expect(String(error)).not.toContain("hunter2");
        }
    });

    test("authentication failures never reveal why, and weak secrets are refused", async () => {
        const { port } = await deployment(["a"]);
        const wrongSecret = await rawHost(port, "a", {
            secret: "x".repeat(40),
        });
        await until(wrongSecret.closed);
        const unknownHost = await rawHost(port, "unlisted");
        await until(unknownHost.closed);
        // A wrong secret and a wrong ID differ only in the close code, never in a message that helps guess the secret.
        expect(wrongSecret.closed()!.reason).toBe("Authentication failed.");
        expect(wrongSecret.received.map((m) => m.t)).toEqual(["challenge"]);
        expect(() => make({ secret: "short" })).toThrow(/at least 16/);
    });
});

function catchError(fn: () => unknown): unknown {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return undefined;
}

describe("frame limits are counted in UTF-8 bytes", () => {
    const frame = (value: string) =>
        JSON.stringify({ t: "pong", n: 1, pad: value });
    const overhead = new TextEncoder().encode(frame("")).length;

    test("a frame is accepted up to the byte limit and refused one byte over, for any script", () => {
        for (const [char, bytes] of [
            ["a", 1],
            ["漢", 3],
            ["🙂", 4],
        ] as const) {
            const limit = overhead + bytes * 20;
            const fits = frame(char.repeat(20));
            const over = frame(char.repeat(21));
            expect({
                char,
                ok: parseToCoordinator(fits, limit) !== null,
            }).toEqual({ char, ok: true });
            expect({
                char,
                ok: parseToCoordinator(over, limit) !== null,
            }).toEqual({ char, ok: false });
        }
        // A string with few code units but many bytes is still counted by bytes.
        const wide = frame("漢".repeat(100));
        expect(wide.length).toBeLessThan(overhead + 150);
        expect(parseToCoordinator(wide, overhead + 150)).toBeNull();
        expect(parseToHost(JSON.stringify({ t: "ping", n: 1 }), 5)).toBeNull();
        expect(
            parseToHost(JSON.stringify({ t: "ping", n: 1 }), 100),
        ).not.toBeNull();
    });
});
