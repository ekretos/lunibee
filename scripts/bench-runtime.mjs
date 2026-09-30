/**
 * Runtime comparison benchmark: every Collection method, every builder, every
 * formatter and every Gateway dispatch the client handles.
 *
 * Plain ESM against the built package (`bun run build` first), so Bun and Node
 * run exactly the same code:
 *
 *   bun  scripts/bench-runtime.mjs [--json]
 *   node scripts/bench-runtime.mjs [--json]
 *
 * BENCH_ITERATIONS (default 10000) timed runs per function, after 1000 warm-up runs.
 */
import * as lunibee from "../dist/index.js";

const {
    Client,
    Collection,
    CreateActionRow,
    CreateAttachment,
    CreateAttachmentOption,
    CreateBooleanOption,
    CreateButton,
    CreateChannelOption,
    CreateChannelSelectMenu,
    CreateContainer,
    CreateContentInventoryEntry,
    CreateContextMenuCommand,
    CreateEmbed,
    CreateFileComponent,
    CreateIntegerOption,
    CreateMediaGallery,
    CreateMentionableOption,
    CreateMentionableSelectMenu,
    CreateMessageCommand,
    CreateModal,
    CreateNumberOption,
    CreateRoleOption,
    CreateRoleSelectMenu,
    CreateSection,
    CreateSeparator,
    CreateSlashCommand,
    CreateStringOption,
    CreateStringSelect,
    CreateSubcommand,
    CreateSubcommandGroup,
    CreateTextDisplay,
    CreateTextInput,
    CreateThumbnail,
    CreateUserCommand,
    CreateUserOption,
    CreateUserSelectMenu,
} = lunibee;

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 10_000);
const WARMUP = 1_000;
const JSON_OUTPUT = process.argv.includes("--json");
const results = [];

function bench(group, name, run) {
    try {
        for (let i = 0; i < WARMUP; i++) run(i);
        const start = performance.now();
        for (let i = 0; i < ITERATIONS; i++) run(i);
        const ns = ((performance.now() - start) * 1e6) / ITERATIONS;
        results.push({ group, name, ns });
    } catch (error) {
        results.push({ group, name, ns: null, error: String(error?.message ?? error) });
    }
}

// ── Collections ────────────────────────────────────────────────────────────

const SIZE = 1_000;
const filled = (options) => {
    const collection = new Collection(null, options);
    for (let i = 0; i < SIZE; i++) collection.set(i, { value: i });
    return collection;
};
const plain = filled();
const other = new Collection();
for (let i = 500; i < 1_500; i++) other.set(i, { value: i });
const ttl = filled({ ttl: 60_000 });
const lru = filled({ maxSize: SIZE });
const map = new Map();
for (let i = 0; i < SIZE; i++) map.set(i, { value: i });

bench("Collection", "Map.set (reference)", (i) => map.set(i % SIZE, { value: i }));
bench("Collection", "Map.get (reference)", (i) => map.get(i % SIZE));
bench("Collection", "set", (i) => plain.set(i % SIZE, { value: i }));
bench("Collection", "get", (i) => plain.get(i % SIZE));
bench("Collection", "has", (i) => plain.has(i % SIZE));
bench("Collection", "peek", (i) => plain.peek(i % SIZE));
bench("Collection", "delete + set", (i) => {
    plain.delete(i % SIZE);
    plain.set(i % SIZE, { value: i });
});
bench("Collection", "setWithoutTTL", (i) => plain.setWithoutTTL(i % SIZE, { value: i }));
bench("Collection", "set (ttl)", (i) => ttl.set(i % SIZE, { value: i }));
bench("Collection", "get (ttl, sliding)", (i) => ttl.get(i % SIZE));
bench("Collection", "ttlRemaining", (i) => ttl.ttlRemaining(i % SIZE));
bench("Collection", "purge (ttl, nothing due)", () => ttl.purge());
bench("Collection", "set (lru, evicting)", (i) => lru.set(SIZE + (i % SIZE), { value: i }));
bench("Collection", "get (lru, promoting)", (i) => lru.get(SIZE + (i % SIZE)));
bench("Collection", "first", () => plain.first());
bench("Collection", "firstKey", () => plain.firstKey());
bench("Collection", "firstEntry", () => plain.firstEntry());
bench("Collection", "last", () => plain.last());
bench("Collection", "lastKey", () => plain.lastKey());
bench("Collection", "lastEntry", () => plain.lastEntry());
bench("Collection", "at", () => plain.at(500));
bench("Collection", "keyAt", () => plain.keyAt(500));
bench("Collection", "random", () => plain.random());
bench("Collection", "randomKey", () => plain.randomKey());
bench("Collection", "find (last item)", () => plain.find((item) => item.value === SIZE - 1));
bench("Collection", "findKey (last item)", () => plain.findKey((item) => item.value === SIZE - 1));
bench("Collection", "some (last item)", () => plain.some((item) => item.value === SIZE - 1));
bench("Collection", "someEntry (last item)", () => plain.someEntry((item) => item.value === SIZE - 1));
bench("Collection", "every", () => plain.every((item) => item.value >= 0));
bench("Collection", "filter", () => plain.filter((item) => item.value % 2 === 0));
bench("Collection", "partition", () => plain.partition((item) => item.value % 2 === 0));
bench("Collection", "each", () => plain.each(() => undefined));
bench("Collection", "tap", () => plain.tap(() => undefined));
bench("Collection", "array", () => plain.array());
bench("Collection", "keyArray", () => plain.keyArray());
bench("Collection", "entriesArray", () => plain.entriesArray());
bench("Collection", "toJSON", () => plain.toJSON());
bench("Collection", "clone", () => plain.clone());
bench("Collection", "sorted", () => plain.sorted((a, b) => b.value - a.value));
bench("Collection", "union", () => plain.union(other));
bench("Collection", "intersection", () => plain.intersection(other));
bench("Collection", "difference", () => plain.difference(other));
bench("Collection", "hasAll (3 keys)", () => plain.hasAll(1, 500, 999));
bench("Collection", "hasAny (3 keys)", () => plain.hasAny(-1, -2, 999));
bench("Collection", "sweep (removes none)", () => plain.sweep(() => false));

// ── Builders (construct, set, serialize) ───────────────────────────────────

const button = () => new CreateButton().setCustomId("id").setLabel("Label").setStyle(1).setEmoji("✅");
const option = { label: "One", value: "one", description: "The first" };

bench("Builders", "CreateEmbed", () =>
    new CreateEmbed()
        .setTitle("Title")
        .setDescription("Description")
        .setColor(0x2f4a9e)
        .setURL("https://example.com")
        .setAuthor({ name: "Author" })
        .setFooter({ text: "Footer" })
        .setTimestamp(new Date(0))
        .addFields({ name: "a", value: "1", inline: true }, { name: "b", value: "2" })
        .toJSON(),
);
bench("Builders", "CreateButton", () => button().toJSON());
bench("Builders", "CreateButton (link)", () => new CreateButton().setStyle(5).setLabel("Open").setURL("https://example.com").toJSON());
bench("Builders", "CreateActionRow (5 buttons)", () =>
    new CreateActionRow().addComponents(button(), button(), button(), button(), button()).toJSON(),
);
bench("Builders", "CreateStringSelect (3 options)", () =>
    new CreateStringSelect().setCustomId("s").setPlaceholder("Pick").setMinValues(1).setMaxValues(2).addOptions(option, option, option).toJSON(),
);
bench("Builders", "CreateUserSelectMenu", () => new CreateUserSelectMenu().setCustomId("u").setMaxValues(5).toJSON());
bench("Builders", "CreateRoleSelectMenu", () => new CreateRoleSelectMenu().setCustomId("r").setMaxValues(5).toJSON());
bench("Builders", "CreateMentionableSelectMenu", () => new CreateMentionableSelectMenu().setCustomId("m").toJSON());
bench("Builders", "CreateChannelSelectMenu", () => new CreateChannelSelectMenu().setCustomId("c").setDefaultValues({ id: "1", type: "channel" }).toJSON());
bench("Builders", "CreateTextInput", () =>
    new CreateTextInput().setCustomId("t").setLabel("Label").setStyle(2).setPlaceholder("…").setMinLength(1).setMaxLength(100).setRequired(true).toJSON(),
);
bench("Builders", "CreateModal (2 inputs)", () =>
    new CreateModal()
        .setCustomId("m")
        .setTitle("Title")
        .addTextInputs(new CreateTextInput().setCustomId("a").setLabel("A").setStyle(1), new CreateTextInput().setCustomId("b").setLabel("B").setStyle(2))
        .toJSON(),
);
bench("Builders", "CreateTextDisplay", () => new CreateTextDisplay().setContent("## Heading\nBody").toJSON());
bench("Builders", "CreateSeparator", () => new CreateSeparator().setSpacing(2).setDivider(true).toJSON());
bench("Builders", "CreateThumbnail", () => new CreateThumbnail().setUrl("https://example.com/a.png").setDescription("d").toJSON());
bench("Builders", "CreateSection", () =>
    new CreateSection()
        .addComponents(new CreateTextDisplay().setContent("Text"))
        .setAccessory(new CreateThumbnail().setUrl("https://example.com/a.png"))
        .toJSON(),
);
bench("Builders", "CreateMediaGallery (2 items)", () =>
    new CreateMediaGallery().addItems({ url: "https://example.com/a.png" }, { url: "https://example.com/b.png", description: "b" }).toJSON(),
);
bench("Builders", "CreateFileComponent", () => new CreateFileComponent().setUrl("attachment://file.txt").setSpoiler(false).toJSON());
bench("Builders", "CreateContentInventoryEntry", () => new CreateContentInventoryEntry().setId("1").toJSON());
bench("Builders", "CreateContainer (text + separator + row)", () =>
    new CreateContainer()
        .setAccentColor(0x2f4a9e)
        .addComponents(new CreateTextDisplay().setContent("Heading"), new CreateSeparator(), new CreateActionRow().addComponents(button()))
        .toJSON(),
);
bench("Builders", "CreateAttachment (no toJSON; construct + set)", () => new CreateAttachment(new Uint8Array(8), "file.bin").setName("file.bin").setDescription("d"));
bench("Builders", "CreateStringOption", () =>
    new CreateStringOption().setName("text").setDescription("Text").setRequired(true).setMinLength(1).setMaxLength(50).addChoices({ name: "a", value: "a" }).toJSON(),
);
bench("Builders", "CreateIntegerOption", () => new CreateIntegerOption().setName("n").setDescription("N").setMinValue(1).setMaxValue(10).toJSON());
bench("Builders", "CreateNumberOption", () => new CreateNumberOption().setName("x").setDescription("X").setMinValue(0).setMaxValue(1).toJSON());
bench("Builders", "CreateBooleanOption", () => new CreateBooleanOption().setName("b").setDescription("B").toJSON());
bench("Builders", "CreateUserOption", () => new CreateUserOption().setName("user").setDescription("User").toJSON());
bench("Builders", "CreateRoleOption", () => new CreateRoleOption().setName("role").setDescription("Role").toJSON());
bench("Builders", "CreateChannelOption", () => new CreateChannelOption().setName("channel").setDescription("Channel").addChannelTypes(0, 5).toJSON());
bench("Builders", "CreateMentionableOption", () => new CreateMentionableOption().setName("m").setDescription("M").toJSON());
bench("Builders", "CreateAttachmentOption", () => new CreateAttachmentOption().setName("file").setDescription("File").toJSON());
bench("Builders", "CreateSlashCommand (3 options)", () =>
    new CreateSlashCommand()
        .setName("command")
        .setDescription("Description")
        .setDefaultMemberPermissions(8n)
        .addStringOption((o) => o.setName("a").setDescription("A"))
        .addIntegerOption((o) => o.setName("b").setDescription("B"))
        .addUserOption((o) => o.setName("c").setDescription("C"))
        .toJSON(),
);
bench("Builders", "CreateSubcommand", () => new CreateSubcommand().setName("sub").setDescription("Sub").addStringOption((o) => o.setName("a").setDescription("A")).toJSON());
bench("Builders", "CreateSubcommandGroup", () =>
    new CreateSubcommandGroup()
        .setName("group")
        .setDescription("Group")
        .addSubcommand((s) => s.setName("sub").setDescription("Sub"))
        .toJSON(),
);
bench("Builders", "CreateContextMenuCommand", () => new CreateContextMenuCommand(2).setName("Inspect").setDefaultMemberPermissions(8n).toJSON());
bench("Builders", "CreateUserCommand", () => new CreateUserCommand().setName("Profile").toJSON());
bench("Builders", "CreateMessageCommand", () => new CreateMessageCommand().setName("Report").toJSON());

// ── Formatters ─────────────────────────────────────────────────────────────

const id = "200000000000000000";
for (const [name, run] of [
    ["userMention", () => lunibee.userMention(id)],
    ["channelMention", () => lunibee.channelMention(id)],
    ["roleMention", () => lunibee.roleMention(id)],
    ["timestamp", () => lunibee.timestamp(1_700_000_000, "R")],
    ["bold", () => lunibee.bold("text")],
    ["italic", () => lunibee.italic("text")],
    ["underline", () => lunibee.underline("text")],
    ["strikethrough", () => lunibee.strikethrough("text")],
    ["spoiler", () => lunibee.spoiler("text")],
    ["masked", () => lunibee.masked("text", "https://example.com")],
    ["link", () => lunibee.link("https://example.com")],
    ["inlineCode", () => lunibee.inlineCode("code")],
    ["codeBlock", () => lunibee.codeBlock("ts", "const a = 1;")],
    ["blockQuote", () => lunibee.blockQuote("quote")],
    ["heading", () => lunibee.heading("Title", 2)],
    ["subtext", () => lunibee.subtext("small")],
    ["orderedList", () => lunibee.orderedList(["a", "b", "c"])],
    ["bulletList", () => lunibee.bulletList(["a", "b", "c"])],
    ["escapeMarkdown", () => lunibee.escapeMarkdown("*bold* _it_ `code` ~~s~~ ||sp||")],
    ["parseUserMention", () => lunibee.parseUserMention(`<@${id}>`)],
    ["parseRoleMention", () => lunibee.parseRoleMention(`<@&${id}>`)],
    ["parseChannelMention", () => lunibee.parseChannelMention(`<#${id}>`)],
])
    bench("Formatters", name, run);

// ── Gateway events (payload → cache sync → emit) ───────────────────────────

const client = new Client({ token: "a.b", intents: 0 });
const gateway = client.gateway;
const sf = (n) => String(200_000_000_000_000_000n + BigInt(n));
const guildId = sf(1);
const channelId = sf(2);
const user = (n) => ({ id: sf(1_000_000 + n), username: `u${n}`, discriminator: "0", avatar: null, global_name: null });
const member = (n) => ({ user: user(n), roles: [], joined_at: "2020-01-01T00:00:00.000Z", deaf: false, mute: false });
const role = (n) => ({ id: sf(2_000_000 + n), name: `role${n}`, color: 0, hoist: false, position: n, permissions: "0", managed: false, mentionable: false });
const channel = (n, type = 0) => ({ id: sf(3_000_000 + n), type, name: `channel${n}`, guild_id: guildId, position: n, permission_overwrites: [] });
const message = (n) => ({
    id: sf(4_000_000 + n),
    channel_id: channelId,
    guild_id: guildId,
    author: user(n % 500),
    member: { roles: [], joined_at: "2020-01-01T00:00:00.000Z" },
    content: "hello world",
    timestamp: "2020-01-01T00:00:00.000Z",
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    pinned: false,
    type: 0,
});
const emoji = (n) => ({ id: sf(5_000_000 + n), name: `e${n}`, roles: [], require_colons: true, managed: false, animated: false, available: true });
const sticker = (n) => ({ id: sf(6_000_000 + n), name: `s${n}`, tags: "tag", type: 2, format_type: 1, guild_id: guildId });
const scheduled = (n) => ({ id: sf(7_000_000 + n), guild_id: guildId, name: "event", scheduled_start_time: "2030-01-01T00:00:00.000Z", privacy_level: 2, status: 1, entity_type: 2, channel_id: channelId });
const rule = (n) => ({ id: sf(8_000_000 + n), guild_id: guildId, name: "rule", creator_id: sf(9), event_type: 1, trigger_type: 1, trigger_metadata: {}, actions: [], enabled: true, exempt_roles: [], exempt_channels: [] });
const sound = (n) => ({ sound_id: sf(9_000_000 + n), guild_id: guildId, name: "sound", volume: 1, emoji_id: null, emoji_name: null, available: true });
const entitlement = (n) => ({ id: sf(10_000_000 + n), sku_id: sf(10), application_id: sf(11), user_id: sf(12), type: 8, deleted: false, consumed: false });
const thread = (n) => ({ ...channel(11_000_000 + n, 11), parent_id: channelId, owner_id: sf(13), thread_metadata: { archived: false, auto_archive_duration: 60, archive_timestamp: "2020-01-01T00:00:00.000Z", locked: false } });
const stage = (n) => ({ id: sf(12_000_000 + n), guild_id: guildId, channel_id: sf(12_500_000 + n), topic: "topic", privacy_level: 2 });
const reaction = (n) => ({ user_id: sf(1_000_000 + (n % 500)), channel_id: channelId, message_id: sf(4_000_000), guild_id: guildId, emoji: { id: null, name: "👍" } });

gateway.emit("READY", { v: 10, user: { ...user(0), bot: true }, guilds: [], session_id: "s", resume_gateway_url: "wss://example", application: { id: sf(0) } });
gateway.emit("GUILD_CREATE", { id: guildId, name: "bench", owner_id: sf(9), roles: [role(0)], channels: [channel(0)], members: [member(0)] });
gateway.emit("CHANNEL_CREATE", { ...channel(0), id: channelId });

const events = [
    ["READY", () => ({ v: 10, user: { ...user(0), bot: true }, guilds: [], session_id: "s", resume_gateway_url: "wss://example", application: { id: sf(0) } })],
    ["RESUMED", () => ({})],
    ["GUILD_CREATE (50 members, 20 roles, 10 channels)", (i) => ({
        id: sf(20_000_000 + i),
        name: "g",
        owner_id: sf(9),
        roles: Array.from({ length: 20 }, (_, r) => role(r)),
        members: Array.from({ length: 50 }, (_, m) => member(m)),
        channels: Array.from({ length: 10 }, (_, c) => ({ ...channel(c), guild_id: undefined })),
        emojis: [emoji(0), emoji(1)],
    })],
    ["GUILD_UPDATE", () => ({ id: guildId, name: "renamed", owner_id: sf(9) })],
    ["GUILD_DELETE", (i) => ({ id: sf(20_000_000 + i) })],
    ["GUILD_MEMBER_ADD", (i) => ({ ...member(i % 5_000), guild_id: guildId })],
    ["GUILD_MEMBER_UPDATE", (i) => ({ ...member(i % 5_000), guild_id: guildId })],
    ["GUILD_MEMBER_REMOVE", (i) => ({ guild_id: guildId, user: user(i % 5_000) })],
    ["GUILD_MEMBERS_CHUNK (10 members)", (i) => ({ guild_id: guildId, members: Array.from({ length: 10 }, (_, m) => member((i * 10 + m) % 5_000)), chunk_index: 0, chunk_count: 1 })],
    ["GUILD_BAN_ADD", (i) => ({ guild_id: guildId, user: user(i % 500) })],
    ["GUILD_BAN_REMOVE", (i) => ({ guild_id: guildId, user: user(i % 500) })],
    ["GUILD_ROLE_CREATE", (i) => ({ guild_id: guildId, role: role(i % 250) })],
    ["GUILD_ROLE_UPDATE", (i) => ({ guild_id: guildId, role: role(i % 250) })],
    ["GUILD_ROLE_DELETE", (i) => ({ guild_id: guildId, role_id: role(i % 250).id })],
    ["GUILD_EMOJIS_UPDATE (10 emojis)", () => ({ guild_id: guildId, emojis: Array.from({ length: 10 }, (_, e) => emoji(e)) })],
    ["GUILD_STICKERS_UPDATE (5 stickers)", () => ({ guild_id: guildId, stickers: Array.from({ length: 5 }, (_, s) => sticker(s)) })],
    ["GUILD_INTEGRATIONS_UPDATE", () => ({ guild_id: guildId })],
    ["GUILD_SCHEDULED_EVENT_CREATE", (i) => scheduled(i % 100)],
    ["GUILD_SCHEDULED_EVENT_UPDATE", (i) => scheduled(i % 100)],
    ["GUILD_SCHEDULED_EVENT_DELETE", (i) => scheduled(i % 100)],
    ["GUILD_SCHEDULED_EVENT_USER_ADD", (i) => ({ guild_scheduled_event_id: sf(7_000_000), user_id: user(i % 500).id, guild_id: guildId })],
    ["GUILD_SCHEDULED_EVENT_USER_REMOVE", (i) => ({ guild_scheduled_event_id: sf(7_000_000), user_id: user(i % 500).id, guild_id: guildId })],
    ["GUILD_SOUNDBOARD_SOUND_CREATE", (i) => sound(i % 100)],
    ["GUILD_SOUNDBOARD_SOUND_UPDATE", (i) => sound(i % 100)],
    ["GUILD_SOUNDBOARD_SOUND_DELETE", (i) => ({ sound_id: sound(i % 100).sound_id, guild_id: guildId })],
    ["GUILD_SOUNDBOARD_SOUNDS_UPDATE (5 sounds)", () => ({ guild_id: guildId, soundboard_sounds: Array.from({ length: 5 }, (_, s) => sound(s)) })],
    ["CHANNEL_CREATE", (i) => channel(i % 500)],
    ["CHANNEL_UPDATE", (i) => channel(i % 500)],
    ["CHANNEL_DELETE", (i) => channel(i % 500)],
    ["CHANNEL_PINS_UPDATE", () => ({ guild_id: guildId, channel_id: channelId, last_pin_timestamp: "2020-01-01T00:00:00.000Z" })],
    ["THREAD_CREATE", (i) => thread(i % 500)],
    ["THREAD_UPDATE", (i) => thread(i % 500)],
    ["THREAD_DELETE", (i) => ({ id: thread(i % 500).id, guild_id: guildId, parent_id: channelId, type: 11 })],
    ["THREAD_LIST_SYNC (5 threads)", () => ({ guild_id: guildId, threads: Array.from({ length: 5 }, (_, t) => thread(t)), members: [] })],
    ["THREAD_MEMBERS_UPDATE", () => ({ id: thread(0).id, guild_id: guildId, member_count: 2, added_members: [], removed_member_ids: [] })],
    ["THREAD_MEMBER_UPDATE", () => ({ id: thread(0).id, user_id: user(0).id, join_timestamp: "2020-01-01T00:00:00.000Z", flags: 0, guild_id: guildId })],
    ["MESSAGE_CREATE", (i) => message(i)],
    ["MESSAGE_UPDATE", (i) => ({ ...message(i), content: "edited", edited_timestamp: "2020-01-01T00:00:01.000Z" })],
    ["MESSAGE_DELETE", (i) => ({ id: message(i).id, channel_id: channelId, guild_id: guildId })],
    ["MESSAGE_DELETE_BULK (10 ids)", (i) => ({ ids: Array.from({ length: 10 }, (_, m) => message(i * 10 + m).id), channel_id: channelId, guild_id: guildId })],
    ["MESSAGE_REACTION_ADD", (i) => reaction(i)],
    ["MESSAGE_REACTION_REMOVE", (i) => reaction(i)],
    ["MESSAGE_REACTION_REMOVE_ALL", () => ({ channel_id: channelId, message_id: sf(4_000_000), guild_id: guildId })],
    ["MESSAGE_REACTION_REMOVE_EMOJI", () => ({ channel_id: channelId, message_id: sf(4_000_000), guild_id: guildId, emoji: { id: null, name: "👍" } })],
    ["MESSAGE_POLL_VOTE_ADD", (i) => ({ user_id: user(i % 500).id, channel_id: channelId, message_id: sf(4_000_000), guild_id: guildId, answer_id: 1 })],
    ["MESSAGE_POLL_VOTE_REMOVE", (i) => ({ user_id: user(i % 500).id, channel_id: channelId, message_id: sf(4_000_000), guild_id: guildId, answer_id: 1 })],
    ["STAGE_INSTANCE_CREATE", (i) => stage(i % 100)],
    ["STAGE_INSTANCE_UPDATE", (i) => stage(i % 100)],
    ["STAGE_INSTANCE_DELETE", (i) => stage(i % 100)],
    ["INVITE_CREATE", (i) => ({ channel_id: channelId, code: `code${i % 500}`, created_at: "2020-01-01T00:00:00.000Z", guild_id: guildId, max_age: 0, max_uses: 0, temporary: false, uses: 0 })],
    ["INVITE_DELETE", (i) => ({ channel_id: channelId, guild_id: guildId, code: `code${i % 500}` })],
    ["WEBHOOKS_UPDATE", () => ({ guild_id: guildId, channel_id: channelId })],
    ["VOICE_STATE_UPDATE", (i) => ({ guild_id: guildId, channel_id: channelId, user_id: user(i % 500).id, session_id: "s", deaf: false, mute: false, self_deaf: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null })],
    ["VOICE_SERVER_UPDATE", () => ({ token: "t", guild_id: guildId, endpoint: "voice.example" })],
    ["PRESENCE_UPDATE", (i) => ({ user: { id: user(i % 500).id }, guild_id: guildId, status: "online", activities: [], client_status: { desktop: "online" } })],
    ["TYPING_START", (i) => ({ channel_id: channelId, guild_id: guildId, user_id: user(i % 500).id, timestamp: 1_700_000_000 })],
    ["AUTO_MODERATION_RULE_CREATE", (i) => rule(i % 100)],
    ["AUTO_MODERATION_RULE_UPDATE", (i) => rule(i % 100)],
    ["AUTO_MODERATION_RULE_DELETE", (i) => rule(i % 100)],
    ["AUTO_MODERATION_ACTION_EXECUTION", () => ({ guild_id: guildId, action: { type: 1 }, rule_id: sf(8_000_000), rule_trigger_type: 1, user_id: user(0).id, content: "bad" })],
    ["ENTITLEMENT_CREATE", (i) => entitlement(i % 100)],
    ["ENTITLEMENT_UPDATE", (i) => entitlement(i % 100)],
    ["ENTITLEMENT_DELETE", (i) => entitlement(i % 100)],
    ["INTERACTION_CREATE (button)", (i) => ({
        id: sf(13_000_000 + i),
        application_id: sf(0),
        type: 3,
        token: "token",
        version: 1,
        guild_id: guildId,
        channel_id: channelId,
        member: { ...member(i % 500), permissions: "8" },
        message: message(i),
        data: { custom_id: "button", component_type: 2 },
        locale: "en-US",
        app_permissions: "8",
        entitlements: [],
    })],
];

for (const [event, payload] of events) {
    const name = event.split(" ")[0];
    bench("Gateway events", event, (i) => gateway.emit(name, payload(i)));
}

// ── Output ─────────────────────────────────────────────────────────────────

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.versions.node}`;
if (JSON_OUTPUT) {
    console.log(JSON.stringify({ runtime, iterations: ITERATIONS, results }));
} else {
    console.log(`${runtime} — ${ITERATIONS} iterations per function`);
    let group = "";
    for (const result of results) {
        if (result.group !== group) console.log(`\n${(group = result.group)}`);
        console.log(`  ${result.name.padEnd(52)} ${result.ns === null ? `ERROR ${result.error}` : `${result.ns.toFixed(1)} ns`}`);
    }
}
