/**
 * Compatibility payload + type tests for Structures, Managers & Builders (T5).
 *
 * These lock down the JSON payload shapes Lunibee emits and the Discord.js-familiar
 * surface (properties, nullability, serialization) so regressions surface early.
 * The `satisfies`/typed-binding assertions double as compile-time (type) tests:
 * they only pass `tsc` if the public types stay compatible.
 */
import { describe, expect, test } from "bun:test";
import {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ActionRowBuilder,
    StringSelectBuilder,
    EntitySelectBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
} from "../packages/builders/src/index.ts";
import type {
    APIButtonComponent,
    APIContainerComponent,
    APIThumbnailComponent,
    APIEntitySelectComponent,
} from "../packages/builders/src/components.ts";
import { User, Guild, Role, GuildMember } from "../packages/structures/src/index.ts";

describe("Builders — payload contracts", () => {
    test("EmbedBuilder.toJSON returns a snake_case Discord payload and is cloned", () => {
        const builder = new EmbedBuilder()
            .setTitle("Title")
            .setColor(0x5865f2)
            .addFields({ name: "a", value: "b", inline: true });
        const json = builder.toJSON();
        expect(json).toEqual({
            title: "Title",
            color: 0x5865f2,
            fields: [{ name: "a", value: "b", inline: true }],
        });
        // toJSON must be a deep clone: mutating the result does not leak back.
        json.fields!.push({ name: "x", value: "y" });
        expect(builder.toJSON().fields).toHaveLength(1);
    });

    test("ButtonBuilder enforces link/custom_id mutual exclusion", () => {
        const custom = new ButtonBuilder()
            .setStyle(ButtonStyle.Primary)
            .setCustomId("click")
            .setLabel("Click");
        const json: APIButtonComponent = custom.toJSON();
        expect(json).toEqual({
            type: ComponentType.Button,
            style: ButtonStyle.Primary,
            custom_id: "click",
            label: "Click",
        });

        // setURL flips to a link button and drops custom_id.
        const link = new ButtonBuilder().setCustomId("x").setURL("https://a.b/");
        expect(link.toJSON()).toEqual({
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            url: "https://a.b/",
        });
        // A link button rejects custom ids.
        expect(() =>
            new ButtonBuilder().setStyle(ButtonStyle.Link).setCustomId("no"),
        ).toThrow(TypeError);
    });

    test("ActionRowBuilder nests child toJSON output and caps at 5", () => {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("a").setLabel("A"),
            new ButtonBuilder().setCustomId("b").setLabel("B"),
        );
        const json = row.toJSON();
        expect(json.type).toBe(ComponentType.ActionRow);
        expect(json.components).toHaveLength(2);
        expect(json.components[0]!.type).toBe(ComponentType.Button);
        expect(() =>
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                ...Array.from({ length: 6 }, (_, i) =>
                    new ButtonBuilder().setCustomId(`c${i}`).setLabel("x"),
                ),
            ),
        ).toThrow(RangeError);
    });

    test("StringSelectBuilder clones options and enforces the 25 cap", () => {
        const select = new StringSelectBuilder()
            .setCustomId("menu")
            .addOptions({ label: "One", value: "1" });
        expect(select.toJSON()).toEqual({
            type: ComponentType.StringSelect,
            custom_id: "menu",
            options: [{ label: "One", value: "1" }],
        });
        expect(() =>
            new StringSelectBuilder().addOptions(
                ...Array.from({ length: 26 }, (_, i) => ({
                    label: `l${i}`,
                    value: `${i}`,
                })),
            ),
        ).toThrow(RangeError);
    });

    test("EntitySelectBuilder carries typed default_values", () => {
        const select = new EntitySelectBuilder(
            ComponentType.UserSelect,
        ).setDefaultValues({ id: "1", type: "user" });
        const json: APIEntitySelectComponent = select.toJSON();
        expect(json.default_values).toEqual([{ id: "1", type: "user" }]);
        expect(() => new EntitySelectBuilder(ComponentType.Button as never)).toThrow();
    });

    test("Modal + TextInput serialize to Discord's nested shape", () => {
        const modal = new ModalBuilder()
            .setCustomId("m")
            .setTitle("Feedback")
            .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId("field")
                        .setLabel("Field")
                        .setStyle(TextInputStyle.Paragraph),
                ),
            );
        expect(modal.toJSON()).toEqual({
            type: 9,
            custom_id: "m",
            title: "Feedback",
            components: [
                {
                    type: ComponentType.ActionRow,
                    components: [
                        {
                            type: ComponentType.TextInput,
                            style: TextInputStyle.Paragraph,
                            custom_id: "field",
                            label: "Field",
                        },
                    ],
                },
            ],
        });
    });
});

describe("Builders — Components V2", () => {
    test("Container omits unset accent_color and supports spoiler", () => {
        const plain: APIContainerComponent = new ContainerBuilder()
            .addComponents(new TextDisplayBuilder().setContent("hi"))
            .toJSON();
        expect("accent_color" in plain).toBe(false);
        expect("spoiler" in plain).toBe(false);

        const styled = new ContainerBuilder()
            .setAccentColor(0x00ff00)
            .setSpoiler()
            .addComponents(new TextDisplayBuilder().setContent("hi"))
            .toJSON();
        expect(styled.accent_color).toBe(0x00ff00);
        expect(styled.spoiler).toBe(true);
    });

    test("Thumbnail supports description + spoiler and stays minimal by default", () => {
        expect(new ThumbnailBuilder().setUrl("https://a.b/t.png").toJSON()).toEqual({
            type: ComponentType.Thumbnail,
            url: "https://a.b/t.png",
        });
        const full: APIThumbnailComponent = new ThumbnailBuilder()
            .setUrl("https://a.b/t.png")
            .setDescription("alt text")
            .setSpoiler()
            .toJSON();
        expect(full).toEqual({
            type: ComponentType.Thumbnail,
            url: "https://a.b/t.png",
            description: "alt text",
            spoiler: true,
        });
    });

    test("Section only emits keys that are set", () => {
        const section = new SectionBuilder()
            .addComponents(new TextDisplayBuilder().setContent("body"))
            .toJSON();
        expect(section.type).toBe(ComponentType.Section);
        expect(section.components).toHaveLength(1);
        expect(section.accessory).toBeUndefined();
    });

    test("MediaGallery caps at 10 items", () => {
        expect(() =>
            new MediaGalleryBuilder().addItems(
                ...Array.from({ length: 11 }, () => ({ url: "https://a.b/i.png" })),
            ),
        ).toThrow(RangeError);
    });
});

describe("Structures — properties, nullability & serialization", () => {
    test("User maps discriminator '0' to null and builds mention/avatar URLs", () => {
        const legacy = new User({
            id: "80351110224678912",
            username: "nelly",
            discriminator: "1337",
            avatar: "abc",
        } as never);
        expect(legacy.discriminator).toBe("1337");
        expect(String(legacy)).toBe("<@80351110224678912>");
        expect(legacy.avatarURL()).toBe(
            "https://cdn.discordapp.com/avatars/80351110224678912/abc.png",
        );

        const pomelo = new User({
            id: "80351110224678912",
            username: "nelly",
            discriminator: "0",
            global_name: "Nelly",
        } as never);
        expect(pomelo.discriminator).toBeNull();
        expect(pomelo.displayName).toBe("Nelly");
        expect(pomelo.avatarURL()).toBeNull();
        // default avatar for pomelo users derives from the snowflake, not discriminator.
        expect(pomelo.defaultAvatarURL()).toMatch(/embed\/avatars\/\d\.png$/);
    });

    test("Animated avatars pick gif unless forceStatic", () => {
        const user = new User({
            id: "80351110224678912",
            username: "a",
            avatar: "a_animated",
        } as never);
        expect(user.avatarURL()).toContain(".gif");
        expect(user.avatarURL({ forceStatic: true })).toContain(".png");
    });

    test("Guild feature helpers and vanity URL", () => {
        const guild = new Guild({
            id: "1",
            name: "Test",
            features: ["COMMUNITY", "PARTNERED"],
            vanity_url_code: "lunibee",
            premium_subscription_count: 5,
            premium_tier: 2,
        } as never);
        expect(guild.isCommunity).toBe(true);
        expect(guild.isPartnered).toBe(true);
        expect(guild.isVerified).toBe(false);
        expect(guild.isBoosted).toBe(true);
        expect(guild.boostLevel).toBe(2);
        expect(guild.vanityURL).toBe("https://discord.gg/lunibee");
    });

    test("Role exposes colorHex, mention and PermissionsBitField", () => {
        const role = new Role({
            id: "5",
            name: "Mods",
            color: 0x3498db,
            permissions: "8",
        });
        expect(role.colorHex).toBe("#3498DB");
        expect(String(role)).toBe("<@&5>");
        expect(role.permissions.has("Administrator")).toBe(true);
    });

    test("GuildMember resolves display name and timeout state", () => {
        const future = new Date(Date.now() + 60_000).toISOString();
        const member = new GuildMember({
            user: { id: "9", username: "bob" },
            guild_id: "1",
            nick: "Bobby",
            roles: ["5"],
            communication_disabled_until: future,
        });
        expect(member.displayName).toBe("Bobby");
        expect(member.isTimedOut).toBe(true);
        expect(member.roleIds).toEqual(["5"]);
        // roleIds is a defensive copy of the payload.
        member.roleIds.push("6");
        expect(member.roleIds).toEqual(["5", "6"]);
    });
});
