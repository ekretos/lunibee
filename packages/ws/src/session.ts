/**
 * Identity of a Discord Gateway session, and the decision of how to open the
 * next connection with it.
 *
 * Deliberately owns nothing else: no socket, no timers, no opcode dispatch, no
 * compression, no event emission. Those belong to the transport, heartbeat,
 * reconnect and protocol seams. Keeping this object small is the point —
 * session confusion is what produced both WS-001 and WS-005.
 */

/** Everything needed to send a RESUME, or nothing when one is impossible. */
export interface ResumeInfo {
    /** Discord's session identifier from READY. */ sessionId: string;
    /** Last sequence number observed on this session. */ sequence: number;
    /** Host READY nominated for resuming this session. */ resumeURL: string;
}

/**
 * What the next connection must do.
 *
 * A discriminated union rather than a boolean plus three nullable fields: the
 * caller cannot reach for a session id on the identify branch, so "resume with
 * an undefined session" is not a state this codebase can express.
 */
export type HandshakeIntent =
    | ({ type: "resume" } & ResumeInfo)
    | { type: "identify" };

/** Internal session state. `none` and `established` are the only possibilities. */
type SessionState =
    | { status: "none" }
    | { status: "established"; sessionId: string; resumeURL: string };

/** Why a session was discarded. */
export type InvalidationReason =
    /** Discord sent `op 9` with `d: false`. */
    | "invalid-session"
    /** The connection closed with a code that forbids resuming. */
    | "session-timeout"
    /** Discarded by the owner without a protocol cause. */
    | "explicit";

/**
 * Session state for one Gateway shard.
 *
 * **Generations.** Every connection attempt takes a token from
 * {@link GatewaySession.beginConnection}, and every mutation must present it.
 * A socket that has been superseded still holds the old token, so a late
 * dispatch arriving on it cannot advance the new connection's sequence or
 * overwrite its session id. Ownership is therefore structural rather than a
 * chain of `if (this.#ws === ws)` checks at each call site.
 */
export class GatewaySession {
    #state: SessionState = { status: "none" };
    /**
     * Last sequence observed in the current generation.
     *
     * Held beside the state rather than inside the `established` variant
     * because READY *is* a dispatch: its own `s` is recorded a moment before
     * the session exists. Storing it only on an established session would
     * discard the very first sequence and make the next RESUME impossible.
     */
    #sequence: number | null = null;
    #generation = 0;
    #lastInvalidation?: InvalidationReason;

    /** Why the last session was discarded, for diagnostics and reconnect policy. */
    public get lastInvalidation(): InvalidationReason | undefined {
        return this.#lastInvalidation;
    }

    /** Token of the current connection attempt; mutations must match it. */
    public get generation(): number {
        return this.#generation;
    }

    /** Discord's session id, or undefined when no session is established. */
    public get sessionId(): string | undefined {
        return this.#state.status === "established"
            ? this.#state.sessionId
            : undefined;
    }

    /** Host to reconnect to for a RESUME, or undefined when none is known. */
    public get resumeURL(): string | undefined {
        return this.#state.status === "established"
            ? this.#state.resumeURL
            : undefined;
    }

    /**
     * Last sequence number seen, or null when none has been observed.
     *
     * Null, never zero, marks "nothing seen": sequence `0` is a legitimate
     * value that must survive into a RESUME.
     */
    public get sequence(): number | null {
        return this.#sequence;
    }

    /** Whether a RESUME is possible: a session, a resume host, and a sequence. */
    public get canResume(): boolean {
        return this.#state.status === "established" && this.#sequence !== null;
    }

    /**
     * Opens a new connection generation and returns its token.
     *
     * The session itself is untouched: reconnecting to resume must keep the
     * session id and sequence. Only ownership moves.
     */
    public beginConnection(): number {
        return ++this.#generation;
    }

    /** Whether `token` still owns this session. */
    public owns(token: number): boolean {
        return token === this.#generation;
    }

    /**
     * Records a sequence number from a payload.
     * @returns Whether the token owned the session and the value was stored.
     */
    public recordSequence(sequence: number, token: number): boolean {
        if (!this.owns(token)) return false;
        if (!Number.isInteger(sequence)) return false;
        this.#sequence = sequence;
        return true;
    }

    /**
     * Establishes the session from a READY payload.
     * @returns Whether the token owned the session and READY was well-formed.
     */
    public activate(payload: unknown, token: number): boolean {
        if (!this.owns(token)) return false;
        const ready = payload as {
            session_id?: unknown;
            resume_gateway_url?: unknown;
        };
        if (
            typeof ready?.session_id !== "string" ||
            typeof ready?.resume_gateway_url !== "string"
        )
            return false;
        this.#state = {
            status: "established",
            sessionId: ready.session_id,
            resumeURL: ready.resume_gateway_url,
        };
        return true;
    }

    /**
     * Discards the session so the next connection must IDENTIFY.
     *
     * Resumable invalidation (`op 9` with `d: true`) is *not* an invalidation:
     * the session survives and the caller simply reconnects, so this is only
     * called for the non-resumable cases.
     *
     * @returns Whether the token owned the session and state was discarded.
     */
    public invalidate(
        token: number,
        reason: InvalidationReason = "explicit",
    ): boolean {
        if (!this.owns(token)) return false;
        this.#lastInvalidation = reason;
        // The sequence belongs to the discarded session; carrying it into a
        // fresh IDENTIFY would resume numbering that Discord has forgotten.
        this.#state = { status: "none" };
        this.#sequence = null;
        return true;
    }

    /** Resume material, or undefined when a RESUME is not possible. */
    public resumeInfo(): ResumeInfo | undefined {
        if (this.#state.status !== "established") return undefined;
        if (this.#sequence === null) return undefined;
        const { sessionId, resumeURL } = this.#state;
        return { sessionId, sequence: this.#sequence, resumeURL };
    }

    /** What the next connection must send: RESUME with material, or IDENTIFY. */
    public handshake(): HandshakeIntent {
        const resume = this.resumeInfo();
        return resume ? { type: "resume", ...resume } : { type: "identify" };
    }

    /** Host the next connection should dial: the resume host, else `fallback`. */
    public connectURL(fallback: string): string {
        return this.resumeInfo()?.resumeURL ?? fallback;
    }
}
