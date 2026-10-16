import { SILENCE_FRAME, VoiceError } from "./protocol.js";

/** The parts of `@snazzah/davey`'s session this package uses. */
interface DaveyNativeSession {
    readonly ready: boolean;
    readonly voicePrivacyCode: string;
    reinit(protocolVersion: number, userId: string, channelId: string): void;
    reset(): void;
    setExternalSender(data: Buffer): void;
    getSerializedKeyPackage(): Buffer;
    processProposals(
        operationType: number,
        proposals: Buffer,
        recognizedUserIds?: string[],
    ): { commit?: Buffer; welcome?: Buffer };
    processWelcome(welcome: Buffer): void;
    processCommit(commit: Buffer): void;
    encryptOpus(packet: Buffer): Buffer;
    decrypt(userId: string, mediaType: number, packet: Buffer): Buffer;
    canPassthrough(userId: string): boolean;
    setPassthroughMode(passthrough: boolean, expirySeconds?: number): void;
}

/** The parts of `@snazzah/davey` this package uses. */
export interface DaveyModule {
    DAVE_PROTOCOL_VERSION: number;
    DAVESession: new (
        protocolVersion: number,
        userId: string,
        channelId: string,
    ) => DaveyNativeSession;
}

let davey: DaveyModule | null | undefined;

/**
 * Loads `@snazzah/davey` (the DAVE protocol: MLS group keys and frame
 * encryption), an optional peer dependency. @returns The module, or `null`
 * when it is not installed.
 */
export async function loadDave(): Promise<DaveyModule | null> {
    if (davey !== undefined) return davey;
    try {
        // Optional peer: a variable keeps bundlers from inlining its native binaries.
        const name = "@snazzah/davey";
        const mod = (await import(name)) as unknown as {
            default?: DaveyModule;
        } & DaveyModule;
        davey = mod.default?.DAVESession ? mod.default : mod;
    } catch {
        davey = null;
    }
    return davey;
}

/** Highest DAVE protocol version available here: 0 when `@snazzah/davey` is not installed. */
export async function maxDaveProtocolVersion(): Promise<number> {
    return (await loadDave())?.DAVE_PROTOCOL_VERSION ?? 0;
}

const TRANSITION_EXPIRY_S = 10;
const TRANSITION_EXPIRY_DOWNGRADE_S = 24;
const DECRYPTION_FAILURE_TOLERANCE = 36;
const AUDIO = 0;

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** What a {@link DaveSession} asks its connection to send. */
export interface DaveSessionHooks {
    /** Send op 26 with this key package. */
    keyPackage(payload: Uint8Array): void;
    /** Send op 31: this transition could not be applied. */
    invalidTransition(transitionId: number): void;
    debug?(message: string): void;
}

/**
 * One end-to-end encrypted (DAVE) media session: the MLS group of a voice
 * channel, its protocol transitions, and Opus frame encryption. Follows the
 * DAVE protocol's client flow (key package → proposals → commit/welcome →
 * transition ready → execute).
 */
export class DaveSession {
    public protocolVersion: number;
    readonly #module: DaveyModule;
    readonly #userId: string;
    readonly #channelId: string;
    readonly #hooks: DaveSessionHooks;
    #session?: DaveyNativeSession;
    readonly #pending = new Map<number, number>();
    #lastTransition?: number;
    #downgraded = false;
    #reinitializing = false;
    #failures = 0;

    public constructor(
        module: DaveyModule,
        protocolVersion: number,
        userId: string,
        channelId: string,
        hooks: DaveSessionHooks,
    ) {
        this.#module = module;
        this.protocolVersion = protocolVersion;
        this.#userId = userId;
        this.#channelId = channelId;
        this.#hooks = hooks;
    }

    /** Whether frames are currently end-to-end encrypted. */
    public get active(): boolean {
        return this.protocolVersion > 0 && Boolean(this.#session?.ready);
    }

    /** The voice privacy code users can compare, or `null` without DAVE. */
    public get voicePrivacyCode(): string | null {
        return this.protocolVersion > 0 && this.#session?.voicePrivacyCode
            ? this.#session.voicePrivacyCode
            : null;
    }

    /** (Re)creates the MLS state and announces a fresh key package. */
    public reinit(): void {
        if (this.protocolVersion > 0) {
            if (this.#session)
                this.#session.reinit(
                    this.protocolVersion,
                    this.#userId,
                    this.#channelId,
                );
            else
                this.#session = new this.#module.DAVESession(
                    this.protocolVersion,
                    this.#userId,
                    this.#channelId,
                );
            this.#hooks.keyPackage(this.#session.getSerializedKeyPackage());
        } else if (this.#session) {
            this.#session.reset();
            this.#session.setPassthroughMode(true, TRANSITION_EXPIRY_S);
        }
    }

    /** Op 25. */
    public setExternalSender(payload: Uint8Array): void {
        this.#native().setExternalSender(Buffer.from(payload));
    }

    /** Op 21. @returns Whether to answer with op 23 (transition ready). */
    public prepareTransition(
        transitionId: number,
        protocolVersion: number,
    ): boolean {
        this.#pending.set(transitionId, protocolVersion);
        if (transitionId === 0) {
            this.executeTransition(0);
            return false;
        }
        if (protocolVersion === 0)
            this.#session?.setPassthroughMode(
                true,
                TRANSITION_EXPIRY_DOWNGRADE_S,
            );
        return true;
    }

    /** Op 22. @returns Whether a pending transition was executed. */
    public executeTransition(transitionId: number): boolean {
        const next = this.#pending.get(transitionId);
        if (next === undefined) return false;
        const previous = this.protocolVersion;
        this.protocolVersion = next;
        if (previous !== next && next === 0) this.#downgraded = true;
        else if (transitionId > 0 && this.#downgraded) {
            this.#downgraded = false;
            this.#session?.setPassthroughMode(true, TRANSITION_EXPIRY_S);
        }
        this.#reinitializing = false;
        this.#lastTransition = transitionId;
        this.#pending.delete(transitionId);
        this.#hooks.debug?.(
            `DAVE transition ${transitionId}: v${previous} -> v${next}`,
        );
        return true;
    }

    /** Op 24. */
    public prepareEpoch(epoch: number, protocolVersion: number): void {
        if (epoch === 1) {
            this.protocolVersion = protocolVersion;
            this.reinit();
        }
    }

    /** Op 27. @returns The op 28 payload (commit, then welcome) to send, if any. */
    public processProposals(
        payload: Uint8Array,
        connectedUserIds: Iterable<string>,
    ): Uint8Array | undefined {
        if (payload.length < 1) return undefined;
        const { commit, welcome } = this.#native().processProposals(
            payload[0]!,
            Buffer.from(payload.subarray(1)),
            [...connectedUserIds],
        );
        if (!commit) return undefined;
        return welcome ? Buffer.concat([commit, welcome]) : commit;
    }

    /** Op 29 (commit) or op 30 (welcome). @returns The transition and whether it applied; a failure re-initializes. */
    public process(
        kind: "commit" | "welcome",
        payload: Uint8Array,
    ): { transitionId: number; ok: boolean } {
        const transitionId =
            payload.length >= 2 ? (payload[0]! << 8) | payload[1]! : 0;
        try {
            const body = Buffer.from(payload.subarray(2));
            if (kind === "commit") this.#native().processCommit(body);
            else this.#native().processWelcome(body);
            if (transitionId === 0) {
                this.#reinitializing = false;
                this.#lastTransition = 0;
            } else this.#pending.set(transitionId, this.protocolVersion);
            return { transitionId, ok: true };
        } catch (error) {
            this.#hooks.debug?.(`DAVE ${kind} failed: ${String(error)}`);
            this.#recover(transitionId);
            return { transitionId, ok: false };
        }
    }

    #recover(transitionId: number): void {
        if (this.#reinitializing) return;
        this.#reinitializing = true;
        this.#failures = 0;
        this.#hooks.invalidTransition(transitionId);
        this.reinit();
    }

    /** End-to-end encrypts an outgoing Opus frame (silence frames stay as they are). */
    public encrypt(frame: Uint8Array): Uint8Array {
        if (!this.active || equalBytes(frame, SILENCE_FRAME)) return frame;
        return this.#session!.encryptOpus(Buffer.from(frame));
    }

    /** Decrypts a frame from `userId`. @returns The Opus frame, or `null` to drop it. */
    public decrypt(frame: Uint8Array, userId: string): Uint8Array | null {
        const session = this.#session;
        const canDecrypt =
            session?.ready &&
            (this.protocolVersion !== 0 || session.canPassthrough(userId));
        if (!session || !canDecrypt || equalBytes(frame, SILENCE_FRAME))
            return frame;
        try {
            const out = session.decrypt(userId, AUDIO, Buffer.from(frame));
            this.#failures = 0;
            return out;
        } catch {
            if (!this.#reinitializing && this.#pending.size === 0) {
                this.#failures++;
                if (
                    this.#failures > DECRYPTION_FAILURE_TOLERANCE &&
                    this.#lastTransition !== undefined
                )
                    this.#recover(this.#lastTransition);
            }
            return null;
        }
    }

    #native(): DaveyNativeSession {
        if (!this.#session) throw new VoiceError("No DAVE session.");
        return this.#session;
    }

    /** Drops the MLS state. */
    public destroy(): void {
        try {
            this.#session?.reset();
        } catch {
            // Already reset.
        }
        this.#session = undefined;
    }
}
