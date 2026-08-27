/**
 * A listener registered for a Lunibee event.
 *
 * @typeParam T - The value supplied to the listener.
 */
export type EventListener<T extends unknown[] = unknown[]> = (...args: T) => unknown;

/**
 * A small event emitter used by the Lunibee client.
 */
export class EventEmitter<Events extends Record<string, unknown[]> = Record<string, unknown[]>> {
    readonly #listeners = new Map<keyof Events, Set<EventListener>>();

    /**
     * Registers a listener for an event.
     *
     * @param event - The event name.
     * @param listener - The function to invoke when the event is emitted.
     * @returns This emitter.
     */
    public on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this {
        let listeners = this.#listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.#listeners.set(event, listeners);
        }
        listeners.add(listener as EventListener);
        return this;
    }

    /**
     * Registers a listener that is removed after its first invocation.
     *
     * @param event - The event name.
     * @param listener - The function to invoke once.
     * @returns This emitter.
     */
    public once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this {
        const wrapped: EventListener<Events[K]> = (...args) => {
            this.off(event, wrapped);
            return listener(...args);
        };
        return this.on(event, wrapped);
    }

    /**
     * Removes a listener from an event.
     *
     * @param event - The event name.
     * @param listener - The listener to remove.
     * @returns This emitter.
     */
    public off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this {
        this.#listeners.get(event)?.delete(listener as EventListener);
        return this;
    }

    /**
     * Emits an event to all currently registered listeners.
     *
     * @param event - The event name.
     * @param args - Arguments passed to listeners.
     */
    protected emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
        for (const listener of this.#listeners.get(event) ?? []) void listener(...args);
    }
}
