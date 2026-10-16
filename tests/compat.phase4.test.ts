import { describe, expect, test } from "bun:test";
import {
    Events,
    ClientEvent,
    CachedManager,
    ResourceManager,
    ShardingManager,
    ShardManager,
    CreateStringSelectMenu,
    CreateStringSelect,
    CreateUserSelectMenu,
    CreateRoleSelectMenu,
    CreateMentionableSelectMenu,
    CreateChannelSelectMenu,
    CreateContextMenuCommand,
    createInteraction,
    VoiceConnectionStatus,
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    entersState,
    AudioPlayer,
    AudioResource,
    VoiceError,
    type AutocompleteInteraction,
} from "../packages/lunibee/src/index.ts";

describe("discord.js-familiar aliases", () => {
    test("top-level aliases point at the canonical exports", () => {
        expect(Events).toBe(ClientEvent);
        expect(Events.MessageCreate).toBe(ClientEvent.MessageCreate);
        expect(CachedManager).toBe(ResourceManager);
        expect(ShardingManager).toBe(ShardManager);
        expect(CreateStringSelectMenu).toBe(CreateStringSelect);
    });

    test("entity select menu builders fix their component type", () => {
        const types = [
            new CreateUserSelectMenu(),
            new CreateRoleSelectMenu(),
            new CreateMentionableSelectMenu(),
            new CreateChannelSelectMenu(),
        ].map((b) => (b.setCustomId("id").toJSON() as { type: number }).type);
        expect(types).toEqual([5, 6, 7, 8]);
    });

    test("CreateContextMenuCommand supports setType", () => {
        const json = new CreateContextMenuCommand()
            .setName("Quote")
            .setType(3)
            .toJSON();
        expect(json).toEqual({ type: 3, name: "Quote" });
        expect(new CreateContextMenuCommand().toJSON().type).toBe(2);
        expect(() =>
            new CreateContextMenuCommand().setType(1 as never),
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
    const adapter = () => {
        const sent: unknown[] = [];
        return {
            sent,
            adapterCreator: () => ({
                sendPayload: (payload: unknown) => {
                    sent.push(payload);
                    return true;
                },
                destroy: () => undefined,
            }),
        };
    };

    test("joinVoiceChannel tracks one connection per guild", () => {
        const { sent, adapterCreator } = adapter();
        const first = joinVoiceChannel({
            guildId: "1",
            channelId: "10",
            adapterCreator,
        });
        expect(first.status).toBe(VoiceConnectionStatus.Signalling);
        expect(getVoiceConnection("1")).toBe(first);
        const moved = joinVoiceChannel({
            guildId: "1",
            channelId: "11",
            selfDeaf: true,
            adapterCreator,
        });
        expect(moved).toBe(first);
        expect([moved.channelId, moved.selfDeaf]).toEqual(["11", true]);
        expect(sent.length).toBe(2);
        first.destroy();
        expect(getVoiceConnection("1")).toBeUndefined();
        const fresh = joinVoiceChannel({
            guildId: "1",
            channelId: "10",
            adapterCreator,
        });
        expect(fresh).not.toBe(first);
        fresh.destroy();
        expect(() =>
            joinVoiceChannel({ guildId: "2", channelId: "", adapterCreator }),
        ).toThrow(TypeError);
    });

    test("factories build the canonical classes", () => {
        expect(createAudioPlayer()).toBeInstanceOf(AudioPlayer);
        const resource = createAudioResource(new ReadableStream(), {
            inputType: "opus",
            metadata: { title: "t" },
        });
        expect(resource).toBeInstanceOf(AudioResource);
        expect(resource.metadata.title).toBe("t");
        resource.destroy();
    });

    test("entersState resolves on transition and rejects on timeout", async () => {
        const connection = joinVoiceChannel({
            guildId: "3",
            channelId: "1",
            ...adapter(),
        });
        const pending = entersState(
            connection,
            VoiceConnectionStatus.Disconnected,
            100,
        );
        connection.disconnect();
        expect(await pending).toBe(connection);
        await expect(
            entersState(connection, VoiceConnectionStatus.Ready, 5),
        ).rejects.toBeInstanceOf(VoiceError);
        connection.destroy();

        const player = createAudioPlayer();
        const buffering = entersState(player, "buffering", 100);
        player.play(
            createAudioResource(new ReadableStream(), { inputType: "opus" }),
        );
        expect(await buffering).toBe(player);
        player.stop(true);
    });
});
