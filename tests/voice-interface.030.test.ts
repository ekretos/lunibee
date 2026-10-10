import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import { Gateway, GatewayOpcodes } from "../packages/ws/src/index.ts";
import { ShardManager } from "../packages/sharding/src/index.ts";
import { FakeWebSocket, installWebSocket } from "./helpers/fake-websocket.ts";

const G0 = "4194304"; // (id >> 22) = 1 → shard 1 of 2
const G1 = "8388608"; // (id >> 22) = 2 → shard 0 of 2
const BOT = "300000000000000000";

async function ready(gateway: Gateway): Promise<FakeWebSocket> {
    const connecting = gateway.connect("wss://main.test");
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    socket.open();
    await connecting;
    socket.receive({
        op: GatewayOpcodes.Hello,
        d: { heartbeat_interval: 45_000 },
    });
    socket.dispatch(
        "READY",
        { session_id: "s", resume_gateway_url: "wss://r.test" },
        1,
    );
    return socket;
}

const voiceFrames = (socket: FakeWebSocket) =>
    socket
        .payloads()
        .filter((frame) => frame.op === GatewayOpcodes.VoiceStateUpdate);

describe("voice integration interface", () => {
    const Original = globalThis.WebSocket;
    beforeEach(() => {
        FakeWebSocket.instances = [];
        installWebSocket(FakeWebSocket);
    });
    afterEach(() => {
        globalThis.WebSocket = Original;
    });

    test("typed events carry the full payload without a cached guild", async () => {
        const client = new Client({ token: "a.b", intents: 0 });
        const states: unknown[] = [];
        const servers: unknown[] = [];
        const raw: string[] = [];
        client.on("voiceStateUpdate", (state) => states.push(state));
        client.on("voiceServerUpdate", (data) => servers.push(data));
        client.on("raw", (event: { event: string }) => raw.push(event.event));
        const socket = await ready(client.gateway);
        const joined = {
            guild_id: G0,
            channel_id: "9",
            session_id: "sess",
            user_id: BOT,
        };
        const left = { ...joined, channel_id: null };
        socket.dispatch("VOICE_STATE_UPDATE", joined, 2);
        socket.dispatch("VOICE_STATE_UPDATE", left, 3);
        socket.dispatch(
            "VOICE_SERVER_UPDATE",
            { token: "t", guild_id: G0, endpoint: "v.test:443" },
            4,
        );
        socket.dispatch(
            "VOICE_SERVER_UPDATE",
            { token: "t", guild_id: G0, endpoint: null },
            5,
        );
        expect(states).toEqual([joined, left]);
        expect(servers).toEqual([
            { token: "t", guild_id: G0, endpoint: "v.test:443" },
            { token: "t", guild_id: G0, endpoint: null },
        ]);
        expect(raw).toContain("VOICE_STATE_UPDATE");
        client.gateway.close();
    });

    test("Client#sendVoiceState sends op 4 and ws.send keeps working", async () => {
        const client = new Client({ token: "a.b", intents: 0 });
        const socket = await ready(client.gateway);
        expect(client.sendVoiceState(G0, "9", { selfDeaf: true })).toBe(true);
        expect(client.sendVoiceState(G0, null)).toBe(true);
        expect(
            client.ws.send({
                op: 4,
                d: { guild_id: G0, channel_id: null },
                s: null,
                t: null,
            }),
        ).toBe(true);
        expect(voiceFrames(socket).slice(0, 2)).toMatchObject([
            {
                op: 4,
                d: {
                    guild_id: G0,
                    channel_id: "9",
                    self_mute: false,
                    self_deaf: true,
                },
            },
            {
                op: 4,
                d: {
                    guild_id: G0,
                    channel_id: null,
                    self_mute: false,
                    self_deaf: false,
                },
            },
        ] as never);
        client.gateway.close();
    });

    test("sending while disconnected returns false and does not throw", () => {
        const client = new Client({ token: "a.b", intents: 0 });
        expect(client.sendVoiceState(G0, "9")).toBe(false);
        expect(
            new ShardManager({
                token: "a.b",
                intents: 0,
                shardCount: 2,
            }).sendVoiceState(G0, "9"),
        ).toBe(false);
    });

    test("sharded: ShardManager routes to the owning shard, Gateway refuses foreign guilds", async () => {
        const manager = new ShardManager({
            token: "a.b",
            intents: 0,
            shardCount: 2,
        });
        const sockets: FakeWebSocket[] = [];
        for (const shardId of [0, 1]) {
            const gateway = new Gateway({
                token: "a.b",
                intents: 0,
                shardId,
                shardCount: 2,
            });
            manager.shards.set(shardId, gateway);
            sockets.push(await ready(gateway));
        }
        expect(manager.getShardIdForGuild(G0)).toBe(1);
        expect(manager.sendVoiceState(G0, "9", { selfMute: true })).toBe(true);
        expect(manager.sendVoiceState(G1, null)).toBe(true);
        expect(voiceFrames(sockets[1]!)).toMatchObject([
            {
                op: 4,
                d: {
                    guild_id: G0,
                    channel_id: "9",
                    self_mute: true,
                    self_deaf: false,
                },
            },
        ] as never);
        expect(voiceFrames(sockets[0]!)).toMatchObject([
            {
                op: 4,
                d: {
                    guild_id: G1,
                    channel_id: null,
                    self_mute: false,
                    self_deaf: false,
                },
            },
        ] as never);
        expect(manager.shards.get(0)!.sendVoiceState(G0, "9")).toBe(false);
        for (const gateway of manager.shards.values()) gateway.close();
    });
});
