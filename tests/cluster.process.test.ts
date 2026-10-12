import { describe, expect, test } from "bun:test";

/**
 * Real processes: the fixture parent forks real workers (real ShardManager,
 * ShardBus and IPC; only the Gateway sockets are replaced) and reports what
 * happened. It runs in its own Bun process so other suites' module mocks
 * cannot reach `child_process.fork`.
 */
describe("ClusterManager over real forked processes", () => {
    test("starts, coordinates IDENTIFY, routes, recovers a killed cluster and shuts down clean", async () => {
        const fixture = new URL("./fixtures/cluster-parent.ts", import.meta.url)
            .pathname;
        const child = Bun.spawn([process.execPath, fixture], {
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, BUN_OPTIONS: "" },
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), 40_000);
        const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ]);
        clearTimeout(timer);
        // The fixture exits by itself: no worker, timer or listener was left running.
        expect({ code, stderr }).toEqual({ code: 0, stderr: "" });

        const results = Object.fromEntries(
            stdout
                .trim()
                .split("\n")
                .map((line) => {
                    const { key, value } = JSON.parse(line) as {
                        key: string;
                        value: unknown;
                    };
                    return [key, value];
                }),
        ) as Record<string, any>;

        expect(results.health.state).toBe("ready");
        expect(results.health.readyClusters).toBe(2);
        expect(results.health.missingShards).toEqual([]);
        // max_concurrency 1 and a 150 ms interval: four IDENTIFYs, one at a
        // time, across two different processes.
        expect(results.gaps).toHaveLength(3);
        for (const gap of results.gaps as number[])
            expect(gap).toBeGreaterThanOrEqual(120);

        expect(results.broadcast.missing).toEqual([]);
        const answers = results.broadcast.replies
            .map((r: any) => [r.result.shard, r.result.cluster])
            .sort((a: number[], b: number[]) => a[0]! - b[0]!);
        expect(answers).toEqual([
            [0, 0],
            [1, 1],
            [2, 0],
            [3, 1],
        ]);
        expect(results.one.result ?? results.one).toMatchObject({
            shard: 3,
            cluster: 1,
        });

        expect(results.restart.before).not.toBe(results.restart.after);
        expect(results.restart.restarts).toBe(1);
        expect(results.again).toBe(4);
        expect(
            [...results.owners].sort(
                (a: number[], b: number[]) => a[0]! - b[0]!,
            ),
        ).toEqual([
            [0, 0],
            [1, 1],
            [2, 0],
            [3, 1],
        ]);
        expect(results.alive).toEqual([]);
        expect(results.events).toContain("restart0");
        expect(results.final).toBe("stopped");
    }, 60_000);
});
