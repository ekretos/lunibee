import { CreateEmbed } from "../../packages/builders/src/index.ts";
import type {
    InteractionReplyOptions,
    MessageCreateOptions,
    MessageEditOptions,
} from "../../packages/types/src/index.ts";

const embed = new CreateEmbed().setTitle("t");

export const validCreate: MessageCreateOptions = {
    content: "hi",
    embeds: [embed, { title: "raw" }],
    allowed_mentions: { parse: [] },
    flags: 4,
    files: [{ name: "a.txt", data: "x" }],
    message_reference: { message_id: "1" },
    poll: { question: { text: "q" }, answers: [{ poll_media: { text: "a" } }] },
    sticker_ids: ["1"],
    nonce: 1,
    anythingNew: true,
};
export const validEdit: MessageEditOptions = { content: "x", embeds: [embed] };
export const validReply: InteractionReplyOptions = {
    content: "x",
    ephemeral: true,
    withResponse: true,
};

// @ts-expect-error content must be a string
export const badContent: MessageCreateOptions = { content: 1 };
// @ts-expect-error embeds must be embeds, not numbers
export const badEmbeds: MessageCreateOptions = { embeds: [1] };
// @ts-expect-error ephemeral is a boolean
export const badEphemeral: InteractionReplyOptions = { ephemeral: "yes" };
// @ts-expect-error files need a name and data
export const badFiles: MessageCreateOptions = { files: [{ name: "a" }] };
