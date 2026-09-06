import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const site = process.env.ASTRO_SITE || "https://lunibee.js.org";
const base = process.env.ASTRO_BASE || undefined;

export default defineConfig({
  site,
  base,
  integrations: [
    starlight({
      title: "Lunibee 🐝",
      description: "A lightweight, Bun-first Discord API library for TypeScript.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Ekretos/lunibee",
        },
        {
          icon: "discord",
          label: "Discord",
          href: "https://discord.gg/SSADgyBpgw",
        },
      ],
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", link: "/getting-started/introduction" },
            { label: "Installation", link: "/getting-started/installation" },
            { label: "Creating a Bot", link: "/getting-started/creating-a-bot" },
            { label: "Quick Start", link: "/getting-started/quick-start" },
            { label: "Changelog", link: "/getting-started/changelog" },
          ],
        },
        {
          label: "Core Concepts",
          items: [
            { label: "Client & Lifecycle", link: "/core-concepts/client" },
            { label: "Gateway & WebSocket", link: "/core-concepts/gateway" },
            { label: "REST & Rate Limits", link: "/core-concepts/rest" },
            { label: "Caching & Structures", link: "/core-concepts/caching" },
            { label: "Permissions", link: "/core-concepts/permissions" },
            { label: "Interactions & Commands", link: "/core-concepts/interactions" },
            { label: "Component & Embed Builders", link: "/core-concepts/builders" },
            { label: "Sharding", link: "/core-concepts/sharding" },
            { label: "Voice", link: "/core-concepts/voice" },
          ],
        },
        {
          label: "API Reference",
          collapsed: false,
          items: [
            { label: "Architecture Overview", link: "/packages/overview" },
            { label: "@lunibee/core", link: "/packages/core" },
            { label: "@lunibee/ws", link: "/packages/ws" },
            { label: "@lunibee/rest", link: "/packages/rest" },
            { label: "@lunibee/builders", link: "/packages/builders" },
            { label: "@lunibee/managers", link: "/packages/managers" },
            { label: "@lunibee/structures", link: "/packages/structures" },
            { label: "@lunibee/collection", link: "/packages/collection" },
            { label: "@lunibee/sharding", link: "/packages/sharding" },
            { label: "@lunibee/formatters", link: "/packages/formatters" },
            { label: "@lunibee/voice", link: "/packages/voice" },
            { label: "@lunibee/utils", link: "/packages/utils" },
            { label: "@lunibee/types", link: "/packages/types" },
          ],
        },
        {
          label: "Class Reference",
          collapsed: true,
          items: [
            {
              label: "Client & Core",
              items: [
                { label: "Client", link: "/reference/client" },
                { label: "ClientEvent", link: "/reference/client-event" },
                { label: "Collector", link: "/reference/collector" },
                { label: "PermissionSet", link: "/reference/permission-set" },
              ],
            },
            {
              label: "Structures",
              items: [
                { label: "Message", link: "/reference/message" },
                { label: "Channel", link: "/reference/channel" },
                { label: "Guild", link: "/reference/guild" },
                { label: "User", link: "/reference/user" },
                { label: "GuildMember", link: "/reference/guild-member" },
                { label: "Role", link: "/reference/role" },
                { label: "Interactions", link: "/reference/interactions" },
              ],
            },
            {
              label: "Builders",
              items: [
                { label: "EmbedBuilder", link: "/reference/embed-builder" },
                { label: "ActionRowBuilder", link: "/reference/action-row-builder" },
                { label: "ButtonBuilder", link: "/reference/button-builder" },
                { label: "StringSelectBuilder", link: "/reference/string-select-builder" },
                { label: "ModalBuilder & TextInputBuilder", link: "/reference/modal-builder" },
                { label: "SlashCommandBuilder", link: "/reference/slash-command-builder" },
                { label: "AttachmentBuilder", link: "/reference/attachment-builder" },
                { label: "Components V2", link: "/reference/components-v2" },
              ],
            },
            {
              label: "REST & Gateway",
              items: [
                { label: "REST & Routes", link: "/reference/rest" },
                { label: "Gateway", link: "/reference/gateway" },
              ],
            },
            {
              label: "Collection & Cache",
              items: [
                { label: "Collection", link: "/reference/collection" },
                { label: "Cache", link: "/reference/cache" },
              ],
            },
            {
              label: "Constants",
              items: [
                { label: "IntentBits", link: "/reference/intent-bits" },
              ],
            },
            {
              label: "Sharding",
              items: [
                { label: "ShardManager", link: "/reference/shard-manager" },
              ],
            },
            {
              label: "Voice",
              items: [
                { label: "VoiceConnection & AudioPlayer", link: "/reference/voice-connection" },
              ],
            },
            {
              label: "Utilities",
              items: [
                { label: "Formatters", link: "/reference/formatters" },
                { label: "Utils", link: "/reference/utils" },
              ],
            },
          ],
        },
        {
          label: "Guides & Recipes",
          items: [
            { label: "Slash Command Deployment", link: "/recipes/slash-commands" },
            { label: "Buttons & Select Menus", link: "/recipes/buttons-and-selects" },
            { label: "Modals & Form Inputs", link: "/recipes/modals" },
            { label: "Paginator Component", link: "/recipes/paginators" },
            { label: "Graceful Shutdown", link: "/recipes/graceful-shutdown" },
            { label: "Error Handling & Retries", link: "/recipes/error-handling" },
          ],
        },
      ],
    }),
  ],
});
