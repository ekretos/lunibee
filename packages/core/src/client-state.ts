/** Lifecycle states exposed by the Lunibee client. */
export type ClientStatus =
  "idle" | "connecting" | "ready" | "disconnecting" | "disconnected";

/** Tracks client lifecycle state without coupling it to a transport implementation. */
export class ClientState {
  #status: ClientStatus = "idle";

  /** Current lifecycle status. */
  public get status(): ClientStatus {
    return this.#status;
  }

  /** Updates the lifecycle status. */
  public set status(value: ClientStatus) {
    this.#status = value;
  }
}
