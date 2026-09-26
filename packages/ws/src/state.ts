/** Gateway connection lifecycle states. */
export enum GatewayState {
    /** Initial connection state. */ Connect = "CONNECT",
    /** Gateway HELLO received state. */ Hello = "HELLO",
    /** IDENTIFY operation in progress. */ Identify = "IDENTIFY",
    /** RESUME operation in progress. */ Resume = "RESUME",
    /** Gateway READY state. */ Ready = "READY",
    /** Gateway dispatch processing state. */ Dispatch = "DISPATCH",
    /** Heartbeat processing state. */ Heartbeat = "HEARTBEAT",
    /** Reconnect in progress. */ Reconnect = "RECONNECT",
    /** Gateway is permanently closed. */ Closed = "CLOSED",
}
/**
 * Discord.js-familiar alias for {@link GatewayState}.
 *
 * Discord.js exposes connection status via a `Status` enum. Lunibee's canonical
 * name is {@link GatewayState}; this is an additive alias so `discord.js` users
 * find the expected name. Note the *values* remain Lunibee's string states
 * (e.g. `"READY"`), not Discord.js's numeric `Status` members — an intentional
 * divergence documented in the compatibility matrix.
 */
export { GatewayState as Status };
/** Gateway protocol error. */
export class GatewayError extends Error {
    /** Gateway close/error code. */ public readonly code?: number;
    /** Creates a Gateway error. @param message Error message. @param code Optional Gateway code. @param options Optional error metadata. */ public constructor(
        message: string,
        code?: number,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "GatewayError";
        this.code = code;
    }
}
