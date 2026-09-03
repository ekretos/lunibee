import { describe, expect, test } from "bun:test";
import { createProject } from "../packages/create/src/index.ts";

describe("Create Package", () => {
    test("createProject generates minimal project files with correct manifest", () => {
        const files = createProject({
            directory: "./my-bot",
            name: "my-discord-bot",
        });

        expect(files["package.json"]).toBeDefined();
        expect(files["src/index.ts"]).toBeDefined();

        const manifest = JSON.parse(files["package.json"]);
        expect(manifest.name).toBe("my-discord-bot");
        expect(manifest.type).toBe("module");
        expect(manifest.dependencies.lunibee).toBe("latest");

        expect(files["src/index.ts"]).toContain(
            'import { Client, GatewayIntentBits } from "lunibee";',
        );
        expect(files["src/index.ts"]).toContain("await client.login();");
    });
});
