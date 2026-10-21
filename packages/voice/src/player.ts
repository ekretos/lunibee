import { FRAME_DURATION_MS, SILENCE_FRAME, VoiceError } from "./protocol.js";
import { Emitter } from "./emitter.js";
import type { AudioResource } from "./resource.js";

/** Where an {@link AudioPlayer} is. */
export const AudioPlayerStatus = {
    /** Nothing to play. */
    Idle: "idle",
    /** A resource is loaded but its next frame is not ready yet. */
    Buffering: "buffering",
    /** Sending a frame every 20 ms. */
    Playing: "playing",
    /** Paused by `pause()`. */
    Paused: "paused",
    /** Paused because no subscribed connection can send (`noSubscriber: "pause"`). */
    AutoPaused: "autopaused",
} as const;
export type AudioPlayerStatus =
    (typeof AudioPlayerStatus)[keyof typeof AudioPlayerStatus];

/** A destination for a player's frames: a voice connection. */
export interface AudioSink {
    /** Whether it can send now. */
    readonly ready: boolean;
    sendFrame(frame: Uint8Array): boolean;
    setSpeaking(speaking: boolean): void;
}

/** Options for {@link AudioPlayer}. */
export interface AudioPlayerOptions {
    /** With no ready subscriber: `"pause"` (default) waits, `"play"` keeps consuming, `"stop"` stops. */
    noSubscriber?: "pause" | "play" | "stop";
    /** Frames the resource may be late in a row before playback fails. Default 250 (5 s). */
    maxMissedFrames?: number;
}

/** What {@link AudioPlayer} emits. */
export interface AudioPlayerEvents {
    stateChange: [from: AudioPlayerStatus, to: AudioPlayerStatus];
    /** The resource failed (an FFmpeg error, a corrupt stream). The player goes idle. */
    error: [error: Error, resource: AudioResource<unknown>];
    /** The resource played to its end. */
    finish: [resource: AudioResource<unknown>];
}

/** Silence frames sent after audio stops, so the receiving decoder does not interpolate. */
const SILENCE_PADDING = 5;
/** A tick this late (event loop blocked) restarts the clock instead of sending a burst. */
const MAX_LATENESS_MS = 100;

/**
 * Plays {@link AudioResource}s to subscribed connections: one 20 ms Opus
 * frame per tick, on a self-correcting clock. The clock runs only while
 * there is something to send; an idle or paused player has no timer.
 */
export class AudioPlayer extends Emitter<AudioPlayerEvents> {
    #state: AudioPlayerStatus = "idle";
    #resource?: AudioResource<unknown>;
    readonly #sinks = new Set<AudioSink>();
    readonly #options: Required<AudioPlayerOptions>;
    #timer?: ReturnType<typeof setTimeout>;
    #next = 0;
    #silence = 0;
    #missed = 0;

    public constructor(options: AudioPlayerOptions = {}) {
        super();
        this.#options = {
            noSubscriber: options.noSubscriber ?? "pause",
            maxMissedFrames: options.maxMissedFrames ?? 250,
        };
    }

    /** Current status. */
    public get state(): AudioPlayerStatus {
        return this.#state;
    }

    /** The resource playing (or paused), if any. */
    public get resource(): AudioResource<unknown> | undefined {
        return this.#resource;
    }

    /** Subscribed connections. */
    public get subscribers(): ReadonlySet<AudioSink> {
        return this.#sinks;
    }

    /** Whether the clock is running (for tests and diagnostics). */
    public get ticking(): boolean {
        return this.#timer !== undefined;
    }

    #transition(next: AudioPlayerStatus): void {
        if (this.#state === next) return;
        const from = this.#state;
        this.#state = next;
        this.emit("stateChange", from, next);
    }

    /**
     * Plays `resource`, replacing (and destroying) the current one.
     * @throws {VoiceError} If the resource already ended or was played before.
     */
    public play(resource: AudioResource<unknown>): void {
        if (resource.ended || resource.started)
            throw new VoiceError(
                "This audio resource has already been played; create a new one.",
            );
        if (this.#resource && this.#resource !== resource)
            this.#resource.destroy();
        this.#resource = resource;
        this.#missed = 0;
        this.#silence = 0;
        this.#transition(resource.readable ? "playing" : "buffering");
        this.#start();
    }

    /** Pauses. @param silence Send five silence frames first (default true). @returns Whether it paused. */
    public pause(silence = true): boolean {
        if (this.#state !== "playing" && this.#state !== "buffering")
            return false;
        this.#transition("paused");
        this.#silence = silence ? SILENCE_PADDING : 0;
        if (silence) this.#start();
        else this.#quiet();
        return true;
    }

    /** Resumes after `pause()`. @returns Whether it resumed. */
    public unpause(): boolean {
        if (this.#state !== "paused") return false;
        this.#silence = 0;
        this.#transition(this.#resource?.readable ? "playing" : "buffering");
        this.#start();
        return true;
    }

    /** Alias of {@link unpause}. */
    public resume(): boolean {
        return this.unpause();
    }

    /**
     * Stops and destroys the resource. @param force Skip the five silence
     * frames. @returns Whether anything was playing.
     */
    public stop(force = false): boolean {
        if (this.#state === "idle") return false;
        this.#resource?.destroy();
        this.#resource = undefined;
        this.#transition("idle");
        this.#silence = force ? 0 : SILENCE_PADDING;
        if (force) this.#quiet();
        else this.#start();
        return true;
    }

    /** @internal A connection subscribes. */
    public attach(sink: AudioSink): void {
        this.#sinks.add(sink);
        this.refresh();
    }

    /** @internal A connection unsubscribes. */
    public detach(sink: AudioSink): void {
        if (!this.#sinks.delete(sink)) return;
        try {
            sink.setSpeaking(false);
        } catch {
            // Its session is gone.
        }
        this.refresh();
    }

    /** @internal A subscriber's readiness changed: leave or enter `autopaused`. */
    public refresh(): void {
        if (this.#state === "autopaused" && this.#hasReadySink()) {
            this.#transition(
                this.#resource?.readable ? "playing" : "buffering",
            );
            this.#start();
        } else if (this.#state === "playing" || this.#state === "buffering")
            this.#start();
    }

    #hasReadySink(): boolean {
        for (const sink of this.#sinks) if (sink.ready) return true;
        return false;
    }

    #start(): void {
        if (this.#timer) return;
        this.#next = performance.now();
        this.#schedule();
    }

    #schedule(): void {
        this.#next += FRAME_DURATION_MS;
        const now = performance.now();
        if (now - this.#next > MAX_LATENESS_MS)
            this.#next = now + FRAME_DURATION_MS;
        this.#timer = setTimeout(
            () => {
                this.#timer = undefined;
                this.#tick();
            },
            Math.max(0, this.#next - now),
        );
    }

    /** Stops the clock and clears the speaking indicator. */
    #quiet(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = undefined;
        for (const sink of this.#sinks)
            try {
                sink.setSpeaking(false);
            } catch {
                // Its session is gone.
            }
    }

    #send(frame: Uint8Array): void {
        for (const sink of this.#sinks)
            if (sink.ready)
                try {
                    sink.sendFrame(frame);
                } catch {
                    // A failing connection must not stop the others.
                }
    }

    #tick(): void {
        // Silence padding after pause() or stop().
        if (this.#state === "idle" || this.#state === "paused") {
            if (this.#silence > 0) {
                this.#silence--;
                this.#send(SILENCE_FRAME);
                if (this.#silence > 0) return this.#schedule();
            }
            return this.#quiet();
        }
        if (this.#state === "autopaused") return this.#quiet();
        const resource = this.#resource;
        if (!resource) return this.#quiet();
        if (!this.#hasReadySink()) {
            if (this.#options.noSubscriber === "pause") {
                this.#transition("autopaused");
                return this.#quiet();
            }
            if (this.#options.noSubscriber === "stop") {
                this.stop(true);
                return;
            }
        }
        const frame = resource.read();
        if (frame === null) return this.#end(resource);
        if (frame === undefined) {
            // A live source is quiet while its user is; that is not a failure.
            if (resource.live) {
                if (!resource.started) this.#transition("buffering");
                return this.#schedule();
            }
            this.#transition("buffering");
            if (++this.#missed > this.#options.maxMissedFrames) {
                this.#fail(
                    resource,
                    new VoiceError(
                        "The audio resource stopped producing frames.",
                    ),
                );
                return;
            }
            return this.#schedule();
        }
        this.#missed = 0;
        this.#transition("playing");
        this.#send(frame);
        resource.playbackDuration += FRAME_DURATION_MS;
        this.#schedule();
    }

    #end(resource: AudioResource<unknown>): void {
        if (resource.error) return this.#fail(resource, resource.error);
        this.#resource = undefined;
        this.#transition("idle");
        this.emit("finish", resource);
        this.#silence = SILENCE_PADDING;
        this.#tick();
    }

    #fail(resource: AudioResource<unknown>, error: Error): void {
        resource.destroy();
        this.#resource = undefined;
        this.#transition("idle");
        this.emit("error", error, resource);
        this.#silence = SILENCE_PADDING;
        this.#tick();
    }
}

/** Creates an {@link AudioPlayer}. */
export function createAudioPlayer(options?: AudioPlayerOptions): AudioPlayer {
    return new AudioPlayer(options);
}
