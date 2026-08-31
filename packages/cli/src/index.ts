#!/usr/bin/env bun

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..", "..");
const packagesDir = join(root, "packages");

/** Discord gateway events supported by the handler generator. */
const gatewayEvents = [
  "ready",
  "messageCreate",
  "messageUpdate",
  "messageDelete",
  "channelCreate",
  "channelUpdate",
  "channelDelete",
  "guildCreate",
  "guildUpdate",
  "guildDelete",
  "guildMemberAdd",
  "guildMemberRemove",
  "guildMemberUpdate",
  "interactionCreate",
  "voiceStateUpdate",
  "presenceUpdate",
  "typingStart",
  "messageReactionAdd",
  "messageReactionRemove",
  "messageReactionRemoveAll",
  "threadCreate",
  "threadUpdate",
  "threadDelete",
] as const;

type GatewayEvent = (typeof gatewayEvents)[number];

interface PublishConfig {
  access?: string;
  registry?: string;
}

interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  publishConfig?: PublishConfig;
}

interface PublishablePackage {
  directory: string;
  manifest: PackageManifest;
}

/** Reads a package manifest when it exists and is valid JSON. */
async function readManifest(directory: string): Promise<PackageManifest | null> {
  try {
    const file = Bun.file(join(directory, "package.json"));
    if (!(await file.exists())) return null;
    return (await file.json()) as PackageManifest;
  } catch {
    return null;
  }
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
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: globalThis.process.env,
  });
  const exitCode = await childProcess.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
}

/** Publishes every public workspace package in deterministic order. */
async function publish(): Promise<void> {
  const packages = await getPublishablePackages();
  if (packages.length === 0) {
    console.log("No publishable packages found.");
    return;
  }

  console.log(`Publishing ${packages.length} Lunibee packages...`);
  for (const { directory, manifest } of packages) {
    console.log(`\n→ ${manifest.name}@${manifest.version}`);
    await run(["bun", "publish", "--access", manifest.publishConfig?.access ?? "public"], directory);
  }
  console.log("\n✓ Lunibee packages published successfully.");
}

/** Prints the names and versions of all publishable packages. */
async function status(): Promise<void> {
  const packages = await getPublishablePackages();
  for (const { manifest } of packages) console.log(`${manifest.name}@${manifest.version}`);
}

/** Converts an event name to a safe TypeScript identifier. */
function handlerName(event: string): string {
  return event.replace(/[^a-zA-Z0-9_$]/g, "_");
}

/** Returns the parameter signature used by a generated event handler. */
function parametersFor(event: GatewayEvent): string {
  const parameters: Record<GatewayEvent, string> = {
    ready: "client",
    messageCreate: "message",
    messageUpdate: "message, oldMessage",
    messageDelete: "message",
    channelCreate: "channel",
    channelUpdate: "channel, oldChannel",
    channelDelete: "channel",
    guildCreate: "guild",
    guildUpdate: "guild, oldGuild",
    guildDelete: "guild",
    guildMemberAdd: "member",
    guildMemberRemove: "member",
    guildMemberUpdate: "member, oldMember",
    interactionCreate: "interaction",
    voiceStateUpdate: "state, oldState",
    presenceUpdate: "presence, oldPresence",
    typingStart: "typing",
    messageReactionAdd: "reaction, user",
    messageReactionRemove: "reaction, user",
    messageReactionRemoveAll: "message",
    threadCreate: "thread",
    threadUpdate: "thread, oldThread",
    threadDelete: "thread",
  };
  return parameters[event];
}

/** Creates a handler file for an event without overwriting an existing file. */
async function createEventFile(eventsDir: string, event: GatewayEvent): Promise<boolean> {
  const path = join(eventsDir, `${event}.ts`);
  const file = Bun.file(path);
  if (await file.exists()) {
    console.log(`  ↳ skipped ${event}.ts (already exists)`);
    return false;
  }

  const parameters = parametersFor(event);
  const content = `import type { ${parameters === "client" ? "Client" : "Message"} } from "lunibee";\n\n/** Handles the ${event} event. */\nexport default async function ${handlerName(event)}(${parameters}: any): Promise<void> {\n  // Add your ${event} logic here.\n}\n`;
  await writeFile(path, content);
  console.log(`  ✓ created events/${event}.ts`);
  return true;
}

/** Updates the generated event binder while preserving all selected event imports. */
async function updateEventBinder(eventsDir: string, handlersDir: string): Promise<void> {
  const entries = await readdir(eventsDir, { withFileTypes: true });
  const events = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name.slice(0, -3))
    .filter((event): event is GatewayEvent => (gatewayEvents as readonly string[]).includes(event))
    .sort();

  await mkdir(handlersDir, { recursive: true });
  const imports = events.map((event) => `import ${handlerName(event)} from "../events/${event}";`).join("\n");
  const bindings = events.map((event) => `  client.on("${event}", ${handlerName(event)});`).join("\n");
  const content = `import type { Client } from "lunibee";\n${imports ? `\n${imports}` : ""}\n\n/** Registers every generated event handler with a Lunibee client. */\nexport function registerEvents(client: Client): void {\n${bindings}\n}\n`;
  await writeFile(join(handlersDir, "event.ts"), content);
  console.log("  ✓ updated handlers/event.ts");
}

/** Prompts the user to select handlers using a simple terminal selector. */
async function createHandler(): Promise<void> {
  console.log("\n🐝 Lunibee Handler Generator\n");
  console.log("Select events by number (comma-separated), or type 'all':\n");
  gatewayEvents.forEach((event, index) => console.log(`  ${String(index + 1).padStart(2, " ")}. ${event}`));
  const answer = prompt("\nEvents: ")?.trim().toLowerCase();
  if (!answer) {
    console.log("No events selected.");
    return;
  }

  const selected = answer === "all"
    ? [...gatewayEvents]
    : [...new Set(answer.split(",").map((value) => Number.parseInt(value.trim(), 10) - 1))]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < gatewayEvents.length)
        .map((index) => gatewayEvents[index]);

  if (selected.length === 0) throw new Error("No valid events were selected.");

  const eventsDir = join(process.cwd(), "src", "events");
  const handlersDir = join(process.cwd(), "src", "handlers");
  await mkdir(eventsDir, { recursive: true });

  console.log("");
  for (const event of selected) await createEventFile(eventsDir, event);
  await updateEventBinder(eventsDir, handlersDir);
  console.log(`\n✓ Handler generation complete (${selected.length} selected).`);
}

const command = Bun.argv[2] ?? "help";
const subcommand = Bun.argv[3];

try {
  if (command === "create" && subcommand === "handler") {
    await createHandler();
  } else {
    switch (command) {
      case "publish":
        await publish();
        break;
      case "status":
        await status();
        break;
      case "help":
      case "--help":
      case "-h":
        console.log("Lunibee CLI\n\nCommands:\n  lunibee create handler   Create event handler files interactively\n  lunibee publish           Publish all public workspace packages to npm\n  lunibee status            List publishable packages and versions");
        break;
      default:
        console.error(`Unknown command: ${Bun.argv.slice(2).join(" ")}`);
        process.exit(1);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
