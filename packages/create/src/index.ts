/** Options used when generating a Lunibee project. */
export interface CreateProjectOptions {
    /** Project directory. */ directory: string;
    /** Package name. */ name: string;
}

/** Returns the files needed for a minimal Lunibee application. */
export function createProject(
    options: CreateProjectOptions,
): Record<string, string> {
    return {
        "package.json":
            JSON.stringify(
                {
                    name: options.name,
                    type: "module",
                    scripts: { start: "bun run src/index.ts" },
                    dependencies: { lunibee: "latest" },
                },
                null,
                2,
            ) + "\n",
        "src/index.ts":
            'import { Client, GatewayIntentBits } from "lunibee";\n\nconst client = new Client({ token: process.env.DISCORD_TOKEN!, intents: GatewayIntentBits.Guilds });\n\nclient.on("ready", () => console.log("Ready!"));\n\nawait client.login();\n',
    };
}
