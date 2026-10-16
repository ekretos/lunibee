import { SILENCE_FRAME } from "./protocol.js";

/** When a {@link VoiceReceiver.subscribe} stream ends. */
export type ReceiveEnd =
    | { behavior: "manual" }
    /** After `duration` ms with no audio (silence frames count as none). Default, 1,000 ms. */
    | { behavior: "silence"; duration?: number };

/** Options for {@link VoiceReceiver.subscribe}. */
export interface ReceiveOptions {
    end?: ReceiveEnd;
    /** Frames kept for a slow reader; newer frames are dropped beyond it. Default 50 (1 s). */
    highWaterMark?: number;
}

interface Subscription {
    controller: ReadableStreamDefaultController<Uint8Array>;
    end: ReceiveEnd;
    timer?: ReturnType<typeof setTimeout>;
}

function isSilence(frame: Uint8Array): boolean {
    return (
        frame.length === SILENCE_FRAME.length &&
        frame.every((byte, i) => byte === SILENCE_FRAME[i])
    );
}

/**
 * Receives other users' audio (low level): decrypted Opus packets per user.
 * SSRCs are mapped to users from op 5; decoding is up to you (`createOpusCodec`).
 */
export class VoiceReceiver {
    readonly #subscriptions = new Map<string, Set<Subscription>>();
    readonly #ssrcs = new Map<string, number>();
    readonly #speaking = new Map<string, ReturnType<typeof setTimeout>>();
    readonly #listeners = new Map<
        "start" | "end",
        Set<(userId: string) => void>
    >();

    /** The SSRC Discord assigned to a user, once they spoke. */
    public ssrcOf(userId: string): number | undefined {
        return this.#ssrcs.get(userId);
    }

    /** Users who sent audio in the last 100 ms. */
    public get speaking(): ReadonlySet<string> {
        return new Set(this.#speaking.keys());
    }

    /** Listens for a user starting or stopping to send audio. */
    public on(
        event: "start" | "end",
        listener: (userId: string) => void,
    ): this {
        let set = this.#listeners.get(event);
        if (!set) this.#listeners.set(event, (set = new Set()));
        set.add(listener);
        return this;
    }

    public off(
        event: "start" | "end",
        listener: (userId: string) => void,
    ): this {
        this.#listeners.get(event)?.delete(listener);
        return this;
    }

    #emit(event: "start" | "end", userId: string): void {
        for (const listener of this.#listeners.get(event) ?? [])
            try {
                listener(userId);
            } catch {
                // Listener failures are isolated.
            }
    }

    /**
     * A stream of `userId`'s Opus packets. It ends after a second without
     * audio unless `end.behavior` is `"manual"`; cancelling it unsubscribes.
     */
    public subscribe(
        userId: string,
        options: ReceiveOptions = {},
    ): ReadableStream<Uint8Array> {
        const end = options.end ?? { behavior: "silence" };
        let subscription: Subscription | undefined;
        return new ReadableStream<Uint8Array>(
            {
                start: (controller) => {
                    subscription = { controller, end };
                    let set = this.#subscriptions.get(userId);
                    if (!set)
                        this.#subscriptions.set(userId, (set = new Set()));
                    set.add(subscription);
                    this.#arm(userId, subscription);
                },
                cancel: () => {
                    if (subscription) this.#remove(userId, subscription);
                },
            },
            { highWaterMark: options.highWaterMark ?? 50 },
        );
    }

    /** Ends every stream of `userId`. @returns Whether there was one. */
    public unsubscribe(userId: string): boolean {
        const set = this.#subscriptions.get(userId);
        if (!set) return false;
        for (const subscription of [...set]) this.#close(userId, subscription);
        return true;
    }

    #arm(userId: string, subscription: Subscription): void {
        if (subscription.end.behavior !== "silence") return;
        if (subscription.timer) clearTimeout(subscription.timer);
        subscription.timer = setTimeout(
            () => this.#close(userId, subscription),
            subscription.end.duration ?? 1_000,
        );
    }

    #remove(userId: string, subscription: Subscription): void {
        if (subscription.timer) clearTimeout(subscription.timer);
        const set = this.#subscriptions.get(userId);
        set?.delete(subscription);
        if (set?.size === 0) this.#subscriptions.delete(userId);
    }

    #close(userId: string, subscription: Subscription): void {
        this.#remove(userId, subscription);
        try {
            subscription.controller.close();
        } catch {
            // Already closed or cancelled.
        }
    }

    /** @internal Op 5 told us a user's SSRC. */
    public mapUser(userId: string, ssrc: number): void {
        this.#ssrcs.set(userId, ssrc);
    }

    /** @internal Op 13: a user left. */
    public forgetUser(userId: string): void {
        this.#ssrcs.delete(userId);
        this.unsubscribe(userId);
    }

    /** @internal A decrypted frame arrived from `userId`. */
    public push(userId: string, frame: Uint8Array): void {
        const silent = isSilence(frame);
        if (!silent) this.#markSpeaking(userId);
        const set = this.#subscriptions.get(userId);
        if (!set) return;
        for (const subscription of set) {
            if (!silent) this.#arm(userId, subscription);
            const { controller } = subscription;
            // A reader that falls behind loses the newest frames, not memory.
            if ((controller.desiredSize ?? 1) <= 0) continue;
            try {
                controller.enqueue(frame);
            } catch {
                // Closed by the consumer.
            }
        }
    }

    #markSpeaking(userId: string): void {
        const timer = this.#speaking.get(userId);
        if (timer) clearTimeout(timer);
        else this.#emit("start", userId);
        this.#speaking.set(
            userId,
            setTimeout(() => {
                this.#speaking.delete(userId);
                this.#emit("end", userId);
            }, 100),
        );
    }

    /** @internal Ends every stream and forgets every user (the connection left). */
    public close(): void {
        for (const [userId, set] of [...this.#subscriptions])
            for (const subscription of [...set])
                this.#close(userId, subscription);
        for (const timer of this.#speaking.values()) clearTimeout(timer);
        this.#speaking.clear();
        this.#ssrcs.clear();
    }
}
