type AnyListener = (...args: never[]) => unknown;

/** A small typed event emitter: listener failures are isolated, nothing is async. */
export class Emitter<E extends { [K in keyof E]: unknown[] }> {
    readonly #listeners = new Map<keyof E, Set<AnyListener>>();

    /** Adds a listener. @throws {TypeError} If it is not a function. */
    public on<K extends keyof E>(
        event: K,
        listener: (...args: E[K]) => unknown,
    ): this {
        if (typeof listener !== "function")
            throw new TypeError("Listener must be a function.");
        let set = this.#listeners.get(event);
        if (!set) this.#listeners.set(event, (set = new Set()));
        set.add(listener as AnyListener);
        return this;
    }

    /** Removes a listener. */
    public off<K extends keyof E>(
        event: K,
        listener: (...args: E[K]) => unknown,
    ): this {
        this.#listeners.get(event)?.delete(listener as AnyListener);
        return this;
    }

    /** Calls the listeners of `event`; one that throws does not stop the others. */
    protected emit<K extends keyof E>(event: K, ...args: E[K]): void {
        const set = this.#listeners.get(event);
        if (!set) return;
        for (const listener of [...set])
            try {
                void (listener as (...a: E[K]) => unknown)(...args);
            } catch {
                // Listener failures are isolated.
            }
    }

    /** Drops every listener. */
    protected removeAllListeners(): void {
        this.#listeners.clear();
    }
}
