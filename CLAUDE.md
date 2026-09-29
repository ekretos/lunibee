# CLAUDE.md

@AGENT.md

Follow every rule in AGENT.md above. This file adds the planned work that
future sessions should pick up.

## Next release: 0.2.2 (planned)

Small, general, non-breaking. Each item needs code, a test that keeps
per-file coverage at the CI threshold, and a docs update (reference page +
changelog), following the release checklist in AGENT.md. Found by comparing
Lunibee with the closed issues of Lilybird, another Bun-first library.

1. **User and Message context-menu commands.**
   - Today `Interaction.isChatInputCommand()` is true for every application
     command (`type === 2`), including context menus.
   - Add `isUserContextMenuCommand()` / `isMessageContextMenuCommand()` (and
     `isContextMenuCommand()`), keyed on `data.type` (2 user, 3 message), and
     make `isChatInputCommand()` true only for `data.type === 1`.
   - Add `targetId`, `targetUser` (from `resolved.users`), `targetMember`
     (from `resolved.members`, attached to the client context) and
     `targetMessage` (a `Message` from `resolved.messages`).
   - Document the `isChatInputCommand()` narrowing as a behaviour change.
2. **Client-wide default `allowed_mentions`.**
   - `ClientOptions.allowedMentions` (Discord shape, e.g. `{ parse: [] }`),
     applied to every message payload the client sends (channel send/edit,
     message reply, interaction reply/edit/follow-up/update, webhooks) when
     the payload has no `allowed_mentions` of its own.
   - A per-message `allowed_mentions` always wins.
3. **Export the CDN helpers.** `CDN_BASE` and `cdnURL()` are defined in
   `packages/structures/src/base.ts` but not exported from
   `@lunibee/structures` (or `lunibee`). Export them (and `ImageURLOptions`
   if missing).
4. **`reply({ withResponse: true })` returns the message.**
   - Discord's interaction callback accepts `?with_response=true` and then
     returns the created message.
   - Support it on `reply()` / `update()` (and deferred variants) and return
     a `Message`, instead of the empty callback response; `fetchReply()` stays.

Not planned: a "cache flow" guide beyond the existing Caching & Structures
page, and anything Lilybird-specific (rebranding).
