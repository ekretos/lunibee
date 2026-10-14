import { describe, expect, test } from "bun:test";
import { CreateAttachment } from "../packages/builders/src/index.ts";
import { Client } from "../packages/core/src/index.ts";
import { HttpTransport } from "../packages/rest/src/index.ts";

/** A client whose REST calls are captured instead of sent. */
function capture() {
    const bodies: FormData[] = [];
    const bot = new Client({
        token: "a.b.c-token-0123456789",
        intents: [1],
        rest: {
            transport: new HttpTransport({
                fetch: async (_url, init) => {
                    bodies.push(init.body as FormData);
                    return new Response(
                        JSON.stringify({
                            id: "2",
                            channel_id: "1",
                            content: "",
                            author: { id: "3", username: "bot" },
                            timestamp: new Date().toISOString(),
                        }),
                        { headers: { "content-type": "application/json" } },
                    );
                },
            }),
        } as never,
    });
    return { bot, bodies };
}

describe("sending a CreateAttachment", () => {
    test("its bytes are uploaded and its description becomes alt text", async () => {
        const { bot, bodies } = capture();
        const attachment = new CreateAttachment(new Uint8Array([1, 2, 3]), {
            name: "a.bin",
            description: "three bytes",
        });
        await bot.channels.send("1", { content: "x", files: [attachment] });
        const form = bodies[0]!;
        const file = form.get("files[0]") as File;
        expect(file.name).toBe("a.bin");
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(
            new Uint8Array([1, 2, 3]),
        );
        expect(JSON.parse(String(form.get("payload_json")))).toMatchObject({
            content: "x",
            attachments: [{ id: 0, description: "three bytes" }],
        });
    });

    test("a plain file with data still works, and its description is sent too", async () => {
        const { bot, bodies } = capture();
        await bot.channels.send("1", {
            files: [
                { name: "a.txt", data: "hi" },
                { name: "b.txt", data: "yo", description: "second" },
            ],
        });
        const payload = JSON.parse(String(bodies[0]!.get("payload_json")));
        expect(payload.attachments).toEqual([
            { id: 0 },
            { id: 1, description: "second" },
        ]);
        expect(await (bodies[0]!.get("files[1]") as File).text()).toBe("yo");
    });
});

describe("command managers accept builders", () => {
    test("create, set and edit send the builder's toJSON()", async () => {
        const { ApplicationCommandManager } =
            await import("../packages/managers/src/index.ts");
        const { CreateSlashCommand, CreateUserCommand } =
            await import("../packages/builders/src/index.ts");
        const { REST } = await import("../packages/rest/src/index.ts");
        const sent: unknown[] = [];
        const rest = new REST({
            token: "a.b.c-token-0123456789",
            transport: new HttpTransport({
                fetch: async (_url, init) => {
                    sent.push(JSON.parse(String(init.body)));
                    return new Response("{}", {
                        headers: { "content-type": "application/json" },
                    });
                },
            }),
        });
        const commands = new ApplicationCommandManager(rest, "1");
        const ping = new CreateSlashCommand()
            .setName("ping")
            .setDescription("Pong");
        await commands.create(ping);
        await commands.set([ping, new CreateUserCommand().setName("Profile")]);
        await commands.edit("2", { description: "Pong!" });
        expect(sent[0]).toMatchObject({ name: "ping", description: "Pong" });
        expect(sent[1]).toEqual([
            expect.objectContaining({ name: "ping" }),
            expect.objectContaining({ name: "Profile", type: 2 }),
        ]);
        expect(sent[2]).toEqual({ description: "Pong!" });
    });
});
