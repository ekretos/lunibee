import { Collection } from "../packages/collection/src/index.js";

const collection = new Collection<number, number>();
for (let index = 0; index < 10_000; index++) collection.set(index, index);

const started = performance.now();
for (let round = 0; round < 100; round++) collection.filter(value => value % 2 === 0);
const elapsed = performance.now() - started;

console.log(`Collection filter: ${elapsed.toFixed(2)}ms for 100 x 10,000 entries`);
console.log(`Heap used: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MiB`);
