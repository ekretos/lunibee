/** Lifecycle states exposed by the Lunibee client. */
export type ClientStatus = "idle" | "connecting" | "ready" | "disconnecting" | "disconnected";

const transitions: Record<ClientStatus, readonly ClientStatus[]> = {
    idle: ["connecting", "disconnected"],
    connecting: ["ready", "disconnecting", "disconnected"],
    ready: ["connecting", "disconnecting", "disconnected"],
    disconnecting: ["disconnected"],
    disconnected: ["connecting"]
};

/** Tracks client lifecycle state and validates state transitions. */
export class ClientState {
    #status: ClientStatus = "idle";

    /** Current lifecycle status. */
    public get status(): ClientStatus {
        return this.#status;
    }

    /** Changes the lifecycle status. */
    public transition(next: ClientStatus): void {
        if (next === this.#status) return;
        if (!transitions[this.#status].includes(next)) {
            throw new Error(`Invalid client state transition: ${this.#status} -> ${next}`);
        }
        this.#status = next;
    }

    /** Returns whether a lifecycle transition is valid. */
    public canTransition(next: ClientStatus): boolean {
        return next === this.#status || transitions[this.#status].includes(next);
    }
}
