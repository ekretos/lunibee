# @lunibee/formatters

> Helpers for Discord markdown, mentions and timestamps.

```bash
bun add @lunibee/formatters
```

```ts
import {
    bold,
    codeBlock,
    userMention,
    timestamp,
    bulletList,
    escapeMarkdown,
} from "@lunibee/formatters";

const text = [
    `${bold("Welcome")} ${userMention("123456789012345678")}!`,
    `Event starts ${timestamp(Math.floor(Date.now() / 1000) + 3600, "R")}`,
    bulletList("Read the rules", "Pick a role"),
    codeBlock("console.log('hi')", "ts"),
    escapeMarkdown("*not bold*"),
].join("\n");
console.log(text);
```

## Functions

- Mentions: `userMention`, `channelMention`, `roleMention` (IDs are validated as snowflakes).
- Timestamps: `timestamp(unixSeconds, style?)` with styles `t`, `T`, `d`, `D`, `f`, `F`, `R`.
- Markdown: `bold`, `italic`, `underline`, `strikethrough`, `spoiler` / `masked`,
  `inlineCode`, `codeBlock`, `link`, `blockQuote`, `heading`, `subtext`, `orderedList`,
  `bulletList`, `escapeMarkdown`.
