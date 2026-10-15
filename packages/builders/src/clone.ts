/**
 * A deep copy of builder data, for `toJSON()`.
 *
 * Builder payloads are plain JSON: objects, arrays and primitives. Copying
 * those directly is several times faster than `structuredClone` on the small
 * payloads builders hold. Anything else (a Date, a Map, a class instance) and
 * anything nested deeper than 64 levels (a cycle) goes to `structuredClone`,
 * so the result is what `structuredClone` would give.
 */
export function cloneData<T>(value: T, depth = 0): T {
    if (value === null || typeof value !== "object") return value;
    if (depth > 64) return structuredClone(value);
    if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++)
            out[i] = cloneData(value[i], depth + 1);
        return out as T;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
        return structuredClone(value);
    const from = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(from))
        out[key] = cloneData(from[key], depth + 1);
    return out as T;
}
