import { describe, expect, test } from "bun:test";
import { MessageChannel } from "node:worker_threads";
import { threadEndpoint, threadFork } from "../packages/sharding/src/index.ts";
import { portEndpoint } from "../packages/sharding/src/thread.ts";

const script = new URL("./fixtures/thread-echo.ts", import.meta.url).pathname;

function next(child: { once(e: string, l: (m: any) => void): unknown }) {
    return new Promise<any>((resolve) => child.once("message", resolve));
}

describe("threadFork", () => {
    test("a thread gets the environment, and frames travel both ways", async () => {
        const child = threadFork()(script, {
            CLUSTER_ID: "7",
            SKIP: undefined,
        });
        expect(await next(child)).toEqual({ up: true });
        expect(typeof child.pid).toBe("number");
        child.send({ echo: { a: [1, 2] } } as never);
        expect(await next(child)).toEqual({
            echo: { a: [1, 2] },
            env: "7",
            same: true,
        });
        const exited = new Promise<unknown[]>((resolve) =>
            child.once("exit", (...args) => resolve(args)),
        );
        child.send({ exit: 3 } as never);
        expect(await exited).toEqual([3, null]);
        expect(child.exitCode).toBe(3);
        expect(child.send({} as never)).toBe(false);
        expect(child.kill()).toBe(false);
    });

    test("kill() terminates the thread and reports the signal", async () => {
        const child = threadFork({
            resourceLimits: { maxOldGenerationSizeMb: 64 },
        })(script, {});
        await next(child);
        const exited = new Promise<unknown[]>((resolve) =>
            child.once("exit", (...args) => resolve(args)),
        );
        expect(child.kill("SIGKILL")).toBe(true);
        expect(child.kill("SIGTERM")).toBe(true);
        expect(await exited).toEqual([null, "SIGKILL"]);
        expect(child.signalCode).toBe("SIGKILL");
        expect(child.connected).toBe(false);
    });

    test("a listener can be removed", async () => {
        const child = threadFork()(script, {});
        await next(child);
        child.send({ off: true } as never);
        expect(await next(child)).toEqual({ off: true });
        child.kill();
    });

    test("a port endpoint relays messages and ignores other events", async () => {
        const { port1, port2 } = new MessageChannel();
        const end = portEndpoint(port1);
        const got: unknown[] = [];
        const listener = (frame: unknown) => got.push(frame);
        expect(end.on("message", listener as never)).toBe(end);
        expect(end.on("disconnect", listener as never)).toBe(end);
        port2.postMessage({ n: 1 });
        await Bun.sleep(20);
        expect(end.send({ back: true })).toBe(true);
        const back = await new Promise((resolve) =>
            port2.once("message", resolve),
        );
        expect(back).toEqual({ back: true });
        expect(end.off("message", listener as never)).toBe(end);
        expect(end.off("disconnect", listener as never)).toBe(end);
        port2.postMessage({ n: 2 });
        await Bun.sleep(20);
        expect(got).toEqual([{ n: 1 }]);
        port1.close();
    });

    test("there is no thread endpoint on the main thread", () => {
        expect(threadEndpoint()).toBeUndefined();
    });
});
