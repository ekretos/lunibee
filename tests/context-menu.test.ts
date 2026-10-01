import { describe, expect, test } from "bun:test";
import {
    CommandInteraction,
    ContextMenuCommandInteraction,
    createInteraction,
    GuildMember,
    Message,
    User,
    type InteractionClient,
} from "../packages/structures/src/index.ts";
import {
    CreateContextMenuCommand,
    CreateMessageCommand,
    CreateUserCommand,
    CreateSlashCommand,
} from "../packages/builders/src/index.ts";

const client: InteractionClient = {
    postInteractionResponse: async () => undefined,
    editInteractionReply: async () => undefined,
    deleteInteractionReply: async () => undefined,
    followUpInteraction: async () => undefined,
};

const USER_ID = "200000000000000001";
const MESSAGE_ID = "200000000000000002";
const CHANNEL_ID = "200000000000000003";
const GUILD_ID = "200000000000000004";

const command = (
    data: Record<string, unknown>,
    extra: Record<string, unknown> = {},
) =>
    createInteraction(client, {
        id: "1",
        application_id: "app",
        token: "tok",
        type: 2,
        data,
        ...extra,
    });

describe("context-menu commands", () => {
    test("guards follow the command's own type", () => {
        const slash = command({ name: "ping", type: 1 });
        const slashWithoutType = command({ name: "ping" });
        const user = command({ name: "Profile", type: 2, target_id: USER_ID });
        const message = command({
            name: "Report",
            type: 3,
            target_id: MESSAGE_ID,
        });

        expect(slash.isChatInputCommand()).toBe(true);
        expect(slashWithoutType.isChatInputCommand()).toBe(true);
        expect(slash.isContextMenuCommand()).toBe(false);

        expect(user.isChatInputCommand()).toBe(false);
        expect(user.isContextMenuCommand()).toBe(true);
        expect(user.isUserContextMenuCommand()).toBe(true);
        expect(user.isMessageContextMenuCommand()).toBe(false);

        expect(message.isContextMenuCommand()).toBe(true);
        expect(message.isMessageContextMenuCommand()).toBe(true);
        expect(message.isUserContextMenuCommand()).toBe(false);

        for (const interaction of [slash, user, message])
            expect(interaction.isCommand()).toBe(true);
        const component = createInteraction(client, {
            id: "2",
            application_id: "app",
            token: "tok",
            type: 3,
            data: { custom_id: "x" },
        });
        expect(component.isCommand()).toBe(false);
        expect(component.isContextMenuCommand()).toBe(false);
    });

    test("createInteraction builds the context-menu class, still a CommandInteraction", () => {
        const user = command({ name: "Profile", type: 2, target_id: USER_ID });
        expect(user).toBeInstanceOf(ContextMenuCommandInteraction);
        expect(user).toBeInstanceOf(CommandInteraction);
        expect(command({ name: "ping" })).not.toBeInstanceOf(
            ContextMenuCommandInteraction,
        );
    });

    test("user command targets: user and member", () => {
        const interaction = command(
            {
                name: "Profile",
                type: 2,
                target_id: USER_ID,
                resolved: {
                    users: { [USER_ID]: { id: USER_ID, username: "target" } },
                    members: {
                        [USER_ID]: {
                            roles: ["1"],
                            joined_at: "2020-01-01T00:00:00.000Z",
                            nick: "T",
                        },
                    },
                },
            },
            { guild_id: GUILD_ID },
        ) as ContextMenuCommandInteraction;

        expect(interaction.targetId).toBe(USER_ID);
        expect(interaction.targetUser).toBeInstanceOf(User);
        expect(interaction.targetUser?.username).toBe("target");
        const member = interaction.targetMember;
        expect(member).toBeInstanceOf(GuildMember);
        expect(member?.guildId).toBe(GUILD_ID);
        expect(member?.nickname).toBe("T");
        expect(member?.user.id).toBe(USER_ID);
        expect(interaction.targetMessage).toBeNull();
    });

    test("message command target: message", () => {
        const interaction = command({
            name: "Report",
            type: 3,
            target_id: MESSAGE_ID,
            resolved: {
                messages: {
                    [MESSAGE_ID]: {
                        id: MESSAGE_ID,
                        channel_id: CHANNEL_ID,
                        author: { id: USER_ID, username: "author" },
                        content: "hello",
                    },
                },
            },
        }) as ContextMenuCommandInteraction;

        expect(interaction.targetMessage).toBeInstanceOf(Message);
        expect(interaction.targetMessage?.content).toBe("hello");
        expect(interaction.targetUser).toBeNull();
        expect(interaction.targetMember).toBeNull();
    });

    test("targets are null without resolved data or outside a guild", () => {
        const bare = command({
            name: "Profile",
            type: 2,
        }) as ContextMenuCommandInteraction;
        expect(bare.targetId).toBeNull();
        expect(bare.targetUser).toBeNull();
        expect(bare.targetMember).toBeNull();
        expect(bare.targetMessage).toBeNull();

        const dm = command({
            name: "Profile",
            type: 2,
            target_id: USER_ID,
            resolved: {
                users: { [USER_ID]: { id: USER_ID, username: "t" } },
                members: { [USER_ID]: { roles: [] } },
            },
        }) as ContextMenuCommandInteraction;
        expect(dm.targetUser?.id).toBe(USER_ID);
        expect(dm.targetMember).toBeNull();
    });
});

describe("context-menu builders", () => {
    test("user and message commands serialize with contexts, integration types and localizations", () => {
        expect(
            new CreateUserCommand()
                .setName("View Profile")
                .setContexts(0, 1)
                .setIntegrationTypes(0, 1)
                .toJSON(),
        ).toEqual({
            type: 2,
            name: "View Profile",
            contexts: [0, 1],
            integration_types: [0, 1],
        });
        expect(
            new CreateMessageCommand()
                .setName("Report")
                .setNameLocalizations({ "es-ES": "Reportar" })
                .setDefaultMemberPermissions(8n)
                .toJSON(),
        ).toEqual({
            type: 3,
            name: "Report",
            name_localizations: { "es-ES": "Reportar" },
            default_member_permissions: "8",
        });
        expect(
            new CreateContextMenuCommand(2).setNameLocalizations(null).toJSON(),
        ).toEqual({ type: 2, name_localizations: null });
    });

    test("invalid contexts are refused", () => {
        expect(() => new CreateUserCommand().setContexts(3)).toThrow(
            RangeError,
        );
    });
    test("slash commands set contexts like context-menu commands", () => {
        const json = new CreateSlashCommand()
            .setName("ping")
            .setDescription("Ping")
            .setContexts(0, 1, 2)
            .toJSON();
        expect(json.contexts).toEqual([0, 1, 2]);
        expect(() => new CreateSlashCommand().setContexts(3)).toThrow(
            RangeError,
        );
    });
});
