/**
 * Final smoke test: the built `lunibee` package (dist/), the examples/basic
 * bot sharded across two forked clusters, against a fake Discord (Gateway
 * and REST on localhost). Checks the handshake of every shard, command
 * deployment, an interaction answered by the right shard, a crashed cluster
 * coming back, and a clean shutdown.
 *
 *   bun run build && bun scripts/smoke-cluster.ts
 */
import { ClusterManager } from "../dist/index.js";

const SHARDS = 4;
const identifies: { shard: [number, number]; at: number }[] = [];
const commandPuts: string[] = [];
const callbacks: { id: string; content: string }[] = [];
const sockets = new Map<number, { send(data: string): void }>();
let sequence = 0;

const server = Bun.serve({
    port: 0,
    async fetch(request, srv) {
        const url = new URL(request.url);
        if (url.pathname === "/gateway") {
            if (srv.upgrade(request, { data: { shard: -1 } })) return;
            return new Response("upgrade required", { status: 426 });
        }
        if (request.method === "PUT" && url.pathname.endsWith("/commands")) {
            commandPuts.push(url.pathname);
            return Response.json(await request.json());
        }
        const callback = url.pathname.match(
            /\/interactions\/(\d+)\/[^/]+\/callback$/,
        );
        if (request.method === "POST" && callback) {
            const body = (await request.json()) as {
                data: { content: string };
            };
            callbacks.push({ id: callback[1]!, content: body.data.content });
            return new Response(null, { status: 204 });
        }
        return Response.json(
            { message: "not found", code: 0 },
            { status: 404 },
        );
    },
    websocket: {
        open(ws) {
            ws.send(
                JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }),
            );
        },
        message(ws, raw) {
            const frame = JSON.parse(String(raw)) as { op: number; d: any };
            if (frame.op === 1) ws.send(JSON.stringify({ op: 11 }));
            if (frame.op === 2) {
                const shard = frame.d.shard as [number, number];
                identifies.push({ shard, at: Date.now() });
                (ws.data as { shard: number }).shard = shard[0];
                sockets.set(shard[0], ws);
                ws.send(
                    JSON.stringify({
                        op: 0,
                        t: "READY",
                        s: ++sequence,
                        d: {
                            v: 10,
                            user: {
                                id: "100000000000000001",
                                username: "smoke",
                                discriminator: "0",
                                bot: true,
                            },
                            guilds: [],
                            session_id: `session-${shard[0]}-${sequence}`,
                            resume_gateway_url: `ws://127.0.0.1:${server.port}/gateway`,
                            shard,
                            application: { id: "100000000000000002", flags: 0 },
                        },
                    }),
                );
            }
        },
        close(ws) {
            const { shard } = ws.data as { shard: number };
            if (sockets.get(shard) === ws) sockets.delete(shard);
        },
    },
});

const env = {
    DISCORD_TOKEN: "smoke.token.value",
    SMOKE_GATEWAY_URL: `ws://127.0.0.1:${server.port}/gateway?v=10&encoding=json`,
    SMOKE_REST_URL: `http://127.0.0.1:${server.port}/api/v10`,
};
Object.assign(process.env, env);

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
};
const until = async (test: () => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!test() && Date.now() < end) await Bun.sleep(20);
    return test();
};

const manager = new ClusterManager({
    token: env.DISCORD_TOKEN,
    script: new URL("./smoke/worker.ts", import.meta.url).pathname,
    shardCount: SHARDS,
    clusterCount: 2,
    maxConcurrency: 1,
    identify: { coordinate: false },
    spawnInterval: 0,
    waitForReady: true,
    startTimeout: 30_000,
    restartDelay: 100,
});
manager.on("error", (error) => console.error("manager error:", error.message));

const started = Date.now();
await manager.spawn();
check(
    manager.health().state === "ready",
    `two clusters ready in ${Date.now() - started} ms`,
);
check(
    identifies
        .map((i) => i.shard[0])
        .sort()
        .join() === "0,1,2,3" && identifies.every((i) => i.shard[1] === SHARDS),
    "every shard identified once with the right [id, count]",
);
const pids = new Set([...manager.clusters.values()].map((c) => c.process.pid));
check(pids.size === 2, "the shards run in two processes");
check(commandPuts.length === SHARDS, "each shard's bot deployed its commands");

// An interaction on shard 3 is answered by the bot that owns shard 3.
const interaction = (id: string) => ({
    op: 0,
    t: "INTERACTION_CREATE",
    s: ++sequence,
    d: {
        id,
        application_id: "100000000000000002",
        type: 2,
        token: "interaction-token",
        version: 1,
        channel_id: "100000000000000003",
        user: {
            id: "100000000000000004",
            username: "user",
            discriminator: "0",
        },
        data: { id: "100000000000000005", name: "ping", type: 1 },
        locale: "en-US",
        entitlements: [],
    },
});
sockets.get(3)!.send(JSON.stringify(interaction("200000000000000001")));
check(
    (await until(() => callbacks.length === 1, 5000)) &&
        callbacks[0]!.content === "Pong from shard 3!",
    "/ping on shard 3 answered by shard 3",
);

// A cluster that crashes comes back and its shards identify again.
const before = identifies.length;
const crashed = manager.clusterForShard(0)!;
const recovered = new Promise<void>((resolve) => manager.on("ready", resolve));
process.kill(crashed.process.pid!, "SIGKILL");
check(
    await Promise.race([
        recovered.then(() => true),
        Bun.sleep(20_000).then(() => false),
    ]),
    "a killed cluster is restarted and ready again",
);
check(
    identifies.length === before + crashed.shards.length,
    "its shards identified again",
);
sockets.get(0)!.send(JSON.stringify(interaction("200000000000000002")));
check(
    (await until(() => callbacks.length === 2, 5000)) &&
        callbacks[1]!.content === "Pong from shard 0!",
    "/ping on shard 0 answered after the restart",
);

const live = [...manager.clusters.values()].map((c) => c.process.pid!);
await manager.shutdownAll(5000);
await Bun.sleep(100);
const alive = live.filter((pid) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
});
check(alive.length === 0, "shutdownAll stops every worker process");
server.stop(true);

console.log(
    failures.length
        ? `\n${failures.length} check(s) failed`
        : "\nsmoke test passed",
);
process.exit(failures.length ? 1 : 0);
