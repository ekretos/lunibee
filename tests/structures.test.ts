import { describe, expect, test } from "bun:test";
import {
  Role,
  GuildMember,
  TextChannel,
  User,
  Guild,
  Embed,
} from "../packages/structures/src/index.ts";
import {
  CommandInteraction,
  ComponentInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
} from "../packages/structures/src/interactions.ts";

describe("Structures & Interactions Full Coverage", () => {
  test("Role, GuildMember, TextChannel properties and string conversions", async () => {
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
    expect(member.toString()).toBe("<@200>");

    const memberNoNick = new GuildMember({
      user: { id: "200", username: "JohnDoe", global_name: "John" },
      guild_id: "300",
    });
    expect(memberNoNick.displayName).toBe("John");

    expect(
      () =>
        new GuildMember({
          user: { id: "200", username: "JohnDoe" },
          guild_id: "300",
          joined_at: "invalid date",
        }),
    ).toThrow(RangeError);

    expect(() => new Role({ id: "100", name: "" })).toThrow(TypeError);

    const textChannel = new TextChannel({
      id: "400",
      type: 0,
      name: "general",
      parent_id: "500",
    });
    expect(textChannel.toString()).toBe("<#400>");
    expect(textChannel.parentId).toBe("500");

    const user = new User({
      id: "200",
      username: "JohnDoe",
      avatar: "a_123",
      public_flags: 2,
    });
    expect(user.id).toBe("200");
    expect(user.username).toBe("JohnDoe");
    expect(user.displayName).toBe("JohnDoe");
    expect(user.toString()).toBe("<@200>");
    expect(user.flags).toBe(2);
    expect(user.avatarURL()).toBe(
      "https://cdn.discordapp.com/avatars/200/a_123.gif",
    );
    expect(user.displayAvatarURL({ size: 1024, forceStatic: true })).toBe(
      "https://cdn.discordapp.com/avatars/200/a_123.png?size=1024",
    );
    expect(new User({ id: "100", username: "U" }).avatarURL()).toBeNull();
    expect(new User({ id: "100", username: "U" }).displayAvatarURL()).toBe(
      "https://cdn.discordapp.com/embed/avatars/0.png",
    );

    const guild = new Guild({
      id: "300",
      name: "MyGuild",
      icon: "icon1",
      splash: "splash1",
      banner: "banner1",
      description: "desc",
      preferred_locale: "en-US",
      owner_id: "100",
      features: ["VIP"],
      verification_level: 1,
      premium_tier: 1,
      premium_subscription_count: 5,
      member_count: 10,
      vanity_url_code: "vanity",
      nsfw_level: 1,
    });
    expect(guild.name).toBe("MyGuild");
    expect(guild.createdAt.getFullYear()).toBeDefined();
    expect(guild.iconURL({ size: 1024, forceStatic: true })).toBe(
      "https://cdn.discordapp.com/icons/300/icon1.png?size=1024",
    );
    expect(guild.splashURL()).toBe(
      "https://cdn.discordapp.com/splashes/300/splash1.png",
    );
    expect(guild.bannerURL()).toBe(
      "https://cdn.discordapp.com/banners/300/banner1.png",
    );
    expect(guild.discoverySplashURL("dsplash")).toBe(
      "https://cdn.discordapp.com/discovery-splashes/300/dsplash.png",
    );

    expect(guild.hasFeature("VIP")).toBe(true);
    expect(guild.isCommunity).toBe(false);
    expect(guild.hasVanityUrl).toBe(true);
    expect(guild.vanityURL).toBe("https://discord.gg/vanity");
    expect(guild.toString()).toBe("MyGuild");

    const noImageGuild = new Guild({ id: "300", name: "G" });
    expect(noImageGuild.hasVanityUrl).toBe(false);
    expect(noImageGuild.vanityURL).toBeNull();
    expect(noImageGuild.iconURL()).toBeNull();
    expect(noImageGuild.splashURL()).toBeNull();
    expect(noImageGuild.bannerURL()).toBeNull();
    expect(noImageGuild.discoverySplashURL(null)).toBeNull();

    // Base checks
    expect(() => new User({ id: "invalid", username: "u" })).toThrow(TypeError);
    expect(() => new User({ id: "200", username: "" })).toThrow(TypeError);
    expect(() => new TextChannel({ id: "100" } as any)).toThrow(RangeError);

    // Channel alias methods
    const mockCtx = {
      editChannel: async (id: string, opts: any) =>
        new TextChannel({ id, type: 0, ...opts }),
      sendMessage: async (id: string, opts: any) => ({ content: opts.content }),
    };
    const c = new TextChannel({ id: "100", type: 0 }, mockCtx as any);
    expect(() => c.editName("   ")).toThrow(TypeError);
    await expect(c.editName("New")).resolves.toBeDefined();
    await expect(c.send({ content: "hi" })).resolves.toBeDefined();
    await expect(c.editTopic("Topic")).resolves.toBeDefined();
    await expect(c.editParent("Parent")).resolves.toBeDefined();
    await expect(c.update({ name: "Upd" })).resolves.toBeDefined();
    const detached = new TextChannel({ id: "100", type: 0 });
    expect(detached.toString()).toBe("<#100>");
    expect(() => detached.editName("name")).toThrow("not attached to a client");
    expect(() => detached.update({ name: "name" })).toThrow(
      "not attached to a client",
    );
    expect(() => detached.delete()).toThrow("not attached to a client");
  });

  test("Embed properties and setters coverage", () => {
    const embed = new Embed({ title: "Initial" });
    expect(embed.title).toBe("Initial");
    expect(embed.description).toBeUndefined();

    embed.setTitle("New Title");
    expect(embed.title).toBe("New Title");
    embed.setDescription("Desc");
    expect(embed.description).toBe("Desc");
    embed.setURL("https://example.com");
    expect(embed.url).toBe("https://example.com");
    embed.setColor(0xffffff);
    expect(embed.color).toBe(0xffffff);
    embed.setTimestamp("2026-01-01T00:00:00.000Z");
    expect(embed.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(embed.createdAt?.getFullYear()).toBe(2026);
    embed.setTimestamp();
    expect(embed.timestamp).toBeDefined();

    embed.setFooter("Footer", "icon");
    expect(embed.footer?.text).toBe("Footer");
    embed.setImage("image");
    expect(embed.image?.url).toBe("image");
    embed.setThumbnail("thumb");
    expect(embed.thumbnail?.url).toBe("thumb");
    embed.setAuthor("Author");
    expect(embed.author?.name).toBe("Author");
    embed.addFields({ name: "f1", value: "v1" }, { name: "f2", value: "v2" });
    expect(embed.fields.length).toBe(2);
    expect(embed.fields[0]?.name).toBe("f1");

    embed.spliceFields(0, 1, { name: "f3", value: "v3" });
    expect(embed.fields.length).toBe(2);
    expect(embed.fields[0]?.name).toBe("f3");

    expect(embed.toJSON().title).toBe("New Title");
    expect(embed.video).toBeUndefined();
    embed.clearFields();
    expect(embed.fields.length).toBe(0);
  });

  test("CommandOptions getters and validations", () => {
    const {
      CommandOptions,
    } = require("../packages/structures/src/interactions.ts");
    const optionsData = [
      { type: 1, name: "sub" },
      { type: 2, name: "group" },
      { type: 3, name: "str", value: "hello" },
      { type: 4, name: "int", value: 42 },
      { type: 5, name: "bool", value: true },
      { type: 6, name: "user", value: "100" },
      { type: 7, name: "channel", value: "200" },
      { type: 8, name: "role", value: "300" },
      { type: 9, name: "mentionable", value: "400" },
      { type: 10, name: "num", value: 3.14 },
      { type: 11, name: "attach", value: "500" },
      { type: 11, name: "attach2", value: "600" },
    ];
    const resolvedData = {
      users: { "100": { id: "100", username: "U" } },
      members: { "100": { roles: [] } },
      channels: { "200": { id: "200", type: 0 } },
      roles: { "300": { id: "300", name: "R" } },
      attachments: { "500": { id: "500", url: "url" } },
    };

    const opts = new CommandOptions(optionsData, resolvedData);

    expect(opts.getSubcommand()).toBe("sub");
    expect(opts.getSubcommandGroup()).toBe("group");
    expect(opts.getString("str")).toBe("hello");
    expect(opts.getInteger("int")).toBe(42);
    expect(opts.getBoolean("bool")).toBe(true);
    expect(opts.getNumber("num")).toBe(3.14);

    expect(opts.getUser("user")?.id).toBe("100");
    expect(opts.getChannel("channel")?.id).toBe("200");
    expect(opts.getRole("role")?.id).toBe("300");
    expect(opts.getMentionable("mentionable")).toBeNull();
    expect(opts.getAttachment("attach")?.id).toBe("500");
    expect(() => opts.getAttachment("attach2", true)).toThrow(TypeError);
    expect(opts.raw).toBeDefined();

    // Required tests
    expect(() => opts.getString("missing", true)).toThrow(TypeError);
    expect(() => opts.getInteger("missing", true)).toThrow(TypeError);
    expect(() => opts.getNumber("missing", true)).toThrow(TypeError);
    expect(() => opts.getBoolean("missing", true)).toThrow(TypeError);
    expect(() => opts.getUser("missing", true)).toThrow(TypeError);
    expect(() => opts.getChannel("missing", true)).toThrow(TypeError);
    expect(() => opts.getRole("missing", true)).toThrow(TypeError);
    expect(() => opts.getMentionable("missing", true)).toThrow(TypeError);
    expect(() => opts.getAttachment("missing", true)).toThrow(TypeError);

    // Missing without required
    expect(opts.getString("missing")).toBeNull();

    // Type mismatch
    expect(opts.getString("int")).toBeNull();
    expect(() => opts.getString("int", true)).toThrow(TypeError);

    // No subcommand
    const emptyOpts = new CommandOptions([], {});
    expect(() => emptyOpts.getSubcommand(true)).toThrow(TypeError);
    expect(() => emptyOpts.getSubcommandGroup(true)).toThrow(TypeError);
    expect(emptyOpts.getSubcommand()).toBeNull();
    expect(emptyOpts.getSubcommandGroup()).toBeNull();

    // CommandInteraction parsing subcommand
    const {
      CommandInteraction,
    } = require("../packages/structures/src/interactions.ts");
    const cmdData = {
      type: 2,
      id: "1",
      token: "tok",
      application_id: "app",
      data: {
        id: "cmd1",
        name: "test",
        options: [
          {
            type: 1,
            name: "sub",
            options: [{ type: 3, name: "str", value: "foo" }],
          },
        ],
        type: 1,
      },
    };
    const cmdInt = new CommandInteraction({} as any, cmdData);
    expect(cmdInt.commandName).toBe("test");
    expect(cmdInt.options.getString("str")).toBe("foo");

    // ModalSubmitInteraction testing
    const {
      ModalSubmitInteraction,
    } = require("../packages/structures/src/interactions.ts");
    const modalData = {
      type: 5,
      id: "1",
      token: "tok",
      application_id: "app",
      data: {
        custom_id: "mod1",
        components: [
          {
            type: 1,
            components: [{ type: 4, custom_id: "f1", value: "val1" }],
          },
        ],
      },
    };
    const modalInt = new ModalSubmitInteraction({} as any, modalData);
    expect(modalInt.customId).toBe("mod1");
    expect(modalInt.getInputValue("f1")).toBe("val1");
    expect(modalInt.getRequiredInputValue("f1")).toBe("val1");
    expect(modalInt.getInputValue("f2")).toBeUndefined();
    expect(() => modalInt.getRequiredInputValue("f2")).toThrow(TypeError);
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
