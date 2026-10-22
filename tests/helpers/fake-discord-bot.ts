import type { ServerWebSocket } from "bun";

/** Discord IDs the fake answers with. */
export const APP = "100000000000000002";

/** A Discord stand-in: REST under /api/v10 and a Gateway at /gateway. */
export function fakeDiscord(
    options: { registerStatus?: number; failRegistrations?: number } = {},
) {
    let failures = options.failRegistrations ?? 0;
    const puts: { path: string; body: unknown }[] = [];
    const callbacks: unknown[] = [];
    const edits: unknown[] = [];
    /** Channel messages the bot sent (POST) or edited (PATCH). */
    const messages: { method: string; body: unknown }[] = [];
    let socket: ServerWebSocket<unknown> | undefined;
    let ready!: () => void;
    const identified = new Promise<void>((resolve) => (ready = resolve));
    let sequence = 0;
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request, srv) {
            const url = new URL(request.url);
            // The bot connects straight to the Gateway (no /gateway/bot lookup).
            if (url.pathname === "/gateway" && srv.upgrade(request)) return;
            if (
                request.method === "PUT" &&
                url.pathname.endsWith("/commands")
            ) {
                const body = await request.json();
                puts.push({ path: url.pathname, body });
                if (failures > 0) {
                    failures--;
                    return Response.json(
                        { message: "Service Unavailable", code: 0 },
                        { status: 503 },
                    );
                }
                if (options.registerStatus)
                    return Response.json(
                        { message: "401: Unauthorized", code: 0 },
                        { status: options.registerStatus },
                    );
                return Response.json(body);
            }
            if (
                request.method === "POST" &&
                url.pathname.endsWith("/callback")
            ) {
                callbacks.push(await request.json());
                return new Response(null, { status: 204 });
            }
            if (
                request.method === "PATCH" &&
                url.pathname.includes("/messages/@original")
            ) {
                edits.push(await request.json());
                return Response.json({
                    id: "1",
                    channel_id: "1",
                    content: "",
                    author: { id: "1", username: "x" },
                });
            }
            if (/^\/api\/v10\/channels\/\d+\/messages/.test(url.pathname)) {
                const body = (await request.json()) as { content?: string };
                messages.push({ method: request.method, body });
                return Response.json({
                    id: "1300000000000000099",
                    channel_id: url.pathname.split("/")[4],
                    content: body.content ?? "",
                    author: {
                        id: "100000000000000001",
                        username: "testbot",
                        bot: true,
                    },
                });
            }
            return Response.json(
                { message: "Unknown", code: 0 },
                { status: 404 },
            );
        },
        websocket: {
            open(ws) {
                socket = ws;
                ws.send(
                    JSON.stringify({
                        op: 10,
                        d: { heartbeat_interval: 45000 },
                    }),
                );
            },
            message(ws, raw) {
                const frame = JSON.parse(String(raw)) as { op: number };
                if (frame.op === 1) ws.send(JSON.stringify({ op: 11 }));
                if (frame.op === 2) {
                    ws.send(
                        JSON.stringify({
                            op: 0,
                            t: "READY",
                            s: ++sequence,
                            d: {
                                v: 10,
                                user: {
                                    id: "100000000000000001",
                                    username: "testbot",
                                    discriminator: "0",
                                    bot: true,
                                },
                                guilds: [],
                                session_id: "session",
                                resume_gateway_url: `ws://127.0.0.1:${server.port}/gateway`,
                                application: { id: APP, flags: 0 },
                            },
                        }),
                    );
                    ready();
                }
            },
        },
    });
    return {
        url: `http://127.0.0.1:${server.port}`,
        puts,
        callbacks,
        edits,
        messages,
        identified,
        dispatch(t: string, d: unknown) {
            socket?.send(JSON.stringify({ op: 0, t, s: ++sequence, d }));
        },
        stop: () => server.stop(true),
    };
}

/** Redirects discord.com and the Gateway to the fake, below Lunibee. */
export const PRELOAD = `
const base = new URL(process.env.FAKE_DISCORD);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "discord.com") { url.protocol = base.protocol; url.host = base.host; }
    return realFetch(url, init);
};
const RealWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends RealWebSocket {
    constructor(url, protocols) {
        const target = new URL(String(url));
        if (target.hostname.endsWith("discord.gg")) { target.protocol = "ws:"; target.host = base.host; target.pathname = "/gateway"; }
        super(target, protocols);
    }
};
`;
