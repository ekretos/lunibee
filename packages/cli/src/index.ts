#!/usr/bin/env bun

import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { main } from "./cli.js";

const color =
    !process.env.NO_COLOR &&
    process.env.TERM !== "dumb" &&
    Boolean(process.stdout.isTTY);

const code = await main(
    Bun.argv.slice(2),
    {
        cwd: process.cwd(),
        out: (line) => console.log(line),
        err: (line) => console.error(line),
        prompt: (question) => prompt(question),
        interactive: Boolean(process.stdin.isTTY),
        color,
        run: (command, cwd) =>
            Bun.spawn(command, {
                cwd,
                stdin: "inherit",
                stdout: "inherit",
                stderr: "inherit",
                env: process.env,
            }).exited,
    },
    {
        version: packageJson.version,
        lunibeeRoot: resolve(import.meta.dir, "..", "..", ".."),
    },
);
process.exit(code);
