import { describe, expect, test } from "bun:test";
import { Collector } from "../packages/core/src/collector.ts";

describe("Collector Coverage", () => {
  test("collects items passing filter", async () => {
    const collector = new Collector<string, number>({
      filter: (n) => n % 2 === 0,
      max: 2,
    });

    const collected: number[] = [];
    collector.on("collect", (item) => collected.push(item));

    await collector.handle("1", 1); // rejected by filter
    await collector.handle("2", 2); // accepted
    await collector.handle("4", 4); // accepted -> hits max limit

    expect(collected).toEqual([2, 4]);
    expect(collector.ended).toBe(true);
    expect(collector.endReason).toBe("limit");
  });

  test("next() resolves next item or rejects on end", async () => {
    const collector = new Collector<string, string>({ time: 50 });
    setTimeout(() => {
      collector.handle("k1", "v1");
    }, 10);

    const result = await collector.next();
    expect(result).toBe("v1");

    const timeoutCollector = new Collector<string, string>({ time: 20 });
    await expect(timeoutCollector.next()).rejects.toThrow("Collector ended");
  });

  test("respects maxProcessed option", async () => {
    const collector = new Collector<string, number>({ maxProcessed: 3 });
    await collector.handle("1", 1);
    await collector.handle("2", 2);
    await collector.handle("3", 3);
    expect(collector.ended).toBe(true);
    expect(collector.endReason).toBe("processedLimit");
  });
});
