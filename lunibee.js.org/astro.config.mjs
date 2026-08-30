import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://lunibee.js.org",
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
          label: "Packages",
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
