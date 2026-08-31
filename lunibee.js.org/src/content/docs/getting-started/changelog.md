---
title: Changelog
description: Lunibee version history and release notes.
---

## v0.1.6

### 🎉 Major Highlights

* **Component Builders V2**: Introduced a modern, chainable builder pattern for message components (inspired by Discord.js). Added `ActionRowBuilder`, `ButtonBuilder`, and `StringSelectMenuBuilder` for creating rich UIs effortlessly.

  ```typescript
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("primary-btn")
      .setLabel("Click Me!")
      .setStyle(1) // Primary
  );
  ```
* **💯 100% Test Coverage**: The entire Lunibee monorepo has been rigorously tested and now officially boasts **100% line and function coverage** across all packages!

### ✨ Features & Resource APIs
* **REST Multipart Support**: Added `postWithFiles` and `patchWithFiles` to the REST client, bringing first-class support for attachments and raw form data payloads.

  ```typescript
  await rest.postWithFiles("/channels/123/messages", { content: "Here is your file!" }, [
    { name: "image.png", data: fileBuffer, contentType: "image/png" }
  ]);
  ```
* **Direct Resource Operations**: You can now perform intuitive actions directly on structures. Channels and messages are now properly hydrated with the client context.
  ```typescript del={2,3} ins={5,6}
  // Previously: Context-based operations
  await context.editChannel(channel.id, { name: "general" });
  await context.sendMessage(message.channelId, { content: "Hi!" });
  // Now: Intuitive editing directly from the structure
  await channel.editName("general");
  await message.reply("Hi!");
  ```
* **Advanced Interactions**: Added full structural support and parsing for `ModalSubmitInteraction`, `AutocompleteInteraction`, and component types (11, 15, 16). Added missing getters (like `getAttachment` with required fallbacks) for Slash Command options.

  ```typescript
  // Safely extract a required attachment option
  const attachment = interaction.options.getAttachment("receipt", true);
  console.log(`Uploaded file: ${attachment.filename}`);
  ```

### 🛠️ Core & Events
* **`ClientEvent` Enum**: Introduced and exported a new `ClientEvent` enum in the `@lunibee/core` package to replace hardcoded event strings.
  ```typescript del={4,5} ins={7,8}
  import { ClientEvent } from "@lunibee/core";

  // Previously: Hardcoded strings
  client.on("messageCreate", (message) => {
  // Now: Strongly typed enums
  client.on(ClientEvent.MessageCreate, (message) => {
    console.log(message.content);
  });
  ```

### 💻 CLI & Developer Tooling
* **Interactive Tooling**: Expanded developer tooling by adding an interactive handler generator and support for multiple handlers per event. Fixed a bug to correctly detect existing event handlers.

  ```bash
  $ npx lunibee generate handler
  ? Which event would you like to handle? messageCreate
  ? Name your handler file: welcome-message
  ✔ Created src/events/messageCreate/welcome-message.ts!
  ```
* **Fix**: Fixed the CLI build process to ensure the published Lunibee binary is properly runnable.

### 📚 Documentation
* **Site & Guides**: Made the Lunibee documentation site significantly friendlier. Expanded the quick start workflow and the "package choices" overview.
* **Advanced Guides**: Wrote and expanded practical, task-focused guides for Builders, Sharding, Voice connections, Permissions, Formatters, Utilities, and common Discord types.
* **API References**: Fully documented the new application commands, channel, and message resource APIs.
* **Fixes**: Corrected gateway intent examples and API names.

## v0.1.5

* Initial public beta release containing the core client, gateway, REST API wrappers, structural representations of Discord objects, Voice components, builders, and standard interactions.
