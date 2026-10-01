import { expect, test } from "bun:test";
import type { MessagePayload } from "../packages/types/src/index.ts";
import type { InteractionReplyOptions } from "../packages/structures/src/index.ts";
import type { MessageCreateOptions } from "../packages/managers/src/index.ts";
import {
    CreateActionRow,
    CreateButton,
    CreateEmbed,
    ButtonType,
} from "../packages/builders/src/index.ts";

const embed = new CreateEmbed().setTitle("Hi").setColor(0xffc53d);
const row = new CreateActionRow().addComponents(
    new CreateButton()
        .setCustomId("ok")
        .setLabel("OK")
        .setStyle(ButtonType.Primary),
);

test("a MessagePayload takes builders and raw objects alike", () => {
    const payload: MessagePayload = {
        content: "hello",
        embeds: [embed, { title: "raw" }],
        components: [row],
        allowed_mentions: { parse: [] },
    };
    // Builders serialise through toJSON() when the request body is encoded.
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
        content: "hello",
        embeds: [embed.toJSON(), { title: "raw" }],
        components: [row.toJSON()],
        allowed_mentions: { parse: [] },
    });
});

test("a MessagePayload is accepted wherever Lunibee sends a message", () => {
    const payload: MessagePayload = { embeds: [embed] };
    const reply: InteractionReplyOptions = payload;
    const send: MessageCreateOptions = payload;
    expect(reply).toBe(payload);
    expect(send).toBe(payload);
});

test("a MessagePayload rejects wrong shapes at compile time", () => {
    const bad: MessagePayload[] = [
        // @ts-expect-error an embed is an object or a builder, not a number
        { embeds: [123] },
        // @ts-expect-error content is a string
        { content: 42 },
        // @ts-expect-error allowed_mentions.parse only takes users, roles, everyone
        { allowed_mentions: { parse: ["channels"] } },
    ];
    expect(bad).toHaveLength(3);
});
