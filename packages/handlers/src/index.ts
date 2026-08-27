/** A typed handler registry for Lunibee events. */
export class HandlerRegistry<Events extends Record<string, unknown[]>> {
    readonly #handlers = new Map<keyof Events, Set<(...args: any[]) => unknown>>();

    /** Registers a handler for an event. */
    public on<K extends keyof Events>(event: K, handler: (...args: Events[K]) => unknown): this {
        let handlers = this.#handlers.get(event);
        if (!handlers) { handlers = new Set(); this.#handlers.set(event, handlers); }
        handlers.add(handler);
        return this;
    }

    /** Registers a handler that is removed after the first invocation. */
    public once<K extends keyof Events>(event: K, handler: (...args: Events[K]) => unknown): this {
        const wrapped = (...args: Events[K]) => { this.off(event, wrapped); return handler(...args); };
        return this.on(event, wrapped);
    }

    /** Removes an event handler. */
    public off<K extends keyof Events>(event: K, handler: (...args: Events[K]) => unknown): this {
        this.#handlers.get(event)?.delete(handler);
        return this;
    }

    /** Dispatches an event to its registered handlers. */
    public async emit<K extends keyof Events>(event: K, ...args: Events[K]): Promise<void> {
        for (const handler of this.#handlers.get(event) ?? []) await handler(...args);
    }
}
