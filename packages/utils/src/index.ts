/** Returns a promise that resolves after the specified duration. */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns an integer between the supplied inclusive bounds. */
export function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Tests whether a value is a Discord snowflake-like ID. */
export function isSnowflake(value: string): boolean {
    return /^\d{16,22}$/.test(value);
}
