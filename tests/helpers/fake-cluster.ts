import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { REPLY_TYPE } from "../../packages/sharding/src/bus.ts";
import {
    CLUSTER_FRAME,
    PARENT_ID,
    REQUEST_ASSIGN,
    REQUEST_HEALTH,
} from "../../packages/sharding/src/protocol.ts";
import { BUS_FRAME } from "../../packages/sharding/src/transport.ts";

type Frame = Record<string, unknown>;

/** How a fake worker answers what the parent sends it. */
export interface WorkerBehavior {
    /** Shards that never answer shard-bus requests. */
    silentShards?: Set<number>;
    /** Shards whose handler throws. */
    errorShards?: Set<number>;
    /** Cluster request types that fail with this error. */
    failRequests?: Map<string, string>;
    /** Cluster request types that are never answered. */
    ignoreRequests?: Set<string>;
    /** Answer REQUEST_HEALTH with a report built from the shards. */
    answerHealth?: boolean;
}

/** A stand-in for a forked cluster process, driven by the test. */
export class FakeChild extends EventEmitter {
    public exitCode: number | null = null;
    public signalCode: NodeJS.Signals | null = null;
    public connected = true;
    public readonly pid: number;
    public readonly kills: (string | undefined)[] = [];
    /** Every frame the parent sent, in order. */
    public readonly sent: Frame[] = [];
    public ignoreTerm = false;
    public behavior: WorkerBehavior = {};

    public constructor(
        public readonly env: Record<string, string | undefined>,
        pid: number,
    ) {
        super();
        this.pid = pid;
    }

    /** Shards this worker was started with. */
    public get shards(): number[] {
        return (this.env.SHARD_LIST ?? "")
            .split(",")
            .filter(Boolean)
            .map(Number);
    }

    public send(frame: Frame): boolean {
        this.sent.push(frame);
        queueMicrotask(() => this.#answer(frame));
        return true;
    }

    public kill(signal?: string): boolean {
        this.kills.push(signal);
        if (signal === "SIGTERM" && this.ignoreTerm) return true;
        queueMicrotask(() => this.exit(null, (signal ?? "SIGTERM") as never));
        return true;
    }

    public exit(code: number | null, signal: NodeJS.Signals | null): void {
        if (this.exitCode !== null || this.signalCode !== null) return;
        this.exitCode = code;
        this.signalCode = signal;
        this.connected = false;
        this.emit("exit", code, signal);
    }

    /** The worker sends a control frame. */
    public control(body: Frame): void {
        this.emit("message", { [CLUSTER_FRAME]: body });
    }

    /** The worker sends a shard-bus message. */
    public bus(message: Frame): void {
        this.emit("message", { [BUS_FRAME]: message });
    }

    /** The worker reports every shard ready. */
    public ready(shardIds = this.shards): void {
        this.control({ kind: "ready", shardIds });
    }

    /** Control frames the parent sent, by kind. */
    public controlFrames(kind?: string): Frame[] {
        return this.sent
            .map((frame) => frame[CLUSTER_FRAME] as Frame | undefined)
            .filter(
                (body): body is Frame =>
                    body !== undefined && (!kind || body.kind === kind),
            );
    }

    /** Shard-bus messages the parent delivered. */
    public busFrames(): Frame[] {
        return this.sent
            .map((frame) => frame[BUS_FRAME] as Frame | undefined)
            .filter((message): message is Frame => message !== undefined);
    }

    /** `__lunibeePeerDown` notices the parent sent. */
    public peerDown(): number[][] {
        return this.sent
            .map((frame) => frame.__lunibeePeerDown as number[] | undefined)
            .filter((shards): shards is number[] => shards !== undefined);
    }

    #answer(frame: Frame): void {
        const control = frame[CLUSTER_FRAME] as Frame | undefined;
        if (control?.kind === "request") {
            const type = control.type as string;
            const id = control.id as string;
            if (this.behavior.ignoreRequests?.has(type)) return;
            const failure = this.behavior.failRequests?.get(type);
            if (failure !== undefined) {
                this.control({ kind: "reply", id, error: failure });
                return;
            }
            if (type === REQUEST_HEALTH) {
                if (this.behavior.answerHealth === false) return;
                this.control({
                    kind: "reply",
                    id,
                    result: {
                        shards: this.shards.map((shard) => ({
                            id: shard,
                            state: "dispatch",
                            ping: 10,
                            status: "ready",
                        })),
                        ...((control.data as { metrics?: boolean })?.metrics
                            ? {
                                  metrics: {
                                      rssBytes: 1,
                                      heapUsedBytes: 2,
                                      cpuUserMicros: 3,
                                      cpuSystemMicros: 4,
                                  },
                              }
                            : {}),
                        reportedAt: 123,
                    },
                });
                return;
            }
            if (type === REQUEST_ASSIGN) {
                const shardIds = (control.data as { shardIds: number[] })
                    .shardIds;
                this.env.SHARD_LIST = [...this.shards, ...shardIds].join(",");
            }
            this.control({
                kind: "reply",
                id,
                result: {
                    type,
                    data: control.data,
                    cluster: this.env.CLUSTER_ID,
                },
            });
            return;
        }
        const message = frame[BUS_FRAME] as Frame | undefined;
        if (message?.expectsReply) {
            const target = message.target as number | null;
            const own = this.shards;
            const answering =
                target === null ? own : own.filter((s) => s === target);
            for (const shard of answering) {
                if (this.behavior.silentShards?.has(shard)) continue;
                this.bus({
                    source: shard,
                    target: PARENT_ID,
                    type: REPLY_TYPE,
                    id: `reply:${shard}`,
                    data: this.behavior.errorShards?.has(shard)
                        ? {
                              requestId: message.id,
                              error: `shard ${shard} failed`,
                          }
                        : {
                              requestId: message.id,
                              result: { shard, echo: message.data },
                          },
                });
            }
        }
    }
}

/** A `fork` replacement that records the children it makes. */
export function fakeFork() {
    const children: FakeChild[] = [];
    let pid = 1000;
    const fork = (
        _script: string,
        env: Record<string, string | undefined>,
    ): ChildProcess => {
        const child = new FakeChild({ ...env }, ++pid);
        for (const hook of hooks) hook(child);
        children.push(child);
        return child as unknown as ChildProcess;
    };
    const hooks: ((child: FakeChild) => void)[] = [];
    return {
        fork,
        children,
        /** Runs for every child as it is forked, before the manager sees it. */
        onFork: (hook: (child: FakeChild) => void) => hooks.push(hook),
    };
}

export const tick = (ms = 0): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
