import { expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import { Message } from "../packages/structures/src/index.ts";

const author = { id: "400", username: "User" };
const poll = {
    question: { text: "Lunch?" },
    answers: [
        { answer_id: 1, poll_media: { text: "Pizza" } },
        { answer_id: 2, poll_media: { text: "Sushi" } },
    ],
    expiry: "2026-10-01T00:00:00.000000+00:00",
    allow_multiselect: false,
    layout_type: 1,
};

test("stickers, poll and message snapshots are read from the payload", () => {
    const message = new Message({
        id: "200",
        channel_id: "300",
        author,
        content: "",
        sticker_items: [{ id: "10", name: "wave", format_type: 1 }],
        poll,
        message_snapshots: [
            {
                message: {
                    type: 0,
                    content: "original",
                    embeds: [],
                    attachments: [],
                    timestamp: "2026-09-30T00:00:00.000000+00:00",
                    flags: 0,
                },
            },
        ],
        message_reference: { type: 1, message_id: "199", channel_id: "301" },
    });
    expect(message.stickers).toEqual([
        { id: "10", name: "wave", format_type: 1 },
    ]);
    expect(message.poll?.answers.map((a) => a.poll_media.text)).toEqual([
        "Pizza",
        "Sushi",
    ]);
    expect(message.messageSnapshots[0]!.message.content).toBe("original");
});

test("missing fields default to empty, legacy stickers fall back", () => {
    const plain = new Message({
        id: "1",
        channel_id: "2",
        author,
        content: "",
    });
    expect(plain.stickers).toEqual([]);
    expect(plain.poll).toBeNull();
    expect(plain.messageSnapshots).toEqual([]);

    const legacy = new Message({
        id: "1",
        channel_id: "2",
        author,
        content: "",
        stickers: [
            { id: "11", name: "old", type: 1, format_type: 2, tags: "x" },
        ],
    });
    expect(legacy.stickers).toEqual([
        { id: "11", name: "old", format_type: 2 },
    ]);
});

test("MESSAGE_UPDATE carries the new fields", () => {
    const client = new Client({ token: "a.b", intents: 513 });
    const updates: Message[] = [];
    client.on("messageUpdate", (message) => updates.push(message));
    client.ws.emit("MESSAGE_CREATE", {
        id: "200",
        channel_id: "300",
        author,
        content: "",
        poll,
    });
    client.ws.emit("MESSAGE_UPDATE", {
        id: "200",
        channel_id: "300",
        author,
        content: "",
        poll: {
            ...poll,
            results: {
                is_finalized: true,
                answer_counts: [{ id: 1, count: 3, me_voted: false }],
            },
        },
        sticker_items: [{ id: "10", name: "wave", format_type: 1 }],
    });
    expect(updates[0]!.poll?.results?.is_finalized).toBe(true);
    expect(updates[0]!.stickers[0]!.name).toBe("wave");
});
