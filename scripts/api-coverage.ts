/**
 * Compares Discord's REST routes with the paths `Routes` can build, and writes
 * the result to docs/audits/api-coverage.md.
 *
 *   bun scripts/api-coverage.ts          write the report
 *   bun scripts/api-coverage.ts --check  fail when the committed report is stale
 *
 * The route list below is Discord's v10 reference, typed in by hand. Routes whose
 * last segment may be `@me` (thread members, voice states) appear once, as `{id}`,
 * because one builder takes both. Update it
 * when Discord adds routes, then rerun. "Covered" means `Routes` has a builder
 * for that path; whether a manager wraps it is listed in the report notes.
 */
import { Routes } from "../packages/rest/src/routes.ts";

interface Topic {
    name: string;
    routes: string[];
    /** Why routes that are not covered are left out. */
    notPlanned?: Record<string, string>;
}

const TOPICS: Topic[] = [
    {
        name: "Application commands",
        routes: [
            "GET /applications/{id}/commands",
            "POST /applications/{id}/commands",
            "GET /applications/{id}/commands/{id}",
            "PATCH /applications/{id}/commands/{id}",
            "DELETE /applications/{id}/commands/{id}",
            "PUT /applications/{id}/commands",
            "GET /applications/{id}/guilds/{id}/commands",
            "POST /applications/{id}/guilds/{id}/commands",
            "GET /applications/{id}/guilds/{id}/commands/{id}",
            "PATCH /applications/{id}/guilds/{id}/commands/{id}",
            "DELETE /applications/{id}/guilds/{id}/commands/{id}",
            "PUT /applications/{id}/guilds/{id}/commands",
            "GET /applications/{id}/guilds/{id}/commands/permissions",
            "GET /applications/{id}/guilds/{id}/commands/{id}/permissions",
        ],
        notPlanned: {
            "/applications/{id}/guilds/{id}/commands/permissions":
                "Command permissions can only be edited with a user's OAuth2 token, never a bot's.",
            "/applications/{id}/guilds/{id}/commands/{id}/permissions":
                "Command permissions can only be edited with a user's OAuth2 token, never a bot's.",
        },
    },
    {
        name: "Application, emojis, SKUs and entitlements",
        routes: [
            "GET /applications/{id}/emojis",
            "POST /applications/{id}/emojis",
            "GET /applications/{id}/emojis/{id}",
            "PATCH /applications/{id}/emojis/{id}",
            "DELETE /applications/{id}/emojis/{id}",
            "GET /applications/{id}/skus",
            "GET /applications/{id}/entitlements",
            "POST /applications/{id}/entitlements",
            "GET /applications/{id}/entitlements/{id}",
            "DELETE /applications/{id}/entitlements/{id}",
            "POST /applications/{id}/entitlements/{id}/consume",
            "GET /skus/{id}/subscriptions",
            "GET /skus/{id}/subscriptions/{id}",
        ],
    },
    {
        name: "Interactions and webhooks",
        routes: [
            "POST /interactions/{id}/{id}/callback",
            "GET /webhooks/{id}/{id}/messages/@original",
            "PATCH /webhooks/{id}/{id}/messages/@original",
            "DELETE /webhooks/{id}/{id}/messages/@original",
            "POST /webhooks/{id}/{id}",
            "GET /webhooks/{id}/{id}/messages/{id}",
            "PATCH /webhooks/{id}/{id}/messages/{id}",
            "DELETE /webhooks/{id}/{id}/messages/{id}",
            "GET /webhooks/{id}",
            "GET /webhooks/{id}/{id}",
            "PATCH /webhooks/{id}",
            "DELETE /webhooks/{id}",
            "POST /channels/{id}/webhooks",
            "GET /channels/{id}/webhooks",
            "GET /guilds/{id}/webhooks",
        ],
    },
    {
        name: "Channels, messages, pins and reactions",
        routes: [
            "GET /channels/{id}",
            "PATCH /channels/{id}",
            "DELETE /channels/{id}",
            "GET /channels/{id}/messages",
            "GET /channels/{id}/messages/{id}",
            "POST /channels/{id}/messages",
            "POST /channels/{id}/messages/{id}/crosspost",
            "PUT /channels/{id}/messages/{id}/reactions/{id}/@me",
            "DELETE /channels/{id}/messages/{id}/reactions/{id}/@me",
            "DELETE /channels/{id}/messages/{id}/reactions/{id}/{id}",
            "GET /channels/{id}/messages/{id}/reactions/{id}",
            "DELETE /channels/{id}/messages/{id}/reactions",
            "DELETE /channels/{id}/messages/{id}/reactions/{id}",
            "PATCH /channels/{id}/messages/{id}",
            "DELETE /channels/{id}/messages/{id}",
            "POST /channels/{id}/messages/bulk-delete",
            "PUT /channels/{id}/permissions/{id}",
            "DELETE /channels/{id}/permissions/{id}",
            "GET /channels/{id}/invites",
            "POST /channels/{id}/invites",
            "POST /channels/{id}/followers",
            "POST /channels/{id}/typing",
            "GET /channels/{id}/messages/pins",
            "PUT /channels/{id}/messages/pins/{id}",
            "DELETE /channels/{id}/messages/pins/{id}",
            "PUT /channels/{id}/recipients/{id}",
            "DELETE /channels/{id}/recipients/{id}",
        ],
        notPlanned: {
            "/channels/{id}/followers":
                "Following an announcement channel is a user action; bots rarely need it.",
            "/channels/{id}/recipients/{id}":
                "Group DM management needs a user's OAuth2 token.",
        },
    },
    {
        name: "Threads, forums and polls",
        routes: [
            "POST /channels/{id}/messages/{id}/threads",
            "POST /channels/{id}/threads",
            "POST /channels/{id}/forum-posts",
            "PUT /channels/{id}/thread-members/{id}",
            "DELETE /channels/{id}/thread-members/{id}",
            "GET /channels/{id}/thread-members/{id}",
            "GET /channels/{id}/thread-members",
            "GET /guilds/{id}/threads/active",
            "GET /channels/{id}/threads/archived/public",
            "GET /channels/{id}/threads/archived/private",
            "GET /channels/{id}/users/@me/threads/archived/private",
            "GET /channels/{id}/polls/{id}/answers/{id}",
            "POST /channels/{id}/polls/{id}/expire",
        ],
        notPlanned: {
            "/channels/{id}/forum-posts":
                "Not a Discord route: forum posts are created with `POST /channels/{id}/threads` and a `message` body.",
        },
    },
    {
        name: "Guilds",
        routes: [
            "POST /guilds",
            "GET /guilds/{id}",
            "GET /guilds/{id}/preview",
            "PATCH /guilds/{id}",
            "DELETE /guilds/{id}",
            "GET /guilds/{id}/channels",
            "POST /guilds/{id}/channels",
            "PATCH /guilds/{id}/channels",
            "GET /guilds/{id}/members/{id}",
            "GET /guilds/{id}/members",
            "GET /guilds/{id}/members/search",
            "PUT /guilds/{id}/members/{id}",
            "PATCH /guilds/{id}/members/{id}",
            "PATCH /guilds/{id}/members/@me",
            "PUT /guilds/{id}/members/{id}/roles/{id}",
            "DELETE /guilds/{id}/members/{id}/roles/{id}",
            "DELETE /guilds/{id}/members/{id}",
            "GET /guilds/{id}/bans",
            "GET /guilds/{id}/bans/{id}",
            "PUT /guilds/{id}/bans/{id}",
            "DELETE /guilds/{id}/bans/{id}",
            "POST /guilds/{id}/bulk-ban",
            "GET /guilds/{id}/roles",
            "GET /guilds/{id}/roles/{id}",
            "POST /guilds/{id}/roles",
            "PATCH /guilds/{id}/roles",
            "PATCH /guilds/{id}/roles/{id}",
            "DELETE /guilds/{id}/roles/{id}",
            "GET /guilds/{id}/prune",
            "POST /guilds/{id}/prune",
            "GET /guilds/{id}/regions",
            "GET /guilds/{id}/invites",
            "GET /guilds/{id}/integrations",
            "DELETE /guilds/{id}/integrations/{id}",
            "GET /guilds/{id}/widget",
            "PATCH /guilds/{id}/widget",
            "GET /guilds/{id}/vanity-url",
            "GET /guilds/{id}/welcome-screen",
            "PATCH /guilds/{id}/welcome-screen",
            "GET /guilds/{id}/onboarding",
            "PUT /guilds/{id}/onboarding",
            "PATCH /guilds/{id}/voice-states/{id}",
            "GET /guilds/{id}/audit-logs",
            "POST /guilds/{id}/mfa",
            "GET /guilds/{id}/incident-actions",
            "PUT /guilds/{id}/incident-actions",
        ],
        notPlanned: {
            "/guilds":
                "Creating guilds is limited to bots in fewer than 10 guilds.",
            "/guilds/{id}/members/{id}": "",
            "/guilds/{id}/widget":
                "The widget settings are rarely automated; use `rest` directly.",
            "/guilds/{id}/mfa":
                "Needs the guild owner's account; a bot cannot use it.",
            "/guilds/{id}/integrations":
                "Integrations are managed by users; read them with `rest` if needed.",
            "/guilds/{id}/incident-actions":
                "New and rarely needed; use `rest` directly.",
            "/guilds/{id}/regions": "Deprecated by Discord's voice regions.",
        },
    },
    {
        name: "Scheduled events, AutoMod, stages, soundboard, emojis, stickers",
        routes: [
            "GET /guilds/{id}/scheduled-events",
            "POST /guilds/{id}/scheduled-events",
            "GET /guilds/{id}/scheduled-events/{id}",
            "PATCH /guilds/{id}/scheduled-events/{id}",
            "DELETE /guilds/{id}/scheduled-events/{id}",
            "GET /guilds/{id}/scheduled-events/{id}/users",
            "GET /guilds/{id}/auto-moderation/rules",
            "GET /guilds/{id}/auto-moderation/rules/{id}",
            "POST /guilds/{id}/auto-moderation/rules",
            "PATCH /guilds/{id}/auto-moderation/rules/{id}",
            "DELETE /guilds/{id}/auto-moderation/rules/{id}",
            "POST /stage-instances",
            "GET /stage-instances/{id}",
            "PATCH /stage-instances/{id}",
            "DELETE /stage-instances/{id}",
            "GET /guilds/{id}/emojis",
            "GET /guilds/{id}/emojis/{id}",
            "POST /guilds/{id}/emojis",
            "PATCH /guilds/{id}/emojis/{id}",
            "DELETE /guilds/{id}/emojis/{id}",
            "GET /stickers/{id}",
            "GET /sticker-packs",
            "GET /sticker-packs/{id}",
            "GET /guilds/{id}/stickers",
            "GET /guilds/{id}/stickers/{id}",
            "POST /guilds/{id}/stickers",
            "PATCH /guilds/{id}/stickers/{id}",
            "DELETE /guilds/{id}/stickers/{id}",
            "POST /channels/{id}/send-soundboard-sound",
            "GET /soundboard-default-sounds",
            "GET /guilds/{id}/soundboard-sounds",
            "GET /guilds/{id}/soundboard-sounds/{id}",
            "POST /guilds/{id}/soundboard-sounds",
            "PATCH /guilds/{id}/soundboard-sounds/{id}",
            "DELETE /guilds/{id}/soundboard-sounds/{id}",
        ],
    },
    {
        name: "Users, invites, gateway and voice",
        routes: [
            "GET /users/@me",
            "GET /users/{id}",
            "PATCH /users/@me",
            "GET /users/@me/guilds",
            "GET /users/@me/guilds/{id}/member",
            "DELETE /users/@me/guilds/{id}",
            "POST /users/@me/channels",
            "GET /users/@me/connections",
            "GET /users/@me/applications/{id}/role-connection",
            "PUT /users/@me/applications/{id}/role-connection",
            "GET /invites/{id}",
            "DELETE /invites/{id}",
            "GET /voice/regions",
            "GET /gateway",
            "GET /gateway/bot",
            "GET /applications/@me",
            "PATCH /applications/@me",
            "GET /oauth2/applications/@me",
            "GET /oauth2/@me",
        ],
        notPlanned: {
            "/users/@me/connections": "Needs a user's OAuth2 token.",
            "/users/@me/applications/{id}/role-connection":
                "Needs a user's OAuth2 token.",
            "/oauth2/@me": "Needs a user's OAuth2 token.",
            "/oauth2/applications/@me": "Same as `GET /applications/@me`.",
            "/users/@me/guilds/{id}/member": "Needs a user's OAuth2 token.",
            "/applications/@me":
                "Covered by `bot.api.applications('@me')`; no dedicated builder.",
            "/users/@me/channels":
                "Covered by `bot.api.users('@me').channels` and `ChannelManager.createDM`.",
        },
    },
];

/** `/channels/{id}/messages` for every path, comparable across both sides. */
function normalize(path: string): string {
    return (
        path
            .split("?")[0]!
            .replace(/\{[^}]+\}/g, "{id}")
            .replace(/\/\d+(?=\/|$)/g, "/{id}")
            // Path parameters that are not snowflakes in our dummy calls.
            .replace(/\/(token|code|emoji|dummy)(?=\/|$)/g, "/{id}")
    );
}

/** Every path `Routes` can build, normalised. */
function built(): Set<string> {
    const dummy = "100000000000000001";
    const paths = new Set<string>();
    for (const builder of Object.values(Routes) as Array<
        (...args: string[]) => string
    >) {
        if (typeof builder !== "function") continue;
        // Optional trailing parameters change the path, so try every arity.
        for (let count = builder.length; count >= 0; count--) {
            // Some parameters are integers (poll answers), some are ids.
            for (const value of [dummy, 1] as unknown[]) {
                try {
                    paths.add(
                        normalize(
                            builder(
                                ...(Array.from(
                                    { length: count },
                                    () => value,
                                ) as string[]),
                            ),
                        ),
                    );
                } catch {
                    // Not a path for these arguments.
                }
            }
        }
    }
    return paths;
}

const have = built();
const lines: string[] = [];
let covered = 0;
let missing = 0;
let notPlanned = 0;
const gaps: string[] = [];

for (const topic of TOPICS) {
    const rows: string[] = [];
    for (const route of topic.routes) {
        const [method, path] = route.split(" ") as [string, string];
        const key = normalize(path);
        let status: string;
        if (have.has(key)) {
            status = "covered";
            covered++;
        } else if (topic.notPlanned && key in topic.notPlanned) {
            const reason = topic.notPlanned[key];
            status = reason ? `not planned: ${reason}` : "covered";
            if (reason) notPlanned++;
            else covered++;
        } else {
            status = "**gap**";
            missing++;
            gaps.push(route);
        }
        rows.push(`| \`${method}\` | \`${path}\` | ${status} |`);
    }
    lines.push(
        `## ${topic.name}\n\n| Method | Route | Status |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
    );
}

const report = `# REST API coverage

Generated by \`bun scripts/api-coverage.ts\`; do not edit by hand. "Covered" means
\`Routes\` can build the path (methods share a path, so \`GET\` and \`DELETE\` of one
route count together). Anything not covered can still be called with
\`bot.api.to(...)\` or \`rest.request()\`.

**${covered} covered, ${notPlanned} not planned, ${missing} gaps** (of ${covered + notPlanned + missing} routes).

${gaps.length ? `Gaps:\n\n${gaps.map((g) => `- \`${g}\``).join("\n")}\n\n` : ""}${lines.join("\n")}`;

const target = new URL("../docs/audits/api-coverage.md", import.meta.url);
if (process.argv.includes("--check")) {
    const current = await Bun.file(target).text();
    if (current !== report) {
        console.error(
            "docs/audits/api-coverage.md is out of date: run `bun scripts/api-coverage.ts`.",
        );
        process.exit(1);
    }
    console.log("API coverage report is current.");
} else {
    await Bun.write(target, report);
    console.log(
        `${covered} covered, ${notPlanned} not planned, ${missing} gaps.`,
    );
}
