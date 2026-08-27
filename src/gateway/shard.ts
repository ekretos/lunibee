import { GatewayManager } from "./manager.js";
import type { ClientOptions, GatewayPayload } from "../types.js";

export interface ShardOptions extends ClientOptions {
    shardId: number;
    shardCount: number;
}

export class Shard {
    readonly id: number;
    readonly #manager: GatewayManager;

    public constructor(options: ShardOptions, dispatch: (shardId: number, payload: GatewayPayload) => void) {
        this.id = options.shardId;
        this.#manager = new GatewayManager(options, payload => dispatch(this.id, payload));
    }

    public connect(): Promise<void> { return this.#manager.connect(); }
    public close(): void { this.#manager.close(); }
}
