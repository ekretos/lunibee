import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

/**
 * Keeps the workflow files to the project's policy: automatic checks run for
 * the maintained branches `master` and `dev` only, every job has explicit
 * permissions, and every Action is pinned to a commit.
 */
type Workflow = {
    name: string;
    on: Record<string, { branches?: string[] } | null>;
    permissions?: Record<string, string>;
    jobs: Record<
        string,
        { permissions?: Record<string, string>; steps?: { uses?: string }[] }
    >;
};

const dir = new URL("../.github/workflows/", import.meta.url).pathname;
const files = (await readdir(dir)).filter((f) => f.endsWith(".yml"));
const load = async (file: string): Promise<Workflow> =>
    Bun.YAML.parse(await Bun.file(dir + file).text()) as Workflow;

describe("workflows", () => {
    test("there are workflows to check", () => {
        expect(files).toEqual(
            expect.arrayContaining(["ci.yml", "security.yml"]),
        );
    });

    test("CI and Security run automatically for master and dev, and for nothing else", async () => {
        for (const file of ["ci.yml", "security.yml"]) {
            const { on } = await load(file);
            expect({ file, push: on.push?.branches }).toEqual({
                file,
                push: ["master", "dev"],
            });
            expect({ file, pr: on.pull_request?.branches }).toEqual({
                file,
                pr: ["master", "dev"],
            });
        }
    });

    test("manual runs are possible, and only Security is also scheduled", async () => {
        expect((await load("ci.yml")).on).toHaveProperty("workflow_dispatch");
        const security = (await load("security.yml")).on;
        expect(security).toHaveProperty("workflow_dispatch");
        expect(security).toHaveProperty("schedule");
        expect((await load("ci.yml")).on).not.toHaveProperty("schedule");
    });

    test("every workflow starts from read-only permissions", async () => {
        for (const file of files) {
            const { permissions } = await load(file);
            expect({ file, contents: permissions?.contents }).toEqual({
                file,
                contents: "read",
            });
        }
    });

    test("every Action is pinned to a full commit SHA", async () => {
        for (const file of files) {
            const workflow = await load(file);
            for (const [job, { steps }] of Object.entries(workflow.jobs))
                for (const step of steps ?? [])
                    if (step.uses)
                        expect({ file, job, uses: step.uses }).toEqual({
                            file,
                            job,
                            uses: expect.stringMatching(/@[0-9a-f]{40}$/),
                        });
        }
    });

    test("the Security workflow runs the dependency audit and the scan with history, and CI runs the audit script", async () => {
        const security = await Bun.file(dir + "security.yml").text();
        expect(security).toContain("bun audit");
        expect(security).toContain("bun scripts/security-scan.ts --history");
        expect(security).toContain("fetch-depth: 0");
        expect(await Bun.file(dir + "ci.yml").text()).toContain(
            "bun run audit:security",
        );
    });
});
