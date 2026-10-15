/**
 * What the REST pipeline reports while it works. Every field is bounded and
 * free of secrets: routes are normalized (ids become `:id`, tokens `:token`,
 * reaction emoji `:emoji`), and no token, fingerprint or body is included.
 */
export type RESTTelemetryEvent =
    /** One HTTP attempt got a response. */
    | {
          type: "response";
          method: string;
          route: string;
          status: number;
          durationMs: number;
      }
    /** A request settled (after every attempt), successfully or not. */
    | {
          type: "request";
          method: string;
          route: string;
          status: number;
          attempts: number;
          durationMs: number;
          ok: boolean;
      }
    /** Discord answered 429. */
    | {
          type: "rateLimited";
          route: string;
          scope: "user" | "global" | "shared" | "unknown";
          retryAfterMs: number;
      }
    /** A request waited for a limit before it could be sent. */
    | {
          type: "wait";
          reason: "bucket" | "global" | "probe";
          durationMs: number;
      }
    /** A reservation was asked of the store. */
    | {
          type: "reservation";
          granted: boolean;
          known: boolean;
          latencyMs: number;
      }
    /** A request is being sent again. */
    | {
          type: "retry";
          route: string;
          reason: "rateLimited" | "server" | "network";
          attempt: number;
      }
    /** A request was cancelled. */
    | {
          type: "cancelled";
          stage: "queued" | "waiting" | "transport" | "retry";
      }
    /** A request was refused because a queue was full. */
    | { type: "overloaded" }
    /** Discord answered 401 on a bot route: later requests with the token are refused. */
    | { type: "tokenRejected" }
    /** A transport attempt failed without a response. */
    | { type: "networkError"; timedOut: boolean }
    /** A route learned its bucket hash, or the hash changed. */
    | { type: "bucket"; change: "discovered" | "remapped"; route: string }
    /** One store command (Redis), with its latency. */
    | {
          type: "store";
          operation: string;
          latencyMs: number;
          ok: boolean;
      }
    /** The store's coordination mode changed. */
    | { type: "mode"; mode: CoordinationMode; previous: CoordinationMode }
    /** Queue depth and in-flight requests, after a change. */
    | { type: "queue"; queued: number; inFlight: number };

/**
 * How a store enforces limits right now.
 *
 * - `distributed`: shared state with atomic reservations.
 * - `observational`: shared state without atomic reservations (a client with
 *   no `eval`): workers can race on the last unit.
 * - `degraded-local`: shared state is unreachable and this process is
 *   limiting alone, from its last known state.
 * - `unavailable`: shared state is unreachable and requests fail
 *   (`failurePolicy: "fail-closed"`).
 * - `local`: a process-local store.
 */
export type CoordinationMode =
    | "distributed"
    | "observational"
    | "degraded-local"
    | "unavailable"
    | "local";

/** Receives telemetry events. Must be fast and must not throw. */
export interface RESTTelemetry {
    emit(event: RESTTelemetryEvent): void;
}

/** Calls a sink without letting it break the request path. */
export function emitTelemetry(
    sink: RESTTelemetry | undefined,
    event: RESTTelemetryEvent,
): void {
    if (!sink) return;
    try {
        sink.emit(event);
    } catch {
        // Diagnostics never fail a request.
    }
}

/** Histogram bucket upper bounds, in ms. */
const LATENCY_BOUNDS = [
    1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
];

interface Histogram {
    counts: number[];
    sum: number;
    count: number;
}

/** A snapshot of {@link RESTMetrics}. */
export interface RESTMetricsSnapshot {
    /** `name{label="v",…}` → count. */
    counters: Record<string, number>;
    /** `name` → last value. */
    gauges: Record<string, number>;
    /** `name{…}` → latency distribution in ms. */
    histograms: Record<
        string,
        { count: number; sum: number; buckets: Record<string, number> }
    >;
}

/**
 * An in-memory metrics aggregator for {@link RESTTelemetry}: counters,
 * gauges and latency histograms, with a hard cap on distinct label sets so
 * an unexpected route shape cannot grow it without bound.
 *
 * ```ts
 * const metrics = new RESTMetrics();
 * const rest = new REST({ token, telemetry: metrics });
 * // later: metrics.snapshot(), or metrics.toPrometheus() for a /metrics endpoint
 * ```
 */
export class RESTMetrics implements RESTTelemetry {
    readonly #counters = new Map<string, number>();
    readonly #gauges = new Map<string, number>();
    readonly #histograms = new Map<string, Histogram>();
    readonly #routes = new Set<string>();
    readonly #maxRoutes: number;

    /** @param options `maxRoutes`: distinct route labels kept before the rest become `other` (default 500). */
    public constructor(options: { maxRoutes?: number } = {}) {
        this.#maxRoutes = options.maxRoutes ?? 500;
    }

    #route(route: string): string {
        if (this.#routes.has(route)) return route;
        if (this.#routes.size >= this.#maxRoutes) return "other";
        this.#routes.add(route);
        return route;
    }

    #inc(name: string, labels: Record<string, string> = {}, by = 1): void {
        const key = metricKey(name, labels);
        this.#counters.set(key, (this.#counters.get(key) ?? 0) + by);
    }

    #observe(
        name: string,
        value: number,
        labels: Record<string, string> = {},
    ): void {
        const key = metricKey(name, labels);
        let h = this.#histograms.get(key);
        if (!h) {
            h = {
                counts: new Array<number>(LATENCY_BOUNDS.length + 1).fill(0),
                sum: 0,
                count: 0,
            };
            this.#histograms.set(key, h);
        }
        let i = LATENCY_BOUNDS.findIndex((bound) => value <= bound);
        if (i === -1) i = LATENCY_BOUNDS.length;
        h.counts[i]!++;
        h.sum += value;
        h.count++;
    }

    public emit(event: RESTTelemetryEvent): void {
        switch (event.type) {
            case "response":
                this.#inc("responses_total", {
                    method: event.method,
                    route: this.#route(event.route),
                    status: String(event.status),
                });
                this.#observe("response_latency_ms", event.durationMs, {
                    method: event.method,
                });
                break;
            case "request":
                this.#inc("requests_total", {
                    method: event.method,
                    outcome: event.ok ? "ok" : "error",
                });
                this.#observe("request_latency_ms", event.durationMs, {
                    method: event.method,
                });
                break;
            case "rateLimited":
                this.#inc("rate_limited_total", {
                    scope: event.scope,
                    route: this.#route(event.route),
                });
                break;
            case "wait":
                this.#inc("waits_total", { reason: event.reason });
                this.#observe("wait_ms", event.durationMs, {
                    reason: event.reason,
                });
                break;
            case "reservation":
                this.#inc("reservations_total", {
                    outcome: event.granted ? "granted" : "refused",
                });
                this.#observe("reservation_latency_ms", event.latencyMs);
                break;
            case "retry":
                this.#inc("retries_total", { reason: event.reason });
                break;
            case "cancelled":
                this.#inc("cancellations_total", { stage: event.stage });
                break;
            case "overloaded":
                this.#inc("overloaded_total");
                break;
            case "tokenRejected":
                this.#inc("token_rejected_total");
                break;
            case "networkError":
                this.#inc("network_errors_total", {
                    timeout: String(event.timedOut),
                });
                break;
            case "bucket":
                this.#inc("bucket_changes_total", { change: event.change });
                break;
            case "store":
                this.#inc("store_commands_total", {
                    operation: event.operation,
                    ok: String(event.ok),
                });
                this.#observe("store_latency_ms", event.latencyMs, {
                    operation: event.operation,
                });
                break;
            case "mode":
                this.#inc("mode_changes_total", { mode: event.mode });
                this.#gauges.set(
                    "degraded",
                    event.mode === "degraded-local" ||
                        event.mode === "unavailable"
                        ? 1
                        : 0,
                );
                break;
            case "queue":
                this.#gauges.set("queued", event.queued);
                this.#gauges.set("in_flight", event.inFlight);
                break;
        }
    }

    /** The current values. */
    public snapshot(): RESTMetricsSnapshot {
        const histograms: RESTMetricsSnapshot["histograms"] = {};
        for (const [key, h] of this.#histograms) {
            const buckets: Record<string, number> = {};
            let running = 0;
            LATENCY_BOUNDS.forEach((bound, i) => {
                running += h.counts[i]!;
                buckets[String(bound)] = running;
            });
            buckets["+Inf"] = h.count;
            histograms[key] = { count: h.count, sum: h.sum, buckets };
        }
        return {
            counters: Object.fromEntries(this.#counters),
            gauges: Object.fromEntries(this.#gauges),
            histograms,
        };
    }

    /** Clears every value. */
    public reset(): void {
        this.#counters.clear();
        this.#gauges.clear();
        this.#histograms.clear();
        this.#routes.clear();
    }

    /** The values in the Prometheus text exposition format. */
    public toPrometheus(prefix = "lunibee_rest"): string {
        const lines: string[] = [];
        const typed = new Set<string>();
        const type = (name: string, kind: string): void => {
            if (typed.has(name)) return;
            typed.add(name);
            lines.push(`# TYPE ${name} ${kind}`);
        };
        for (const [key, value] of this.#counters) {
            const name = `${prefix}_${key.split("{")[0]}`;
            type(name, "counter");
            lines.push(`${prefix}_${key} ${value}`);
        }
        for (const [key, value] of this.#gauges) {
            type(`${prefix}_${key}`, "gauge");
            lines.push(`${prefix}_${key} ${value}`);
        }
        for (const [key, h] of this.#histograms) {
            const [base, rawLabels = ""] = key.split("{");
            const labels = rawLabels.replace(/\}$/, "");
            const name = `${prefix}_${base}`;
            type(name, "histogram");
            const join = (extra: string): string =>
                `{${[labels, extra].filter(Boolean).join(",")}}`;
            let running = 0;
            LATENCY_BOUNDS.forEach((bound, i) => {
                running += h.counts[i]!;
                lines.push(`${name}_bucket${join(`le="${bound}"`)} ${running}`);
            });
            lines.push(`${name}_bucket${join('le="+Inf"')} ${h.count}`);
            lines.push(`${name}_sum${labels ? `{${labels}}` : ""} ${h.sum}`);
            lines.push(
                `${name}_count${labels ? `{${labels}}` : ""} ${h.count}`,
            );
        }
        return `${lines.join("\n")}\n`;
    }
}

function metricKey(name: string, labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return name;
    return `${name}{${entries
        .map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, "_")}"`)
        .join(",")}}`;
}
