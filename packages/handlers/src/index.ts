/** A typed handler registry for Lunibee events. */
export class HandlerRegistry<
    Events extends { [K in keyof Events]: unknown[] },
> {
    /** Registered event handlers. */
    readonly #handlers = new Map<
        keyof Events,
        Set<(...args: any[]) => unknown>
    >();
    /** Registers a handler for an event. @param event Event key. @param handler Handler callback. @returns This registry. */
    public on<K extends keyof Events>(
        event: K,
        handler: (...args: Events[K]) => unknown,
    ): this {
        let handlers = this.#handlers.get(event);
        if (!handlers) {
            handlers = new Set();
            this.#handlers.set(event, handlers);
        }
        handlers.add(handler);
        return this;
    }
    /** Registers a one-shot handler. @param event Event key. @param handler Handler callback. @returns This registry. */
    public once<K extends keyof Events>(
        event: K,
        handler: (...args: Events[K]) => unknown,
    ): this {
        const wrapped = (...args: Events[K]) => {
            this.off(event, wrapped);
            return handler(...args);
        };
        return this.on(event, wrapped);
    }
    /** Removes a handler. @param event Event key. @param handler Handler callback. @returns This registry. */
    public off<K extends keyof Events>(
        event: K,
        handler: (...args: Events[K]) => unknown,
    ): this {
        this.#handlers.get(event)?.delete(handler);
        return this;
    }
    /** Dispatches an event to registered handlers. @param event Event key. @param args Event arguments. @returns A promise fulfilled after handlers complete. */
    public async dispatch<K extends keyof Events>(
        event: K,
        ...args: Events[K]
    ): Promise<void> {
        for (const handler of this.#handlers.get(event) ?? [])
            await handler(...args);
    }
    /** Emits an event using the conventional emitter name. @param event Event key. @param args Event arguments. @returns A promise fulfilled after handlers complete. */
    public emit<K extends keyof Events>(
        event: K,
        ...args: Events[K]
    ): Promise<void> {
        return this.dispatch(event, ...args);
    }
}
