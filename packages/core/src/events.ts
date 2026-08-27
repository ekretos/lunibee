import type { ClientEvents } from "./index.js";

/** Names of events emitted by a Lunibee client. */
export type ClientEvent = keyof ClientEvents;

/** Listener signature for a Lunibee client event. */
export type ClientListener<K extends ClientEvent> = (...args: ClientEvents[K]) => unknown;
