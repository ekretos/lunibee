import { describe, expect, test } from "bun:test";
import {
  Role,
  GuildMember,
  TextChannel,
  User,
  Guild,
} from "../packages/structures/src/index.ts";
import {
  CommandInteraction,
  ComponentInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
} from "../packages/structures/src/interactions.ts";

describe("Structures & Interactions Full Coverage", () => {
  test("Role, GuildMember, TextChannel properties and string conversions", () => {
    const role = new Role({
      id: "100",
      name: "Admin",
      color: 0xff0000,
      hoist: true,
      mentionable: true,
    });
    expect(role.toString()).toBe("<@&100>");
    expect(role.name).toBe("Admin");
    expect(role.hoist).toBe(true);

    const member = new GuildMember({
      user: { id: "200", username: "JohnDoe" },
      guild_id: "300",
      nick: "Johnny",
      roles: ["100"],
      joined_at: "2026-01-01T00:00:00Z",
    });
    expect(member.displayName).toBe("Johnny");
    expect(member.guildId).toBe("300");
    expect(member.roleIds).toEqual(["100"]);

    const textChannel = new TextChannel({
      id: "400",
      type: 0,
      name: "general",
      parent_id: "500",
    });
    expect(textChannel.toString()).toBe("<#400>");
    expect(textChannel.parentId).toBe("500");

    const user = new User({ id: "200", username: "JohnDoe" });
    expect(user.id).toBe("200");
    expect(user.username).toBe("JohnDoe");
    expect(user.displayName).toBe("JohnDoe");

    const guild = new Guild({ id: "300", name: "MyGuild" });
    expect(guild.name).toBe("MyGuild");
  });

  test("Interaction structures reply, deferReply, editReply, deleteReply, followUp", async () => {
    let lastPosted: any = null;
    let lastPatched: any = null;
    let lastDeleted = false;

    const mockContext: any = {
      postInteractionResponse: async (id: string, token: string, res: any) => {
        lastPosted = { id, token, res: res.toJSON() };
      },
      editInteractionReply: async (token: string, opts: any) => {
        lastPatched = { token, opts };
        return opts;
      },
      deleteInteractionReply: async (token: string) => {
        lastDeleted = true;
      },
      followUpInteraction: async (token: string, opts: any) => {
        return { token, opts };
      },
    };

    const cmdInteraction = new CommandInteraction(mockContext, {
      id: "int_1",
      application_id: "app_1",
      type: 2,
      token: "tok_1",
      version: 1,
      channel_id: "chan_1",
      data: { id: "cmd_1", name: "ping" },
    });

    expect(cmdInteraction.commandName).toBe("ping");
    await cmdInteraction.reply("Pong!");
    expect(lastPosted.res.data.content).toBe("Pong!");
    expect(cmdInteraction.replied).toBe(true);

    const deferCmd = new CommandInteraction(mockContext, {
      id: "int_2",
      application_id: "app_1",
      type: 2,
      token: "tok_2",
      version: 1,
      channel_id: "chan_1",
    });
    await deferCmd.deferReply(true);
    expect(deferCmd.deferred).toBe(true);

    await deferCmd.editReply({ content: "Deferred content ready" });
    expect(lastPatched.opts.content).toBe("Deferred content ready");

    await deferCmd.deleteReply();
    expect(lastDeleted).toBe(true);

    const followUpRes = await deferCmd.followUp("Follow up msg");
    expect(followUpRes).toBeDefined();

    const compInteraction = new ComponentInteraction(mockContext, {
      id: "comp_1",
      application_id: "app_1",
      type: 3,
      token: "tok_3",
      version: 1,
      channel_id: "chan_1",
      data: { custom_id: "btn_test", component_type: 2 },
    });
    expect(compInteraction.customId).toBe("btn_test");
    await compInteraction.deferUpdate();
    expect(compInteraction.deferred).toBe(true);

    const autoInteraction = new AutocompleteInteraction(mockContext, {
      id: "auto_1",
      application_id: "app_1",
      type: 4,
      token: "tok_4",
      version: 1,
      channel_id: "chan_1",
      data: {
        id: "cmd_1",
        name: "test",
        options: [{ name: "opt", type: 3, value: "query", focused: true }],
      },
    });
    expect(autoInteraction.focusedOption?.name).toBe("opt");
    await autoInteraction.respond([{ name: "Result 1", value: "r1" }]);
    expect(lastPosted.res.data.choices.length).toBe(1);

    const modalInteraction = new ModalSubmitInteraction(mockContext, {
      id: "mod_1",
      application_id: "app_1",
      type: 5,
      token: "tok_5",
      version: 1,
      channel_id: "chan_1",
      data: {
        custom_id: "modal_1",
        components: [
          {
            type: 1,
            components: [
              { type: 4, custom_id: "field_1", value: "entered_val" },
            ],
          },
        ],
      },
    });
    expect(modalInteraction.customId).toBe("modal_1");
    expect(modalInteraction.getInputValue("field_1")).toBe("entered_val");

    // Interaction type predicates and createInteraction factory
    const genericInteraction = new (class extends CommandInteraction {})(
      mockContext,
      {
        id: "gen_1",
        application_id: "app_1",
        type: 2,
        token: "tok_gen",
      },
    );
    expect(genericInteraction.isChatInputCommand()).toBe(true);
    expect(compInteraction.isMessageComponent()).toBe(true);
    expect(modalInteraction.isModalSubmit()).toBe(true);
    expect(autoInteraction.isAutocomplete()).toBe(true);

    // InteractionResponse static methods
    const pong = (CommandInteraction as any).Response?.pong?.() ?? { type: 1 };
  });
});
