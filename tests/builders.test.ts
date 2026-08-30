import { describe, expect, test } from "bun:test";
import {
  EmbedBuilder,
  AttachmentBuilder,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectBuilder,
  EntitySelectBuilder,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from "../packages/builders/src/index.ts";

describe("Builders Full Coverage", () => {
  test("EmbedBuilder covers all setters and toJSON", () => {
    const embed = new EmbedBuilder()
      .setTitle("Test Embed")
      .setDescription("Description text")
      .setURL("https://example.com/")
      .setColor(0x5865f2)
      .setAuthor({
        name: "Author",
        icon_url: "https://icon.png/",
        url: "https://author.com/",
      })
      .setThumbnail("https://thumb.png/")
      .setImage("https://image.png/")
      .setFooter({ text: "Footer text", icon_url: "https://footer.png/" })
      .setTimestamp(new Date("2026-01-01T00:00:00Z"))
      .addFields(
        { name: "Field 1", value: "Value 1", inline: true },
        { name: "Field 2", value: "Value 2" },
      );

    const json = embed.toJSON();
    expect(json.title).toBe("Test Embed");
    expect(json.description).toBe("Description text");
    expect(json.url).toBe("https://example.com/");
    expect(json.color).toBe(0x5865f2);
    expect(json.author?.name).toBe("Author");
    expect(json.thumbnail?.url).toBe("https://thumb.png/");
    expect(json.image?.url).toBe("https://image.png/");
    expect(json.footer?.text).toBe("Footer text");
    expect(json.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(json.fields?.length).toBe(2);

    embed.spliceFields(0, 1, { name: "Replaced Field", value: "Replaced Val" });
    expect(embed.data.fields?.[0]?.name).toBe("Replaced Field");
    embed.setFields([{ name: "Sole Field", value: "Val" }]);
    expect(embed.data.fields?.length).toBe(1);

    const nowEmbed = new EmbedBuilder().setTimestamp();
    expect(nowEmbed.data.timestamp).toBeDefined();
  });

  test("AttachmentBuilder covers name, description, buffers and conversions", async () => {
    const uint8 = new Uint8Array([1, 2, 3]);
    const att = new AttachmentBuilder(uint8, {
      name: "test.bin",
      description: "Binary test",
    });
    expect(att.name).toBe("test.bin");
    expect(att.description).toBe("Binary test");

    att.setName("updated.bin").setDescription("Updated desc");
    expect(att.name).toBe("updated.bin");
    expect(att.description).toBe("Updated desc");

    const buf = await att.toBuffer();
    expect(buf).toEqual(uint8);

    const stringAtt = new AttachmentBuilder(uint8, "string-named.bin");
    expect(stringAtt.name).toBe("string-named.bin");

    const arrayBufAtt = new AttachmentBuilder(uint8.buffer);
    expect(await arrayBufAtt.toBuffer()).toEqual(uint8);

    const blobAtt = new AttachmentBuilder(new Blob(["hello"]));
    const blobBuf = await blobAtt.toBuffer();
    expect(new TextDecoder().decode(blobBuf)).toBe("hello");

    const emptyAtt = new AttachmentBuilder(123 as any);
    expect((await emptyAtt.toBuffer()).length).toBe(0);
  });

  test("SlashCommandBuilder covers all option types, subcommands and groups", () => {
    const cmd = new SlashCommandBuilder()
      .setName("moderation")
      .setDescription("Moderation command suite")
      .setDMPermission(false)
      .setDefaultMemberPermissions("8")
      .setNSFW(true)
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Action reason")
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(100)
          .addChoices(
            { name: "Spam", value: "spam" },
            { name: "Toxicity", value: "toxic" },
          ),
      )
      .addUserOption((opt) =>
        opt.setName("target").setDescription("Target user").setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Delete history days")
          .setMinValue(1)
          .setMaxValue(7)
          .addChoices({ name: "One", value: 1 }),
      )
      .addNumberOption((opt) =>
        opt
          .setName("ratio")
          .setDescription("Ratio")
          .setMinValue(0.1)
          .setMaxValue(1.0),
      )
      .addBooleanOption((opt) =>
        opt.setName("notify").setDescription("Send DM notification"),
      )
      .addChannelOption((opt) =>
        opt
          .setName("log_channel")
          .setDescription("Logging channel")
          .addChannelTypes(0, 2),
      )
      .addRoleOption((opt) => opt.setName("role").setDescription("Target role"))
      .addMentionableOption((opt) =>
        opt.setName("mentionable").setDescription("Target mentionable"),
      )
      .addAttachmentOption((opt) =>
        opt.setName("evidence").setDescription("Evidence screenshot"),
      )
      .addSubcommand((sub) =>
        sub
          .setName("kick")
          .setDescription("Kick a user")
          .addUserOption((opt) =>
            opt
              .setName("user")
              .setDescription("User to kick")
              .setRequired(true),
          ),
      )
      .addSubcommandGroup((group) =>
        group
          .setName("roles")
          .setDescription("Role management subcommands")
          .addSubcommand((sub) =>
            sub.setName("add").setDescription("Add a role"),
          ),
      );

    const json = cmd.toJSON();
    expect(json.name).toBe("moderation");
    expect(json.description).toBe("Moderation command suite");
    expect(json.dm_permission).toBe(false);
    expect(json.default_member_permissions).toBe("8");
    expect(json.nsfw).toBe(true);
    expect((json.options as any[]).length).toBe(11);
  });

  test("Component Builders cover buttons, selects, modals and text inputs", () => {
    const btn = new ButtonBuilder()
      .setCustomId("btn_confirm")
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅")
      .setDisabled(false);

    expect(btn.toJSON().custom_id).toBe("btn_confirm");
    expect(btn.toJSON().style).toBe(ButtonStyle.Success);

    const linkBtn = new ButtonBuilder()
      .setLabel("Docs")
      .setStyle(ButtonStyle.Link)
      .setURL("https://lunibee.js.org/");
    expect(linkBtn.toJSON().url).toBe("https://lunibee.js.org/");

    const strSelect = new StringSelectBuilder()
      .setCustomId("select_roles")
      .setPlaceholder("Choose a role")
      .setMinValues(1)
      .setMaxValues(3)
      .setDisabled(false)
      .addOptions(
        {
          label: "Admin",
          value: "admin",
          description: "Admin role",
          default: true,
        },
        { label: "Mod", value: "mod" },
      );
    expect(strSelect.toJSON().options?.length).toBe(2);

    const userSelect = new EntitySelectBuilder(ComponentType.UserSelect)
      .setCustomId("select_users")
      .setPlaceholder("Pick users")
      .setDefaultValues({ id: "123", type: "user" });
    expect(userSelect.toJSON().type).toBe(ComponentType.UserSelect);

    const textInput = new TextInputBuilder()
      .setCustomId("input_feedback")
      .setLabel("Your Feedback")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Type here...")
      .setValue("Initial text")
      .setMinLength(10)
      .setMaxLength(500)
      .setRequired(true);

    const modal = new ModalBuilder()
      .setCustomId("modal_feedback")
      .setTitle("Feedback Form")
      .addComponents(new ActionRowBuilder().addComponents(textInput));

    const modalJson = modal.toJSON();
    expect(modalJson.custom_id).toBe("modal_feedback");
    expect(modalJson.title).toBe("Feedback Form");
    expect(modalJson.components.length).toBe(1);
  });
});
