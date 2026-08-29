import { Collection } from "../packages/collection/src/index.ts";
import { EmbedBuilder, SlashCommandBuilder } from "../packages/builders/src/index.ts";

const iterations = Number(process.env.BENCH_ITERATIONS ?? 10_000);
if (!Number.isInteger(iterations) || iterations <= 0) throw new RangeError("BENCH_ITERATIONS must be a positive integer");

function bench(name: string, operation: () => void): void {
    for (let i = 0; i < Math.min(1_000, iterations); i++) operation();
    const start = Bun.nanoseconds();
    for (let i = 0; i < iterations; i++) operation();
    const elapsed = Bun.nanoseconds() - start;
    const perOperation = elapsed / iterations;
    console.log(`${name}: ${perOperation.toFixed(2)} ns/op (${iterations} iterations)`);
}

const collection = new Collection<number, { value: number }>();
for (let i = 0; i < 1_000; i++) collection.set(i, { value: i });

bench("collection.set", () => collection.set(1_000, { value: 1_000 }));
bench("collection.find", () => collection.find(item => item.value === 999));
bench("collection.filter", () => collection.filter(item => item.value % 2 === 0));
bench("collection.clone", () => collection.clone());

bench("embed.serialize", () => new EmbedBuilder().setTitle("benchmark").setDescription("payload").toJSON());
bench("slash-command.serialize", () => new SlashCommandBuilder().setName("benchmark").setDescription("payload").toJSON());

console.log(`Lunibee parity benchmarks complete (iterations=${iterations}).`);
