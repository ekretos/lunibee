import { GatewayError } from "../errors.js";
import type { ClientOptions, GatewayPayload } from "../types.js";
import { Shard } from "./shard.js";

export interface ShardingOptions {
    count?: number;
    maxConcurrency?: number;
}

export class ShardManager {
    readonly #options: ClientOptions;
    readonly #shards = new Map<number, Shard>();
    readonly #maxConcurrency: number;

    public constructor(options: ClientOptions, private readonly dispatch: (shardId: number, payload: GatewayPayload) => void, sharding: ShardingOptions = {}) {
        this.#options = options;
        this.#maxConcurrency = Math.max(1, sharding.maxConcurrency ?? 1);
        this.count = Math.max(1, sharding.count ?? 1);
    }

    public readonly count: number;

    public get shards(): ReadonlyMap<number, Shard> {
        return this.#shards;
    }

    public async connect(): Promise<void> {
        for (let start = 0; start < this.count; start += this.#maxConcurrency) {
            const batch = [];
            for (let id = start; id < Math.min(this.count, start + this.#maxConcurrency); id++) {
                const shard = new Shard({ ...this.#options, shardId: id, shardCount: this.count }, this.dispatch);
                this.#shards.set(id, shard);
                batch.push(shard.connect());
            }
            await Promise.all(batch);
            if (start + this.#maxConcurrency < this.count) await Bun.sleep(5_000);
        }
    }

    public close(): void {
        for (const shard of this.#shards.values()) shard.close();
    }

    public get(id: number): Shard {
        const shard = this.#shards.get(id);
        if (!shard) throw new GatewayError(`Shard ${id} does not exist`);
        return shard;
    }
}
