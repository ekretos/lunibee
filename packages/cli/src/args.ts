import { CliError, didYouMean } from "./io.js";

export interface Args {
    positionals: string[];
    flags: Map<string, string | true>;
}

/** Flags that take a value (`--tag next` or `--tag=next`). */
export const VALUE_FLAGS = new Set([
    "cwd",
    "name",
    "description",
    "category",
    "tag",
    "otp",
]);
const ALIASES: Record<string, string> = {
    h: "help",
    v: "version",
    y: "yes",
    f: "force",
    n: "dry-run",
    d: "description",
    c: "category",
};

/** Splits argv into positionals and flags. `--` ends flag parsing. */
export function parseArgs(argv: readonly string[]): Args {
    const positionals: string[] = [];
    const flags = new Map<string, string | true>();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--") {
            positionals.push(...argv.slice(i + 1));
            break;
        }
        if (!arg.startsWith("-") || arg === "-") {
            positionals.push(arg);
            continue;
        }
        const long = arg.startsWith("--");
        const [rawName, inline] = (long ? arg.slice(2) : arg.slice(1)).split(
            /=(.*)/s,
            2,
        );
        if (!rawName) throw new CliError(`Invalid flag: ${arg}`);
        if (!long && rawName.length > 1 && inline === undefined) {
            // -yf → -y -f
            for (const letter of rawName)
                flags.set(ALIASES[letter] ?? letter, true);
            continue;
        }
        const name = long ? rawName : (ALIASES[rawName] ?? rawName);
        if (VALUE_FLAGS.has(name)) {
            const value = inline ?? argv[++i];
            if (
                value === undefined ||
                (inline === undefined && value.startsWith("-"))
            )
                throw new CliError(`--${name} needs a value.`);
            flags.set(name, value);
        } else if (inline !== undefined)
            throw new CliError(`--${name} does not take a value.`);
        else flags.set(name, true);
    }
    return { positionals, flags };
}

/** Throws on a flag the command does not accept. */
export function assertFlags(args: Args, allowed: readonly string[]): void {
    for (const name of args.flags.keys())
        if (!allowed.includes(name))
            throw new CliError(
                `Unknown option: --${name}`,
                didYouMean(
                    name,
                    allowed.map((flag) => flag),
                )?.replace(/`(\w[\w-]*)`/g, "`--$1`"),
            );
}

export function flag(args: Args, name: string): boolean {
    return args.flags.get(name) === true;
}

export function value(args: Args, name: string): string | undefined {
    const found = args.flags.get(name);
    return typeof found === "string" ? found : undefined;
}
