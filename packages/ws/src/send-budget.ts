/**
 * Sliding-window budget for outgoing Gateway payloads.
 *
 * Discord allows 120 sends per 60 seconds. Application traffic is capped at
 * 115 so the remaining headroom is reserved for privileged sends (heartbeats),
 * which are still recorded so the true total stays under Discord's limit.
 */
export class SendBudget {
    readonly #timestamps: number[] = [];
    readonly #limit: number;
    readonly #windowMs: number;

    public constructor(limit = 115, windowMs = 60_000) {
        this.#limit = limit;
        this.#windowMs = windowMs;
    }

    /** Sends recorded within the current window. */
    public get used(): number {
        return this.#timestamps.length;
    }

    /** Whether a send may go out now. Privileged sends always may. */
    public allows(privileged: boolean, now = Date.now()): boolean {
        while (
            this.#timestamps.length &&
            now - this.#timestamps[0]! >= this.#windowMs
        )
            this.#timestamps.shift();
        return privileged || this.#timestamps.length < this.#limit;
    }

    /** Records a send that went out. */
    public record(now = Date.now()): void {
        this.#timestamps.push(now);
    }
}
