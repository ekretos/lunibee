import { expect, test } from "bun:test";
import {
    CreateContainer,
    CreateSection,
    CreateTextDisplay,
    CreateMediaGallery,
    CreateFileComponent,
    CreateSeparator,
    CreateThumbnail,
    CreateContentInventoryEntry,
    ComponentEnum,
} from "../packages/builders/src/components.js";

test("Components V2 Builders > all builders serialize correctly and validate", () => {
    const container = new CreateContainer()
        .setAccentColor(0xff0000)
        .addComponents(
            new CreateSection()
                .addComponents(
                    new CreateTextDisplay().setContent("Hello world"),
                )
                .setAccessory(
                    new CreateFileComponent().setUrl("attachment://test.png"),
                ),
            new CreateSeparator().setSpacing(2),
            new CreateMediaGallery().addItems({
                url: "https://example.com/image.png",
                description: "test",
            }),
            new CreateThumbnail().setUrl("https://example.com/thumb.png"),
            new CreateContentInventoryEntry().setId("123456"),
        );

    expect(container.toJSON()).toEqual({
        type: ComponentEnum.Container,
        accent_color: 0xff0000,
        components: [
            {
                type: ComponentEnum.Section,
                components: [
                    {
                        type: ComponentEnum.TextDisplay,
                        content: "Hello world",
                    },
                ],
                accessory: {
                    type: ComponentEnum.File,
                    file: { url: "attachment://test.png" },
                },
            },
            {
                type: ComponentEnum.Separator,
                spacing: 2,
            },
            {
                type: ComponentEnum.MediaGallery,
                items: [
                    {
                        media: {
                            url: "https://example.com/image.png",
                            description: "test",
                        },
                    },
                ],
            },
            {
                type: ComponentEnum.Thumbnail,
                url: "https://example.com/thumb.png",
            },
            {
                type: ComponentEnum.ContentInventoryEntry,
                id: "123456",
            },
        ],
    });

    // Validation throws
    expect(() => new CreateContainer().addComponents()).toThrow();
    expect(() => new CreateContainer().setAccentColor(-1)).toThrow();
    expect(() => new CreateSection().addComponents()).toThrow();
    expect(() => new CreateTextDisplay().setContent("")).toThrow();
    const gallery = new CreateMediaGallery();
    expect(() =>
        gallery.addItems(...new Array(11).fill({ url: "test" })),
    ).toThrow();
    expect(() => new CreateFileComponent().setUrl("")).toThrow();
    expect(() => new CreateThumbnail().setUrl("")).toThrow();
    expect(() => new CreateContentInventoryEntry().setId("")).toThrow();
});
