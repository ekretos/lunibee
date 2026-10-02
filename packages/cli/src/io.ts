/** Everything the CLI touches outside its own files, so commands can run in tests. */
export interface IO {
    /** Directory the command was run from. */
    cwd: string;
    out(line: string): void;
    err(line: string): void;
    /** Asks a question; null when there is no answer (EOF). */
    prompt(question: string): string | null;
    /** Whether prompts can be shown (stdin is a terminal). */
    interactive: boolean;
    /** Whether output may use ANSI colors. */
    color: boolean;
    /** Runs a command with inherited stdio. @returns Its exit code. */
    run(command: string[], cwd: string): Promise<number>;
}

/** An error meant for the user: printed without a stack, with an optional hint. */
export class CliError extends Error {
    public constructor(
        message: string,
        public readonly hint?: string,
    ) {
        super(message);
        this.name = "CliError";
    }
}

const CODES = { green: 32, yellow: 33, red: 31, dim: 2, bold: 1, cyan: 36 };

/** Colors `text` when the IO allows it. */
export function paint(
    io: Pick<IO, "color">,
    style: keyof typeof CODES,
    text: string,
): string {
    return io.color ? `\x1b[${CODES[style]}m${text}\x1b[0m` : text;
}

/** Levenshtein distance, for "did you mean" suggestions. */
function distance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++)
            current[j] = Math.min(
                previous[j]! + 1,
                current[j - 1]! + 1,
                previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        previous = current;
    }
    return previous[b.length]!;
}

/** The candidates closest to `input` (case-insensitive), best first. */
export function closest(
    input: string,
    candidates: readonly string[],
    limit = 3,
): string[] {
    const needle = input.toLowerCase();
    const budget = Math.max(2, Math.floor(needle.length / 3));
    return candidates
        .map((candidate) => ({
            candidate,
            score:
                needle.length >= 3 && candidate.toLowerCase().includes(needle)
                    ? 0
                    : distance(needle, candidate.toLowerCase()),
        }))
        .filter(({ score }) => score <= budget)
        .sort((a, b) => a.score - b.score)
        .slice(0, limit)
        .map(({ candidate }) => candidate);
}

/** "Did you mean …?" text, or undefined without a close match. */
export function didYouMean(
    input: string,
    candidates: readonly string[],
): string | undefined {
    const matches = closest(input, candidates);
    return matches.length
        ? `Did you mean ${matches.map((m) => `\`${m}\``).join(", ")}?`
        : undefined;
}

/** Escapes every RegExp metacharacter so `text` matches literally. */
export function escapeRegExp(text: string): string {
    return text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}
