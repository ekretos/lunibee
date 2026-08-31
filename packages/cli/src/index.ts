#!/usr/bin/env bun

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..", "..");
const packagesDir = join(root, "packages");

/** Discord client events supported by the handler generator. */
const gatewayEvents = [
  "ready", "raw", "error", "open", "close",
  "messageCreate", "messageUpdate", "messageDelete", "messageDeleteBulk",
  "guildCreate", "guildUpdate", "guildDelete",
  "channelCreate", "channelUpdate", "channelDelete",
  "threadCreate", "threadUpdate", "threadDelete",
  "guildMemberAdd", "guildMemberUpdate", "guildMemberRemove",
  "messageReactionAdd", "messageReactionRemove", "messageReactionRemoveAll",
  "interactionCreate", "guildRoleCreate", "guildRoleUpdate", "guildRoleDelete",
  "guildBanAdd", "guildBanRemove", "guildEmojisUpdate",
] as const;

type GatewayEvent = (typeof gatewayEvents)[number];

interface PublishConfig { access?: string; registry?: string; }
interface PackageManifest { name: string; version: string; private?: boolean; publishConfig?: PublishConfig; }
interface PublishablePackage { directory: string; manifest: PackageManifest; }

/** Reads a package manifest when it exists and is valid JSON. */
async function readManifest(directory: string): Promise<PackageManifest | null> {
  try {
    const file = Bun.file(join(directory, "package.json"));
    if (!(await file.exists())) return null;
    return (await file.json()) as PackageManifest;
  } catch { return null; }
}

/** Finds all non-private workspace packages that can be published. */
async function getPublishablePackages(): Promise<PublishablePackage[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const result: PublishablePackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(packagesDir, entry.name);
    const manifest = await readManifest(directory);
    if (!manifest?.name || !manifest.version || manifest.private) continue;
    result.push({ directory, manifest });
  }
  return result.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/** Runs a child process and forwards its standard streams. */
async function run(command: string[], cwd: string): Promise<void> {
  const childProcess = Bun.spawn(command, {
    cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit", env: globalThis.process.env,
  });
  const exitCode = await childProcess.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
}

/** Publishes every public workspace package in deterministic order. */
async function publish(): Promise<void> {
  const packages = await getPublishablePackages();
  if (packages.length === 0) return void console.log("No publishable packages found.");
  console.log(`Publishing ${packages.length} Lunibee packages...`);
  for (const { directory, manifest } of packages) {
    console.log(`\n→ ${manifest.name}@${manifest.version}`);
    await run(["bun", "publish", "--access", manifest.publishConfig?.access ?? "public"], directory);
  }
  console.log("\n✓ Lunibee packages published successfully.");
}

/** Prints the names and versions of all publishable packages. */
async function status(): Promise<void> {
  for (const { manifest } of await getPublishablePackages()) console.log(`${manifest.name}@${manifest.version}`);
}

/** Converts an event or handler name into a safe TypeScript identifier. */
function identifier(value: string): string {
  const result = value.replace(/[^a-zA-Z0-9_$]/g, "_");
  return /^[a-zA-Z_$]/.test(result) ? result : `handler_${result}`;
}

/** Converts a handler name into a safe file name. */
function fileName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!normalized) throw new Error("Handler name cannot be empty.");
  return normalized.endsWith(".ts") ? normalized : `${normalized}.ts`;
}

/** Creates a strongly typed handler using Lunibee's ClientEvents map. */
function handlerSource(event: GatewayEvent, handler: string): string {
  const name = identifier(handler.replace(/\.ts$/, ""));
  return `import type { ClientEvents } from "lunibee";\n\n/** Handles the ${event} event. */\nexport default async function ${name}(...args: ClientEvents["${event}"]): Promise<void> {\n  const [payload] = args;\n\n  // Add your ${event} logic here.\n  void payload;\n}\n`;
}

interface HandlerEntry { event: GatewayEvent; path: string; importName: string; }

/** Discovers every generated handler below src/events/<event>/. */
async function discoverHandlers(eventsDir: string): Promise<HandlerEntry[]> {
  const result: HandlerEntry[] = [];
  let eventEntries: import("node:fs").Dirent[];
  try { eventEntries = await readdir(eventsDir, { withFileTypes: true }); } catch { return result; }
  for (const eventEntry of eventEntries) {
    if (!eventEntry.isDirectory() || !(gatewayEvents as readonly string[]).includes(eventEntry.name)) continue;
    const event = eventEntry.name as GatewayEvent;
    const handlers = await readdir(join(eventsDir, event), { withFileTypes: true });
    for (const entry of handlers) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const handler = entry.name.slice(0, -3);
      result.push({ event, path: `../events/${event}/${handler}`, importName: identifier(`${event}_${handler}`) });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

/** Regenerates handlers/event.ts from every handler under src/events/. */
async function updateEventBinder(eventsDir: string, handlersDir: string): Promise<void> {
  const handlers = await discoverHandlers(eventsDir);
  await mkdir(handlersDir, { recursive: true });
  const imports = handlers.map(({ path, importName }) => `import ${importName} from "${path}";`).join("\n");
  const bindings = handlers.map(({ event, importName }) => `  client.on("${event}", ${importName});`).join("\n");
  const content = `import type { Client } from "lunibee";\n${imports ? `\n${imports}` : ""}\n\n/** Registers every handler found under src/events with a Lunibee client. */\nexport function registerEvents(client: Client): void {\n${bindings}\n}\n`;
  await writeFile(join(handlersDir, "event.ts"), content);
  console.log(`  ✓ updated handlers/event.ts (${handlers.length} handler${handlers.length === 1 ? "" : "s"})`);
}

/** Creates one named handler file without overwriting an existing file. */
async function createHandlerFile(eventsDir: string, event: GatewayEvent, handler: string): Promise<void> {
  const directory = join(eventsDir, event);
  const target = join(directory, fileName(handler));
  const targetName = fileName(handler);
  await mkdir(directory, { recursive: true });
  if (await Bun.file(target).exists()) {
    console.log(`  ↳ skipped ${event}/${targetName} (already exists)`);
    return;
  }
  await writeFile(target, handlerSource(event, handler));
  console.log(`  ✓ created events/${event}/${targetName}`);
}

/** Prompts for events and creates one or more named handlers for each selected event. */
async function createHandler(): Promise<void> {
  console.log("\n🐝 Lunibee Handler Generator\n");
  console.log("Select events by number (comma-separated), or type 'all':\n");
  gatewayEvents.forEach((event, index) => console.log(`  ${String(index + 1).padStart(2, " ")}. ${event}`));
  const answer = prompt("\nEvents: ")?.trim().toLowerCase();
  if (!answer) return void console.log("No events selected.");

  const selected = answer === "all"
    ? [...gatewayEvents]
    : [...new Set(answer.split(",").map((value) => Number.parseInt(value.trim(), 10) - 1))]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < gatewayEvents.length)
        .map((index) => gatewayEvents[index]);
  if (selected.length === 0) throw new Error("No valid events were selected.");

  const eventsDir = join(process.cwd(), "src", "events");
  const handlersDir = join(process.cwd(), "src", "handlers");
  await mkdir(eventsDir, { recursive: true });

  for (const event of selected) {
    const existing = await discoverHandlers(join(eventsDir, event));
    const defaultName = existing.length ? "handler" : event;
    const handler = prompt(`Handler name for ${event} [${defaultName}]: `)?.trim() || defaultName;
    await createHandlerFile(eventsDir, event, handler);
  }

  await updateEventBinder(eventsDir, handlersDir);
  console.log("\n✓ Handler generation complete.");
}

const command = Bun.argv[2] ?? "help";
const subcommand = Bun.argv[3];
try {
  if (command === "create" && subcommand === "handler") await createHandler();
  else switch (command) {
    case "publish": await publish(); break;
    case "status": await status(); break;
    case "help": case "--help": case "-h":
      console.log("Lunibee CLI\n\nCommands:\n  lunibee create handler   Create event handler files interactively\n  lunibee publish          Publish all public workspace packages to npm\n  lunibee status           List publishable packages and versions");
      break;
    default: console.error(`Unknown command: ${Bun.argv.slice(2).join(" ")}`); process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
