import { describe, expect, test } from "bun:test";
import {
    Events,
    ClientEvent,
    CachedManager,
    ResourceManager,
    ShardingManager,
    ShardManager,
    StringSelectMenuBuilder,
    StringSelectBuilder,
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    MentionableSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ContextMenuCommandBuilder,
    createInteraction,
    VoiceConnectionStatus,
    VoiceConnectionState,
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    entersState,
    AudioPlayer,
    AudioStream,
    VoiceError,
    type AutocompleteInteraction,
} from "../packages/lunibee/src/index.ts";

describe("discord.js-familiar aliases", () => {
    test("top-level aliases point at the canonical exports", () => {
        expect(Events).toBe(ClientEvent);
        expect(Events.MessageCreate).toBe(ClientEvent.MessageCreate);
        expect(CachedManager).toBe(ResourceManager);
        expect(ShardingManager).toBe(ShardManager);
        expect(StringSelectMenuBuilder).toBe(StringSelectBuilder);
        expect(VoiceConnectionStatus).toBe(VoiceConnectionState);
    });

    test("entity select menu builders fix their component type", () => {
        const types = [
            new UserSelectMenuBuilder(),
            new RoleSelectMenuBuilder(),
            new MentionableSelectMenuBuilder(),
            new ChannelSelectMenuBuilder(),
        ].map((b) => (b.setCustomId("id").toJSON() as { type: number }).type);
        expect(types).toEqual([5, 6, 7, 8]);
    });

    test("ContextMenuCommandBuilder supports setType", () => {
        const json = new ContextMenuCommandBuilder()
            .setName("Quote")
            .setType(3)
            .toJSON();
        expect(json).toEqual({ type: 3, name: "Quote" });
        expect(new ContextMenuCommandBuilder().toJSON().type).toBe(2);
        expect(() =>
            new ContextMenuCommandBuilder().setType(1 as never),
        ).toThrow(RangeError);
    });
});

describe("interaction guards and getFocused", () => {
    const client = {} as never;
    const component = (componentType: number) =>
        createInteraction(client, {
            id: "1",
            application_id: "2",
            token: "t",
            type: 3,
            data: { custom_id: "c", component_type: componentType },
        } as never);

    test("component type guards", () => {
        const guards = [
            "isButton",
            "isStringSelectMenu",
            "isUserSelectMenu",
            "isRoleSelectMenu",
            "isMentionableSelectMenu",
            "isChannelSelectMenu",
        ] as const;
        const types = [2, 3, 5, 6, 7, 8];
        types.forEach((type, i) => {
            const interaction = component(type);
            for (const [j, guard] of guards.entries())
                expect(interaction[guard]()).toBe(i === j);
            expect(interaction.isAnySelectMenu()).toBe(type !== 2);
        });
        const command = createInteraction(client, {
            id: "1",
            application_id: "2",
            token: "t",
            type: 2,
            data: { name: "x", component_type: 2 },
        } as never);
        expect(command.isButton()).toBe(false);
        expect(command.isAnySelectMenu()).toBe(false);
    });

    test("AutocompleteInteraction.options.getFocused", () => {
        const interaction = createInteraction(client, {
            id: "1",
            application_id: "2",
            token: "t",
            type: 4,
            data: {
                name: "cmd",
                options: [
                    {
                        name: "sub",
                        type: 1,
                        options: [
                            { name: "a", type: 3, value: "x" },
                            { name: "b", type: 3, value: "pa", focused: true },
                        ],
                    },
                ],
            },
        } as never) as AutocompleteInteraction;
        expect(interaction.options.getFocused()).toBe("pa");
        expect(interaction.options.getFocused(true)).toMatchObject({
            name: "b",
            focused: true,
        });
        expect(interaction.options.getSubcommand()).toBe("sub");
        const none = createInteraction(client, {
            id: "1",
            application_id: "2",
            token: "t",
            type: 4,
            data: { name: "cmd", options: [] },
        } as never) as AutocompleteInteraction;
        expect(() => none.options.getFocused()).toThrow(TypeError);
    });
});

describe("@discordjs/voice-style helpers", () => {
    test("joinVoiceChannel tracks one connection per guild", () => {
        const first = joinVoiceChannel({ guildId: "1", channelId: "10" });
        expect(first.state).toBe(VoiceConnectionState.Connected);
        expect(getVoiceConnection("1")).toBe(first);
        const moved = joinVoiceChannel({
            guildId: "1",
            channelId: "11",
            selfDeaf: true,
        });
        expect(moved).toBe(first);
        expect([moved.channelId, moved.selfDeaf]).toEqual(["11", true]);
        first.destroy();
        expect(getVoiceConnection("1")).toBeUndefined();
        const fresh = joinVoiceChannel({ guildId: "1", channelId: "10" });
        expect(fresh).not.toBe(first);
        fresh.destroy();
        expect(() => joinVoiceChannel({ guildId: "2", channelId: "" })).toThrow(
            TypeError,
        );
    });

    test("factories build the canonical classes", () => {
        expect(createAudioPlayer()).toBeInstanceOf(AudioPlayer);
        const resource = createAudioResource(new ReadableStream(), {
            title: "t",
        });
        expect(resource).toBeInstanceOf(AudioStream);
        expect(resource.title).toBe("t");
    });

    test("entersState resolves on transition and rejects on timeout", async () => {
        const connection = joinVoiceChannel({ guildId: "3", channelId: "1" });
        expect(
            await entersState(connection, VoiceConnectionState.Connected, 10),
        ).toBe(connection);
        const pending = entersState(
            connection,
            VoiceConnectionState.Disconnected,
            100,
        );
        connection.disconnect();
        expect(await pending).toBe(connection);
        await expect(
            entersState(connection, VoiceConnectionState.Connected, 5),
        ).rejects.toBeInstanceOf(VoiceError);
        connection.destroy();

        const player = createAudioPlayer();
        const playing = entersState(player, "playing", 100);
        await player.play(createAudioResource(new ReadableStream()));
        expect(await playing).toBe(player);
        await player.stop();
    });
});
