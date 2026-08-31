#!/usr/bin/env bun

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..", "..");
const packagesDir = join(root, "packages");

/** Discord client events supported by the handler generator. */
const clientEvents = [
  "ready", "raw", "error", "open", "close", "messageCreate", "messageUpdate", "messageDelete", "messageDeleteBulk",
  "guildCreate", "guildUpdate", "guildDelete", "channelCreate", "channelUpdate", "channelDelete",
  "threadCreate", "threadUpdate", "threadDelete", "guildMemberAdd", "guildMemberUpdate", "guildMemberRemove",
  "messageReactionAdd", "messageReactionRemove", "messageReactionRemoveAll", "interactionCreate",
  "guildRoleCreate", "guildRoleUpdate", "guildRoleDelete", "guildBanAdd", "guildBanRemove", "guildEmojisUpdate",
] as const;
type ClientEvent = (typeof clientEvents)[number];

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
async function run(command: string[], cwd = process.cwd()): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit", env: globalThis.process.env });
  const code = await child.exited;
  if (code !== 0) throw new Error(`Command failed (${code}): ${command.join(" ")}`);
}

/** Publishes every public workspace package in deterministic order. */
async function publish(): Promise<void> {
  const packages = await getPublishablePackages();
  if (!packages.length) return void console.log("No publishable packages found.");
  console.log(`Publishing ${packages.length} Lunibee packages...`);
  for (const { directory, manifest } of packages) {
    console.log(`\n→ ${manifest.name}@${manifest.version}`);
    await run(["bun", "publish", "--access", manifest.publishConfig?.access ?? "public"], directory);
  }
  console.log("\n✓ Lunibee packages published successfully.");
}

/** Prints all publishable workspace packages. */
async function status(): Promise<void> {
  for (const { manifest } of await getPublishablePackages()) console.log(`${manifest.name}@${manifest.version}`);
}

/** Converts a name into a safe TypeScript identifier. */
function identifier(value: string): string {
  const result = value.replace(/[^a-zA-Z0-9_$]/g, "_");
  return /^[a-zA-Z_$]/.test(result) ? result : `handler_${result}`;
}

/** Converts a name into a safe TypeScript filename. */
function fileName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!normalized) throw new Error("Name cannot be empty.");
  return normalized.endsWith(".ts") ? normalized : `${normalized}.ts`;
}

/** Creates a strongly typed event handler using Lunibee's ClientEvents map. */
function handlerSource(event: ClientEvent, handler: string): string {
  const name = identifier(handler.replace(/\.ts$/, ""));
  return `import type { ClientEvents } from "lunibee";\n\n/** Handles the ${event} event. */\nexport default async function ${name}(...args: ClientEvents["${event}"]): Promise<void> {\n  const [payload] = args;\n\n  // Add your ${event} logic here.\n  void payload;\n}\n`;
}

interface HandlerEntry { event: ClientEvent; path: string; importName: string; }

/** Discovers every generated handler below src/events/<event>/. */
async function discoverHandlers(eventsDir: string): Promise<HandlerEntry[]> {
  const result: HandlerEntry[] = [];
  let events: import("node:fs").Dirent[];
  try { events = await readdir(eventsDir, { withFileTypes: true }); } catch { return result; }
  for (const eventEntry of events) {
    if (!eventEntry.isDirectory() || !(clientEvents as readonly string[]).includes(eventEntry.name)) continue;
    const event = eventEntry.name as ClientEvent;
    let handlers: import("node:fs").Dirent[];
    try { handlers = await readdir(join(eventsDir, event), { withFileTypes: true }); } catch { continue; }
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
async function createHandlerFile(eventsDir: string, event: ClientEvent, handler: string): Promise<void> {
  const directory = join(eventsDir, event);
  const targetName = fileName(handler);
  const target = join(directory, targetName);
  await mkdir(directory, { recursive: true });
  if (await Bun.file(target).exists()) {
    console.log(`  ↳ skipped ${event}/${targetName} (already exists)`);
    return;
  }
  await writeFile(target, handlerSource(event, handler));
  console.log(`  ✓ created events/${event}/${targetName}`);
}

/** Creates event handlers interactively. */
async function createHandler(): Promise<void> {
  console.log("\n🐝 Lunibee Handler Generator\n");
  console.log("Select events by number (comma-separated), or type 'all':\n");
  clientEvents.forEach((event, index) => console.log(`  ${String(index + 1).padStart(2, " ")}. ${event}`));
  const answer = prompt("\nEvents: ")?.trim().toLowerCase();
  if (!answer) return void console.log("No events selected.");
  const selected = answer === "all" ? [...clientEvents] : [...new Set(answer.split(",").map((v) => Number.parseInt(v.trim(), 10) - 1))]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < clientEvents.length).map((i) => clientEvents[i]);
  if (!selected.length) throw new Error("No valid events were selected.");

  const eventsDir = join(process.cwd(), "src", "events");
  const handlersDir = join(process.cwd(), "src", "handlers");
  await mkdir(eventsDir, { recursive: true });
  for (const event of selected) {
    const existing = await discoverHandlers(join(eventsDir, event));
    if (existing.length) console.log(`\n${event} already has: ${existing.map((h) => h.path.split("/").pop()).join(", ")}`);
    const defaultName = existing.length ? "handler" : event;
    const handler = prompt(`Handler name for ${event} [${defaultName}]: `)?.trim() || defaultName;
    await createHandlerFile(eventsDir, event, handler);
  }
  await updateEventBinder(eventsDir, handlersDir);
  console.log("\n✓ Handler generation complete.");
}

/** Creates a command module in src/commands without overwriting an existing file. */
async function createCommand(): Promise<void> {
  console.log("\n🐝 Lunibee Command Generator\n");
  const name = prompt("Command name: ")?.trim();
  if (!name) return void console.log("No command created.");
  const description = prompt("Description: ")?.trim() || "A Lunibee command.";
  const commandsDir = join(process.cwd(), "src", "commands");
  const target = join(commandsDir, fileName(name));
  await mkdir(commandsDir, { recursive: true });
  if (await Bun.file(target).exists()) throw new Error(`Command already exists: ${target}`);
  const exportName = identifier(name.replace(/\.ts$/, ""));
  await writeFile(target, `import { SlashCommandBuilder } from "lunibee";\n\n/** ${description} */\nexport default new SlashCommandBuilder()\n  .setName("${name.replace(/\.ts$/, "")}")\n  .setDescription("${description.replace(/"/g, '\\"')}");\n\nvoid ${exportName};\n`);
  console.log(`✓ created commands/${fileName(name)}`);
}

/** Creates a component scaffold in src/components. */
async function createComponent(): Promise<void> {
  console.log("\n🐝 Lunibee Component Generator\n\n1. Button\n2. String Select\n3. Modal");
  const type = prompt("Component: ")?.trim();
  const types: Record<string, string> = { "1": "button", "2": "select", "3": "modal", button: "button", select: "select", modal: "modal" };
  const selected = types[type ?? ""];
  if (!selected) throw new Error("Unknown component type.");
  const name = prompt("Component name: ")?.trim();
  if (!name) return void console.log("No component created.");
  const directory = join(process.cwd(), "src", "components");
  const target = join(directory, fileName(name));
  await mkdir(directory, { recursive: true });
  if (await Bun.file(target).exists()) throw new Error(`Component already exists: ${target}`);
  await writeFile(target, `/** ${selected} component: ${name}. */\nexport const ${identifier(name)} = {\n  type: "${selected}",\n  customId: "${name}",\n};\n`);
  console.log(`✓ created components/${fileName(name)}`);
}

/** Lists generated handlers or commands in the current project. */
async function listResources(kind: string): Promise<void> {
  const base = kind === "handlers" ? join(process.cwd(), "src", "events") : join(process.cwd(), "src", "commands");
  try {
    const entries = await readdir(base, { withFileTypes: true });
    if (kind === "handlers") {
      for (const event of entries.filter((e) => e.isDirectory())) {
        const files = await readdir(join(base, event.name), { withFileTypes: true });
        console.log(`${event.name}${files.length ? `\n  └─ ${files.filter((f) => f.isFile()).map((f) => f.name).join("\n  └─ ")}` : ""}`);
      }
    } else {
      for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith(".ts"))) console.log(entry.name.replace(/\.ts$/, ""));
    }
  } catch { console.log(`No ${kind} found.`); }
}

/** Checks the current project for common Lunibee setup problems. */
async function check(): Promise<void> {
  console.log("\n🐝 Lunibee Project Check\n");
  const pkg = await readManifest(process.cwd());
  const packageFile = Bun.file(join(process.cwd(), "package.json"));
  if (await packageFile.exists()) console.log("✓ package.json found"); else console.log("⚠ package.json not found");
  const lunibeeInstalled = pkg?.name === "lunibee" || (await packageFile.exists() && JSON.stringify(await packageFile.json()).includes("lunibee"));
  console.log(`${lunibeeInstalled ? "✓" : "⚠"} Lunibee dependency ${lunibeeInstalled ? "found" : "not found"}`);
  for (const directory of ["src", "src/events", "src/commands"]) console.log(`${(await Bun.file(join(process.cwd(), directory, ".lunibee-check")).exists()) ? "✓" : "•"} ${directory}`);
  const env = Bun.file(join(process.cwd(), ".env"));
  console.log(`${await env.exists() ? "✓" : "⚠"} .env ${await env.exists() ? "found" : "not found"}`);
}

/** Reports actionable project problems. */
async function doctor(): Promise<void> {
  console.log("\n🐝 Lunibee Doctor\n");
  const packageFile = Bun.file(join(process.cwd(), "package.json"));
  if (!(await packageFile.exists())) return void console.log("✗ package.json is missing. Run: bun init");
  const packageJson = await packageFile.json() as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (!deps.lunibee && !Object.keys(deps).some((name) => name.startsWith("@lunibee/"))) console.log("✗ No Lunibee package is installed. Run: bun add lunibee");
  else console.log("✓ Lunibee package detected");
  const env = Bun.file(join(process.cwd(), ".env"));
  if (!(await env.exists())) console.log("⚠ .env is missing. Add your Discord token before login.");
  else console.log("✓ .env found");
}

/** Prints project and CLI information. */
async function info(): Promise<void> {
  const packageFile = Bun.file(join(process.cwd(), "package.json"));
  let project = "unknown";
  if (await packageFile.exists()) project = ((await packageFile.json()) as { name?: string }).name ?? "unknown";
  console.log(`🐝 Lunibee\n\nProject: ${project}\nRuntime: Bun ${Bun.version}\nCLI: @lunibee/cli@0.1.6`);
}

/** Prints CLI help. */
function help(): void {
  console.log(`Lunibee CLI\n\nCommands:\n  lunibee create handler     Create one or more event handlers\n  lunibee create command     Create a command module\n  lunibee create component   Create a component scaffold\n  lunibee list handlers      List event handlers\n  lunibee list commands      List commands\n  lunibee check               Check project setup\n  lunibee doctor              Diagnose common setup problems\n  lunibee info                Show project and runtime information\n  lunibee publish             Publish all public workspace packages\n  lunibee status              List publishable packages\n  lunibee --help              Show this help`);
}

const command = Bun.argv[2] ?? "help";
const subcommand = Bun.argv[3];
try {
  if (command === "create" && subcommand === "handler") await createHandler();
  else if (command === "create" && subcommand === "command") await createCommand();
  else if (command === "create" && subcommand === "component") await createComponent();
  else if (command === "list" && subcommand === "handlers") await listResources("handlers");
  else if (command === "list" && subcommand === "commands") await listResources("commands");
  else switch (command) {
    case "publish": await publish(); break;
    case "status": await status(); break;
    case "check": await check(); break;
    case "doctor": await doctor(); break;
    case "info": await info(); break;
    case "help": case "--help": case "-h": help(); break;
    default: console.error(`Unknown command: ${Bun.argv.slice(2).join(" ")}`); process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
