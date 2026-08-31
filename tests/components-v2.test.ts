import { expect, test } from "bun:test";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  FileComponentBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  ContentInventoryEntryBuilder,
  ComponentType,
} from "../packages/builders/src/components.js";

test("Components V2 Builders > all builders serialize correctly and validate", () => {
  const container = new ContainerBuilder()
    .setAccentColor(0xff0000)
    .addComponents(
      new SectionBuilder()
        .addComponents(new TextDisplayBuilder().setContent("Hello world"))
        .setAccessory(new FileComponentBuilder().setUrl("attachment://test.png")),
      new SeparatorBuilder().setSpacing(2),
      new MediaGalleryBuilder().addItems({
        url: "https://example.com/image.png",
        description: "test",
      }),
      new ThumbnailBuilder().setUrl("https://example.com/thumb.png"),
      new ContentInventoryEntryBuilder().setId("123456"),
    );

  expect(container.toJSON()).toEqual({
    type: ComponentType.Container,
    accent_color: 0xff0000,
    components: [
      {
        type: ComponentType.Section,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: "Hello world",
          },
        ],
        accessory: {
          type: ComponentType.File,
          file: { url: "attachment://test.png" },
        },
      },
      {
        type: ComponentType.Separator,
        spacing: 2,
      },
      {
        type: ComponentType.MediaGallery,
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
        type: ComponentType.Thumbnail,
        url: "https://example.com/thumb.png",
      },
      {
        type: ComponentType.ContentInventoryEntry,
        id: "123456",
      },
    ],
  });

  // Validation throws
  expect(() => new ContainerBuilder().addComponents()).toThrow();
  expect(() => new ContainerBuilder().setAccentColor(-1)).toThrow();
  expect(() => new SectionBuilder().addComponents()).toThrow();
  expect(() => new TextDisplayBuilder().setContent("")).toThrow();
  const gallery = new MediaGalleryBuilder();
  expect(() =>
    gallery.addItems(...new Array(11).fill({ url: "test" })),
  ).toThrow();
  expect(() => new FileComponentBuilder().setUrl("")).toThrow();
  expect(() => new ThumbnailBuilder().setUrl("")).toThrow();
  expect(() => new ContentInventoryEntryBuilder().setId("")).toThrow();
});
