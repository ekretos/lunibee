/** Gateway event listener. */
export type GatewayListener = (data: unknown) => unknown;

/**
 * Listener registry and emission for one Gateway.
 *
 * A listener that throws, or returns a promise that rejects, is isolated from
 * the others and reported through `onFailure`, except for `error` listeners:
 * a failing error listener must not report itself again.
 */
export class GatewayDispatcher {
    readonly #listeners = new Map<string, Set<GatewayListener>>();
    readonly #onFailure: (error: unknown) => void;

    public constructor(onFailure: (error: unknown) => void) {
        this.#onFailure = onFailure;
    }

    /** Adds a listener. */
    public on(event: string, listener: GatewayListener): void {
        let listeners = this.#listeners.get(event);
        if (!listeners) this.#listeners.set(event, (listeners = new Set()));
        listeners.add(listener);
    }

    /** Removes a listener. */
    public off(event: string, listener: GatewayListener): void {
        this.#listeners.get(event)?.delete(listener);
    }

    /** Calls the listeners of `event` with `data`. */
    public emit(event: string, data: unknown): void {
        for (const listener of this.#listeners.get(event) ?? []) {
            try {
                const result = listener(data);
                if (
                    result &&
                    typeof (result as PromiseLike<unknown>).then === "function"
                )
                    void Promise.resolve(result).catch((error) => {
                        if (event !== "error") this.#onFailure(error);
                    });
            } catch (error) {
                if (event !== "error") this.#onFailure(error);
            }
        }
    }
}
