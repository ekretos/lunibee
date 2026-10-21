---
title: Installation
description: How to install and set up Lunibee in your Bun project.
---


Lunibee is designed to be used with the [Bun](https://bun.sh/) runtime.

## Prerequisites

Ensure you have Bun installed on your machine (`v1.4.0` or later):

```bash
bun --version
```

If you need to install Bun:

```bash
# macOS and Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

## Starting a new project

Scaffold a bot with the [CLI](/packages/cli/): commands and events found at runtime under
`src/commands` and `src/events`, and commands registered with Discord on every start.

```bash
bunx @lunibee/cli init my-bot
cd my-bot
bun install
```

## Adding Lunibee

Inside your project directory, add `lunibee`:

```bash
bun add lunibee
```

### TypeScript Configuration

Lunibee requires modern TypeScript settings. Create or update your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun"]
  }
}
```

## Modular Installation (Optional)

If you only need specific packages (for example, just the REST client or builders for edge serverless functions):

```bash
bun add @lunibee/rest @lunibee/builders
```
