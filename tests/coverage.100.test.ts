import { describe, expect, test } from "bun:test";
import { readFile, writeFile, unlink } from "node:fs/promises";
import {
  AttachmentBuilder,
  SlashCommandBuilder,
  StringOptionBuilder,
  IntegerOptionBuilder,
  NumberOptionBuilder,
  BooleanOptionBuilder,
  SubcommandBuilder,
  SubcommandGroupBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectBuilder,
  EntitySelectBuilder,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  EmbedBuilder,
} from "../packages/builders/src/index.ts";
import { Cache, Collection } from "../packages/collection/src/index.ts";
import { Client } from "../packages/core/src/index.ts";
import { HandlerRegistry } from "../packages/handlers/src/index.ts";
import {
  UserManager,
  GuildManager,
  ChannelManager,
  MessageManager,
  RoleManager,
  GuildMemberManager,
  ThreadManager,
} from "../packages/managers/src/index.ts";
import { REST, RESTError, Routes } from "../packages/rest/src/index.ts";
import { ShardManager } from "../packages/sharding/src/index.ts";
import { ShardBus } from "../packages/sharding/src/bus.ts";
import {
  BaseStructure,
  User,
  Channel,
  Message,
  type ResourceContext,
} from "../packages/structures/src/index.ts";
import {
  Interaction,
  InteractionResponse,
  InteractionResponseType,
  CommandInteraction,
  ComponentInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
  createInteraction,
} from "../packages/structures/src/interactions.ts";
import {
  PermissionSet as StructPermSet,
  Permissions as StructPerms,
} from "../packages/structures/src/permissions.ts";
import {
  Gateway,
  GatewayError,
  GatewayOpcodes,
} from "../packages/ws/src/index.ts";

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  closeCode?: number;
  closeReason?: string;
  #listeners = new Map<string, Set<(event: any) => void>>();

  constructor(url: string) {
    if (url.includes("throw-string-error")) {
      throw "raw string error";
    }
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];

  addEventListener(event: string, listener: (event: any) => void): void {
    let listeners = this.#listeners.get(event);
    if (!listeners) this.#listeners.set(event, (listeners = new Set()));
    listeners.add(listener);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN)
      throw new Error("socket is not open");
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.closeCode = code;
    this.closeReason = reason;
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", {});
  }

  receive(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(value);
  }
}

describe("100% Comprehensive Codebase Coverage", () => {
  test("AttachmentBuilder setFile and file conversions", async () => {
    const att = new AttachmentBuilder("initial.txt", "file.txt");
    expect(att.name).toBe("file.txt");

    att.setFile("newfile.txt");
    expect(att.file).toBe("newfile.txt");

    const tempPath = "temp_cov_test.txt";
    await writeFile(tempPath, "temp coverage content");
    att.setFile(tempPath);
    const buf = await att.toBuffer();
    expect(new TextDecoder().decode(buf)).toBe("temp coverage content");
    await unlink(tempPath);

    att.setFile(Buffer.from("buffer data"));
    const buf2 = await att.toBuffer();
    expect(new TextDecoder().decode(buf2)).toBe("buffer data");
  });

  test("SlashCommandBuilder options, validations and subcommands", () => {
    const cmd = new SlashCommandBuilder()
      .setName("testcmd")
      .setDescription("test desc")
      .setNsfw(true)
      .setIntegrationTypes(0, 1)
      .setDefaultMemberPermissions(null);

    const json = cmd.toJSON();
    expect(json.nsfw).toBe(true);
    expect(json.integration_types).toEqual([0, 1]);
    expect(json.default_member_permissions).toBeNull();
    cmd.setNSFW(false);
    expect(cmd.toJSON().nsfw).toBe(false);

    const numOpt = new NumberOptionBuilder()
      .setName("num")
      .setDescription("num desc")
      .addChoices({ name: "One", value: 1.5 }, { name: "Two", value: 2.5 });
    expect(numOpt.toJSON().choices).toBeDefined();
    expect(() => numOpt.addChoices()).toThrow();
    expect(() =>
      new NumberOptionBuilder()
        .setAutocomplete(true)
        .addChoices({ name: "A", value: 1 }),
    ).toThrow();
    expect(() =>
      new NumberOptionBuilder()
        .addChoices({ name: "A", value: 1 })
        .setAutocomplete(true),
    ).toThrow();
    expect(() =>
      new NumberOptionBuilder().setMinValue(10).setMaxValue(5),
    ).toThrow();
    expect(() => new NumberOptionBuilder().setMinValue(NaN)).toThrow();
    expect(() =>
      new IntegerOptionBuilder().setMinValue(10).setMaxValue(5),
    ).toThrow();
    expect(() => new IntegerOptionBuilder().setMinValue(1.5)).toThrow();
    expect(() => new IntegerOptionBuilder().setMinValue(NaN)).toThrow();
    expect(() =>
      new StringOptionBuilder().setMinLength(10).setMaxLength(5),
    ).toThrow();
    expect(() =>
      new SlashCommandBuilder().setName("").setDescription("d"),
    ).toThrow();
    expect(() =>
      new SlashCommandBuilder().setName("UPPERCASE").setDescription("d"),
    ).toThrow();
    expect(() => {
      const opt = new NumberOptionBuilder();
      const choices = Array.from({ length: 26 }, (_, i) => ({
        name: `c${i}`,
        value: i,
      }));
      opt.addChoices(...choices);
    }).toThrow();

    const strOpt = new StringOptionBuilder()
      .setName("str")
      .setDescription("desc");
    expect(() => strOpt.addChoices()).toThrow();

    const subGroup = new SubcommandGroupBuilder()
      .setName("group")
      .setDescription("group desc");
    subGroup.addSubcommand((s) =>
      s.setName("sub1").setDescription("sub1 desc"),
    );
    expect(() =>
      subGroup.addSubcommand((s) =>
        s.setName("sub1").setDescription("duplicate"),
      ),
    ).toThrow();
    expect(() =>
      subGroup.addSubcommand((s: any) => {
        s.toJSON = () => ({ type: 3, name: "invalid" });
        return s;
      }),
    ).toThrow();
    expect(() => {
      const g = new SubcommandGroupBuilder().setName("grp").setDescription("d");
      for (let i = 0; i < 25; i++)
        g.addSubcommand((s) => s.setName(`sub${i}`).setDescription("d"));
      g.addSubcommand((s) => s.setName("sub26").setDescription("d"));
    }).toThrow();

    const slash = new SlashCommandBuilder()
      .setName("main")
      .setDescription("main desc");
    slash.addStringOption((o) =>
      o.setName("req").setDescription("d").setRequired(true),
    );
    slash.addStringOption((o) =>
      o.setName("opt").setDescription("d").setRequired(false),
    );
    expect(() =>
      slash.addStringOption((o) =>
        o.setName("req2").setDescription("d").setRequired(true),
      ),
    ).toThrow();
    expect(() =>
      slash.addStringOption((o) =>
        o.setName("req").setDescription("duplicate"),
      ),
    ).toThrow();
    expect(() => {
      const s = new SlashCommandBuilder().setName("m").setDescription("d");
      for (let i = 0; i < 25; i++)
        s.addBooleanOption((o) => o.setName(`opt${i}`).setDescription("d"));
      s.addBooleanOption((o) => o.setName("opt26").setDescription("d"));
    }).toThrow();
  });

  test("Component Builders & Validations", () => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("btn")
        .setLabel("Click")
        .setStyle(ButtonStyle.Primary),
    );
    expect(row.toJSON().components.length).toBe(1);
    row.clearComponents();
    expect(row.toJSON().components.length).toBe(0);
    expect(() => row.addComponents()).toThrow();

    const strSelect = new StringSelectBuilder()
      .setCustomId("sel")
      .setPlaceholder("pick")
      .setRequired(true)
      .setDisabled(true)
      .setMinValues(1)
      .setMaxValues(5);
    const selJson = strSelect.toJSON();
    expect(selJson.required).toBe(true);
    expect(selJson.disabled).toBe(true);

    const entSelect = new EntitySelectBuilder(ComponentType.RoleSelect)
      .setCustomId("rolesel")
      .setPlaceholder("roles")
      .setRequired(true)
      .setDisabled(true)
      .setMinValues(2)
      .setMaxValues(4);
    const entJson = entSelect.toJSON();
    expect(entJson.required).toBe(true);
    expect(entJson.disabled).toBe(true);

    const txtInput = new TextInputBuilder()
      .setCustomId("input")
      .setLabel("label");
    txtInput.setMinLength(10).setMaxLength(100);
    expect(txtInput.toJSON().min_length).toBe(10);
    expect(txtInput.toJSON().max_length).toBe(100);
    expect(() => txtInput.setMinLength(-1)).toThrow();
    expect(() => txtInput.setMaxLength(5000)).toThrow();
    expect(() => txtInput.setMaxLength(-1)).toThrow();
    expect(() => strSelect.setMinValues(-1)).toThrow();
    expect(() => strSelect.setMaxValues(30)).toThrow();
    expect(() => strSelect.setCustomId("")).toThrow();
  });

  test("EmbedBuilder clear methods and validations", () => {
    const embed = new EmbedBuilder()
      .setTitle("Title")
      .setDescription("Desc")
      .addFields({ name: "F1", value: "V1" });

    expect(embed.data.title).toBe("Title");
    expect(embed.data.description).toBe("Desc");
    expect(embed.data.fields?.length).toBe(1);

    embed.clearTitle();
    expect(embed.data.title).toBeUndefined();

    embed.clearDescription();
    expect(embed.data.description).toBeUndefined();

    embed.clearFields();
    expect(embed.data.fields).toBeUndefined();

    expect(() => embed.setTitle("")).toThrow();
    expect(() => embed.setDescription("")).toThrow();
    expect(() => embed.setColor(-1)).toThrow();
    expect(() => embed.setColor(0x1000000)).toThrow();
    expect(() => embed.setTimestamp(new Date("invalid-date"))).toThrow();
    expect(() => embed.addFields()).toThrow();
    expect(() => embed.spliceFields(-1, 0)).toThrow();
    expect(() => embed.setURL("not-a-url")).toThrow();
    expect(() => embed.setThumbnail("not-a-url")).toThrow();
    expect(() => embed.setImage("not-a-url")).toThrow();
  });

  test("Cache options, size getter, sweep, entries and dispose", async () => {
    expect(() => new Cache({ maxSize: 0 })).toThrow();
    expect(() => new Cache({ maxSize: 1.5 })).toThrow();
    expect(() => new Cache({ ttl: -5 })).toThrow();
    expect(() => new Cache({ ttl: NaN })).toThrow();
    expect(() => new Cache({ ttl: 100, sweepInterval: 0 })).toThrow();
    expect(() => new Cache({ ttl: 100, sweepInterval: NaN })).toThrow();

    const defCache = new Cache<string, number>();
    defCache.set("x", 42);
    expect(defCache.values()).toEqual([42]);
    expect(defCache.entries()).toEqual([["x", 42]]);
    defCache.dispose();

    const cache = new Cache<string, number>({
      maxSize: 10,
      ttl: 50,
      sweepInterval: 25,
    });
    cache.set("a", 1).set("b", 2);
    expect(cache.size).toBe(2);
    expect(cache.values()).toEqual([1, 2]);
    expect(cache.entries()).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("nonexistent")).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has("b")).toBe(false);

    cache.dispose();

    const expCache = new Cache<string, number>({ ttl: 5, sweepInterval: 1000 });
    expCache.set("temp", 123);
    await Bun.sleep(15);
    expect(expCache.get("temp")).toBeUndefined();
    expCache.dispose();
  });

  test("EventEmitter & HandlerRegistry full lifecycle", async () => {
    const registry = new HandlerRegistry<{
      test: [string];
      multi: [number, number];
    }>();
    let onceCalled = 0;
    registry.once("test", (msg) => {
      onceCalled++;
    });
    await registry.emit("test", "first");
    await registry.emit("test", "second");
    expect(onceCalled).toBe(1);

    const client = new Client({ token: "test.token", intents: 0 });
    let onceCount = 0;
    const onceFn = () => {
      onceCount++;
    };
    client.once("open", onceFn);
    (client as any).emit("open");
    (client as any).emit("open");
    expect(onceCount).toBe(1);

    const offFn = () => {};
    client.on("raw", offFn);
    client.off("raw", offFn);

    client.on("ready", () => {});
    client.removeAllListeners("ready");
    client.removeAllListeners();

    let errorReceived: Error | undefined;
    client.on("error", (err) => {
      errorReceived = err;
    });

    client.on("messageDelete", () => {
      throw new Error("sync failure");
    });
    (client as any).emit("messageDelete", { id: "1", channel_id: "2" });
    expect(errorReceived?.message).toBe("sync failure");

    client.on("messageDeleteBulk", async () => {
      throw new Error("async failure");
    });
    (client as any).emit("messageDeleteBulk", { ids: ["1"], channel_id: "2" });
    await Bun.sleep(10);
    expect(errorReceived?.message).toBe("async failure");
  });

  test("Client properties, getters, and mock interactions", async () => {
    const client = new Client({ token: "bot.token", intents: 0 });
    expect(client.ws).toBeDefined();
    expect(client.gateway).toBeDefined();
    expect(client.uptime).toBeNull();
    expect(client.isReady()).toBe(false);

    expect(client.setPresence({ status: "idle" })).toBe(false);

    expect(() =>
      client.editInteractionReply("tok", { content: "hi" }),
    ).toThrow();
    await expect(client.deleteInteractionReply("tok")).rejects.toThrow();
    expect(() =>
      client.followUpInteraction("tok", { content: "hi" }),
    ).toThrow();

    client.destroy();
    expect(client.state).toBe("destroyed");
    await expect(client.login()).rejects.toThrow();
  });

  test("Client Gateway event dispatchers coverage", async () => {
    const client = new Client({ token: "bot.token", intents: 0 });

    let threadCreated: any;
    let threadUpdated: any;
    let threadDeleted: any;
    let memberAdded: any;
    let memberUpdated: any;
    let memberRemoved: any;
    let reactionAdded: any;
    let reactionRemoved: any;
    let reactionRemovedAll: any;
    let rawReceived = 0;

    client.on("threadCreate", (ch) => {
      threadCreated = ch;
    });
    client.on("threadUpdate", (ch) => {
      threadUpdated = ch;
    });
    client.on("threadDelete", (ch) => {
      threadDeleted = ch;
    });
    client.on("guildMemberAdd", (m) => {
      memberAdded = m;
    });
    client.on("guildMemberUpdate", (m) => {
      memberUpdated = m;
    });
    client.on("guildMemberRemove", (m) => {
      memberRemoved = m;
    });
    client.on("messageReactionAdd", (r) => {
      reactionAdded = r;
    });
    client.on("messageReactionRemove", (r) => {
      reactionRemoved = r;
    });
    client.on("messageReactionRemoveAll", (r) => {
      reactionRemovedAll = r;
    });
    client.on("raw", () => {
      rawReceived++;
    });

    const gw = client.gateway;
    gw.emit("THREAD_CREATE", { id: "100", type: 11, guild_id: "200" });
    gw.emit("THREAD_UPDATE", { id: "100", type: 11, guild_id: "200" });
    gw.emit("THREAD_DELETE", { id: "100", type: 11, guild_id: "200" });
    gw.emit("GUILD_MEMBER_ADD", {
      user: { id: "300", username: "U" },
      guild_id: "200",
      roles: [],
    });
    gw.emit("GUILD_MEMBER_UPDATE", {
      user: { id: "300", username: "U" },
      guild_id: "200",
      roles: [],
    });
    gw.emit("GUILD_MEMBER_REMOVE", {
      user: { id: "300", username: "U" },
      guild_id: "200",
    });
    gw.emit("MESSAGE_REACTION_ADD", {
      user_id: "300",
      message_id: "400",
      emoji: { name: "👍" },
    });
    gw.emit("MESSAGE_REACTION_REMOVE", {
      user_id: "300",
      message_id: "400",
      emoji: { name: "👍" },
    });
    gw.emit("MESSAGE_REACTION_REMOVE_ALL", {
      message_id: "400",
      channel_id: "500",
    });

    expect(threadCreated.id).toBe("100");
    expect(threadUpdated.id).toBe("100");
    expect(threadDeleted.id).toBe("100");
    expect(memberAdded.user.id).toBe("300");
    expect(memberUpdated.user.id).toBe("300");
    expect(memberRemoved.user.id).toBe("300");
    expect(reactionAdded.message_id).toBe("400");
    expect(reactionRemoved.message_id).toBe("400");
    expect(reactionRemovedAll.message_id).toBe("400");
    expect(rawReceived).toBe(9);

    // Cover client resource context
    let msgCreated: any;
    client.on("messageCreate", (m) => {
      msgCreated = m;
    });
    gw.emit("MESSAGE_CREATE", {
      id: "500",
      channel_id: "100",
      content: "hi",
      author: { id: "300", username: "U" },
    });

    (client.rest as any).post = async () => ({
      id: "501",
      channel_id: "100",
      content: "reply",
      author: { id: "300", username: "U" },
    });
    (client.rest as any).patch = async () => ({
      id: "500",
      channel_id: "100",
      content: "edit",
      author: { id: "300", username: "U" },
    });
    (client.rest as any).delete = async () => {};

    await msgCreated.reply("reply");
    await msgCreated.edit({ content: "edit" });
    await msgCreated.crosspost();
    await msgCreated.delete();

    // Cover client interaction response
    await client.postInteractionResponse(
      "1",
      "tok",
      InteractionResponse.pong(),
    );
  });

  test("Managers full coverage", async () => {
    const rest = new REST({ token: "test.token" });
    (rest as any).get = async (path: string) => {
      if (path.includes("/users/")) return { id: "101", username: "User101" };
      if (path.includes("/guilds/") && path.includes("/members/"))
        return {
          user: { id: "401", username: "Member401" },
          guild_id: "201",
          roles: [],
        };
      if (path.includes("/guilds/") && path.includes("/roles/"))
        return { id: "501", name: "Role501" };
      if (path.includes("/guilds/"))
        return { id: "201", name: "Guild201", roles: [] };
      if (path.includes("/channels/") && path.includes("/messages/"))
        return {
          id: "999",
          channel_id: "301",
          content: "f",
          author: { id: "101", username: "u" },
        };
      if (path.includes("/channels/"))
        return { id: "301", type: 0, name: "General" };
      return {};
    };

    const userMgr = new UserManager(rest);
    const fetchedUser = await userMgr.fetch("101");
    expect(fetchedUser.id).toBe("101");

    const guildMgr = new GuildManager(rest);
    const fetchedGuild = await guildMgr.fetch("201");
    expect(fetchedGuild.id).toBe("201");

    const chanMgr = new ChannelManager(rest);
    const fetchedChan = await chanMgr.fetch("301");
    expect(fetchedChan.id).toBe("301");
    const resolvedChan = await chanMgr.resolve("301");
    expect(resolvedChan.id).toBe("301");

    const updatedChan = chanMgr.upsert({
      id: "301",
      type: 0,
      name: "General Updated",
    });
    expect(updatedChan.name).toBe("General Updated");
    chanMgr.update(new Channel({ id: "301", type: 0, name: "General Final" }));
    expect(chanMgr.get("301")?.name).toBe("General Final");

    chanMgr.upsertMessage({
      id: "901",
      channel_id: "301",
      content: "Msg",
      author: { id: "101", username: "U" },
    });
    expect(chanMgr.deleteCachedMessage("301", "901")).toBe(true);
    expect(chanMgr.delete("301")).toBe(true);
    chanMgr.clear();

    const memberMgr = new GuildMemberManager("201", rest);
    const fetchedMember = await memberMgr.fetch("401");
    expect(fetchedMember.user.id).toBe("401");

    const roleMgr = new RoleManager("201", rest);
    const fetchedRole = await roleMgr.fetch("501");
    expect(fetchedRole.id).toBe("501");

    const msgMgr = new MessageManager(rest, {} as any, "301");
    msgMgr.upsert({
      id: "99",
      channel_id: "301",
      content: "pre",
      author: { id: "101", username: "u" },
    });
    const resolvedMsg = await msgMgr.resolve("99");
    expect(resolvedMsg.id).toBe("99");

    const fetchedMany = await msgMgr.fetchMany(["999"]);
    expect(fetchedMany.length).toBe(1);

    expect(() => new MessageManager(rest, {} as any, "")).toThrow();
  });

  test("REST setToken, abort and cancellation", async () => {
    const rest = new REST({ token: "valid.token", timeout: 10 });
    expect(() => rest.setToken("")).toThrow();
    rest.setToken("new.valid.token");

    const controller = new AbortController();
    controller.abort(new Error("custom cancellation"));
    await expect(
      rest.request("GET", "/users/@me", undefined, {
        signal: controller.signal,
      }),
    ).rejects.toThrow();

    const liveController = new AbortController();
    const reqPromise = rest.request("GET", "/channels/123", undefined, {
      signal: liveController.signal,
    });
    liveController.abort();
    await expect(reqPromise).rejects.toThrow();

    // Trigger request timeout
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      new Promise((resolve) => setTimeout(resolve, 500))) as any;
    await expect(rest.request("GET", "/timeout-test")).rejects.toThrow();
    globalThis.fetch = originalFetch;
  });

  test("Sharding Manager discovery, connect and bus broadcast", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/gateway/bot")) {
        return new Response(JSON.stringify({ shards: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const mgr = new ShardManager({
      token: "bot.token",
      intents: 513,
      shardCount: "auto",
      spawnDelay: 1,
    });
    const count = await mgr.fetchRecommendedShardCount();
    expect(count).toBe(2);

    expect(mgr.getShardIdForGuild("123456789012345678")).toBeGreaterThanOrEqual(
      0,
    );

    // Mock shard connections
    const origConnect = Gateway.prototype.connect;
    Gateway.prototype.connect = async function () {};
    await mgr.connect();
    expect(mgr.values().length).toBe(2);
    expect(mgr.get(0)).toBeDefined();
    mgr.destroy();
    Gateway.prototype.connect = origConnect;

    globalThis.fetch = (async () =>
      new Response("error", { status: 500 })) as any;
    await expect(mgr.fetchRecommendedShardCount()).rejects.toThrow();

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ shards: 0 }), { status: 200 })) as any;
    await expect(mgr.fetchRecommendedShardCount()).rejects.toThrow();

    globalThis.fetch = originalFetch;

    const bus1 = new ShardBus(0, "test-bus-channel");
    const bus2 = new ShardBus(1, "test-bus-channel");
    let targetedMsg: any;
    let broadcastMsg: any;
    const targetHandler = (msg: any) => {
      targetedMsg = msg;
    };
    const broadcastHandler = (msg: any) => {
      broadcastMsg = msg;
    };
    bus2.on("ping", targetHandler);
    bus2.on("broadcastMsg", broadcastHandler);

    bus1.send(1, "ping", "hello shard 1");
    bus1.broadcast("broadcastMsg", "hello all shards");

    await Bun.sleep(20);
    expect(targetedMsg.data).toBe("hello shard 1");
    expect(broadcastMsg.data).toBe("hello all shards");

    bus2.off("ping", targetHandler);
    bus1.close();
    bus2.close();
  });

  test("Structures Base, User Avatar, Message and Interactions", async () => {
    const base = new BaseStructure("123456789");
    expect(base.toString()).toBe("123456789");
    expect(() => new BaseStructure("invalid-id")).toThrow();

    const userWithAvatar = new User({
      id: "123456",
      username: "AvatarUser",
      avatar: "abc123avatar",
    });
    expect(userWithAvatar.avatarURL()).toBe(
      "https://cdn.discordapp.com/avatars/123456/abc123avatar.png",
    );
    expect(userWithAvatar.avatarURL({ extension: "webp", size: 512 })).toBe(
      "https://cdn.discordapp.com/avatars/123456/abc123avatar.webp?size=512",
    );
    expect(userWithAvatar.displayAvatarURL()).toBe(
      "https://cdn.discordapp.com/avatars/123456/abc123avatar.png",
    );

    const gifUser = new User({
      id: "123456",
      username: "GifUser",
      avatar: "a_animatedavatar",
    });
    expect(gifUser.avatarURL()).toBe(
      "https://cdn.discordapp.com/avatars/123456/a_animatedavatar.gif",
    );

    const noAvatarUser = new User({
      id: "789",
      username: "NoAvatar",
    });
    expect(noAvatarUser.avatarURL()).toBeNull();
    expect(noAvatarUser.defaultAvatarURL()).toContain("embed/avatars/");
    expect(noAvatarUser.displayAvatarURL()).toContain("embed/avatars/");

    const mockCtx: ResourceContext = {
      sendMessage: async (cid, opts) =>
        new Message(
          {
            id: "999",
            channel_id: cid,
            content: opts.content ?? "",
            author: { id: "1", username: "A" },
          },
          mockCtx,
        ),
      editMessage: async (cid, mid, opts) =>
        new Message(
          {
            id: mid,
            channel_id: cid,
            content: opts.content ?? "edited",
            author: { id: "1", username: "A" },
          },
          mockCtx,
        ),
      deleteMessage: async () => {},
      crosspostMessage: async (cid, mid) =>
        new Message(
          {
            id: mid,
            channel_id: cid,
            content: "crossposted",
            author: { id: "1", username: "A" },
          },
          mockCtx,
        ),
    };

    const msg = new Message(
      {
        id: "555",
        channel_id: "666",
        content: "Hello",
        flags: 4,
        author: { id: "1", username: "Author" },
      },
      mockCtx,
    );

    expect(msg.embedsSuppressed).toBe(true);
    const edited = await msg.edit({ content: "Updated content" });
    expect(edited.content).toBe("Updated content");
    const reply = await msg.reply("Reply string");
    expect(reply.content).toBe("Reply string");
    const crossposted = await msg.crosspost();
    expect(crossposted.content).toBe("crossposted");
    await msg.delete();

    const detached = new Message({
      id: "556",
      channel_id: "666",
      content: "Detached",
      author: { id: "1", username: "Author" },
    });
    expect(() => detached.edit({ content: "x" })).toThrow();
    expect(() => detached.delete()).toThrow();
    expect(() => detached.crosspost()).toThrow();
    expect(() => detached.reply("x")).toThrow();

    const mockClient = {
      postInteractionResponse: async () => ({ status: "posted" }),
      editInteractionReply: async () => ({ status: "edited" }),
      deleteInteractionReply: async () => {},
      followUpInteraction: async () => ({ status: "followed_up" }),
    };

    const pongResp = InteractionResponse.pong();
    expect(pongResp.toJSON().type).toBe(1);
    expect(
      InteractionResponse.message({ content: "hi", ephemeral: true }).toJSON()
        .data?.flags,
    ).toBe(64);
    expect(InteractionResponse.defer(true).toJSON().data?.flags).toBe(64);
    expect(InteractionResponse.defer(false).toJSON().data).toBeUndefined();
    expect(() => new InteractionResponse(NaN)).toThrow();

    const cmdInteraction = createInteraction(mockClient, {
      id: "1",
      application_id: "app",
      token: "tok",
      type: 2,
      data: { name: "ping" },
    }) as CommandInteraction;
    expect(cmdInteraction.isChatInputCommand()).toBe(true);
    expect(cmdInteraction.commandName).toBe("ping");
    await cmdInteraction.followUp("followed up");

    const compInteraction = createInteraction(mockClient, {
      id: "2",
      application_id: "app",
      token: "tok",
      type: 3,
      data: { custom_id: "btn_click", component_type: 2, values: ["val1"] },
    }) as ComponentInteraction;
    expect(compInteraction.isMessageComponent()).toBe(true);
    expect(compInteraction.customId).toBe("btn_click");
    expect(compInteraction.componentType).toBe(2);
    expect(compInteraction.values).toEqual(["val1"]);
    await compInteraction.deferUpdate();
    await expect(compInteraction.update("again")).rejects.toThrow();

    const compUpdateInteraction = new ComponentInteraction(mockClient, {
      id: "22",
      application_id: "app",
      token: "tok",
      type: 3,
      data: { custom_id: "btn2" },
    });
    await compUpdateInteraction.update("updated message");
    expect(compUpdateInteraction.replied).toBe(true);

    const modalInteraction = createInteraction(mockClient, {
      id: "3",
      application_id: "app",
      token: "tok",
      type: 5,
      data: {
        custom_id: "modal_submit",
        components: [
          {
            type: 1,
            components: [{ type: 4, custom_id: "inp_name", value: "Lunibee" }],
          },
        ],
      },
    }) as ModalSubmitInteraction;
    expect(modalInteraction.isModalSubmit()).toBe(true);

    const actualModal = new ModalSubmitInteraction(
      mockClient,
      modalInteraction.data as any,
    );
    expect(actualModal.customId).toBe("modal_submit");
    expect(actualModal.getInputValue("inp_name")).toBe("Lunibee");
    expect(actualModal.getInputValue("nonexistent")).toBeUndefined();

    const autoInteraction = new AutocompleteInteraction(mockClient, {
      id: "4",
      application_id: "app",
      token: "tok",
      type: 4,
      data: {
        name: "tags",
        options: [{ name: "query", value: "test", focused: true }],
      },
    });
    expect(autoInteraction.isAutocomplete()).toBe(true);
    expect(autoInteraction.commandName).toBe("tags");
    expect(autoInteraction.focusedOption?.name).toBe("query");
    await autoInteraction.respond([{ name: "choice1", value: "c1" }]);

    const rawResponseWithNoData = new InteractionResponse(1);
    expect(rawResponseWithNoData.toJSON()).toEqual({ type: 1 });
    const rawResponseWithData = new InteractionResponse(4, { content: "data" });
    expect(rawResponseWithData.toJSON()).toEqual({
      type: 4,
      data: { content: "data" },
    });

    // Interaction base constructor and methods
    expect(
      () => new Interaction(mockClient, { id: "", token: "" } as any),
    ).toThrow();
    const unackInteraction = new Interaction(mockClient, {
      id: "u",
      application_id: "a",
      token: "t",
      type: 2,
      data: {},
    });
    expect(() => unackInteraction.editReply({ content: "x" })).toThrow();
    expect(() => unackInteraction.deleteReply()).toThrow();

    const baseInteraction = new Interaction(mockClient, {
      id: "99",
      application_id: "a",
      token: "t",
      type: 99,
      data: {},
    });
    await baseInteraction.update("base update");
    expect(baseInteraction.replied).toBe(true);

    const baseInteraction2 = new Interaction(mockClient, {
      id: "100",
      application_id: "a",
      token: "t",
      type: 99,
      data: {},
    });
    await baseInteraction2.update({ content: "base obj" });
    expect(baseInteraction2.replied).toBe(true);

    const defInteraction = createInteraction(mockClient, {
      id: "99",
      application_id: "a",
      token: "t",
      type: 99,
      data: {},
    });
    expect(defInteraction).toBeInstanceOf(Interaction);

    // createInteraction type=4 (ApplicationCommandAutocomplete) hits CommandInteraction
    const autoCreate = createInteraction(mockClient, {
      id: "auto1",
      application_id: "app",
      token: "tok",
      type: 4,
      data: { name: "autocmd" },
    });
    expect(autoCreate).toBeInstanceOf(CommandInteraction);
  });

  test("Structures Permissions module full coverage", () => {
    const perms = new StructPermSet(StructPerms.Administrator);
    expect(perms.has("Administrator")).toBe(true);
    expect(perms.has("KickMembers")).toBe(false);
    expect(perms.any("KickMembers", "Administrator")).toBe(true);

    const added = perms.add("KickMembers", StructPerms.BanMembers);
    expect(added.has("KickMembers")).toBe(true);
    expect(added.has("BanMembers")).toBe(true);

    const removed = added.remove("KickMembers");
    expect(removed.has("KickMembers")).toBe(false);

    expect(removed.equals(removed.bitfield)).toBe(true);
    expect(removed.equals(new StructPermSet(removed.bitfield))).toBe(true);
    expect(typeof removed.toString()).toBe("string");
    expect(Array.isArray(removed.toArray())).toBe(true);
  });

  test("WS Gateway full methods and edge cases", () => {
    const gw = new Gateway({ token: "bot.token", intents: 0 });
    let emittedData: any;
    const listener = (d: any) => {
      emittedData = d;
    };
    gw.on("customEvent", listener);
    gw.emit("customEvent", { ok: true });
    expect(emittedData).toEqual({ ok: true });

    gw.off("customEvent", listener);
    gw.emit("customEvent", { ok: false });
    expect(emittedData).toEqual({ ok: true });

    expect(gw.setPresence({ status: "dnd" })).toBe(false);
    expect(gw.setVoiceState({ channel_id: "123" })).toBe(false);
    expect(gw.requestGuildMembers({ guild_id: "456" })).toBe(false);
    expect(() => gw.send({} as any)).toThrow();
  });
});
