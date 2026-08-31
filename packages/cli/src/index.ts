#!/usr/bin/env bun

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ClientEvent } from "@lunibee/core";

const root = resolve(import.meta.dir, "../..", "..");
const packagesDir = join(root, "packages");
type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  publishConfig?: { access?: string };
};

async function manifest(dir: string): Promise<Manifest | null> {
  try {
    const file = Bun.file(join(dir, "package.json"));
    return (await file.exists()) ? ((await file.json()) as Manifest) : null;
  } catch {
    return null;
  }
}

async function packages(): Promise<Array<{ dir: string; manifest: Manifest }>> {
  const result: Array<{ dir: string; manifest: Manifest }> = [];
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const pkg = await manifest(dir);
    if (pkg?.name && pkg.version && !pkg.private)
      result.push({ dir, manifest: pkg });
  }
  return result.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

async function run(command: string[], cwd = process.cwd()): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  const code = await child.exited;
  if (code !== 0)
    throw new Error(`Command failed (${code}): ${command.join(" ")}`);
}

async function publish(): Promise<void> {
  const list = await packages();
  if (!list.length) return void console.log("No publishable packages found.");
  for (const { dir, manifest } of list) {
    console.log(`→ ${manifest.name}@${manifest.version}`);
    await run(
      [
        "bun",
        "publish",
        "--access",
        manifest.publishConfig?.access ?? "public",
      ],
      dir,
    );
  }
}

async function status(): Promise<void> {
  for (const { manifest } of await packages())
    console.log(`${manifest.name}@${manifest.version}`);
}

const RESERVED = new Set([
  "default", "class", "function", "export", "import", "const", "let", "var",
  "if", "else", "switch", "case", "for", "while", "do", "return", "new",
  "try", "catch", "finally", "throw", "typeof", "instanceof", "void", "delete",
]);

function identifier(value: string): string {
  let result = value.replace(/[^a-zA-Z0-9_$]/g, "_");
  if (RESERVED.has(result)) result = `_${result}`;
  return /^[a-zA-Z_$]/.test(result) ? result : `handler_${result}`;
}

function fileName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!normalized) throw new Error("Name cannot be empty.");
  return normalized.endsWith(".ts") ? normalized : `${normalized}.ts`;
}

function eventMember(event: ClientEvent): string {
  const entry = Object.entries(ClientEvent).find(
    ([, value]) => value === event,
  );
  if (!entry) throw new Error(`Unknown client event: ${event}`);
  return entry[0];
}

function handlerSource(event: ClientEvent, name: string): string {
  const identifierName = identifier(name.replace(/\.ts$/, ""));
  return `import type { ClientEvents } from "lunibee";\n\n/** Handles the ${event} event. */\nexport default async function ${identifierName}(...args: ClientEvents["${event}"]): Promise<void> {\n  const [payload] = args;\n\n  // Add your ${event} logic here.\n  void payload;\n}\n`;
}

type Handler = { event: ClientEvent; path: string; importName: string };

async function discover(eventsDir: string): Promise<Handler[]> {
  const result: Handler[] = [];
  let eventDirs;
  try {
    eventDirs = await readdir(eventsDir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const dir of eventDirs) {
    if (
      !dir.isDirectory() ||
      !Object.values(ClientEvent).includes(dir.name as ClientEvent)
    )
      continue;
    const event = dir.name as ClientEvent;
    for (const file of await readdir(join(eventsDir, dir.name), {
      withFileTypes: true,
    })) {
      if (!file.isFile() || !file.name.endsWith(".ts")) continue;
      const name = file.name.slice(0, -3);
      result.push({
        event,
        path: `../events/${event}/${name}`,
        importName: identifier(`${event}_${name}`),
      });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function updateBinder(
  eventsDir: string,
  handlersDir: string,
): Promise<void> {
  const handlers = await discover(eventsDir);
  await mkdir(handlersDir, { recursive: true });
  const imports = handlers
    .map((h) => `import ${h.importName} from "${h.path}";`)
    .join("\n");
  const bindings = handlers
    .map(
      (h) =>
        `  client.on(ClientEvent.${eventMember(h.event)}, ${h.importName});`,
    )
    .join("\n");
  const content = `import type { Client } from "lunibee";\nimport { ClientEvent } from "lunibee";\n${imports ? `\n${imports}` : ""}\n\n/** Registers every handler found under src/events with a Lunibee client. */\nexport function registerEvents(client: Client): void {\n${bindings}\n}\n`;
  await writeFile(join(handlersDir, "event.ts"), content);
}

async function createHandler(): Promise<void> {
  console.log("\n🐝 Lunibee Handler Generator\n");
  const events = Object.values(ClientEvent);
  events.forEach((event, i) => console.log(`  ${i + 1}. ${event}`));
  const answer = prompt("\nEvents (comma-separated numbers or all): ")
    ?.trim()
    .toLowerCase();
  if (!answer) return;
  const selected =
    answer === "all"
      ? events
      : [
          ...new Set(
            answer.split(",").map((v) => Number.parseInt(v.trim(), 10) - 1),
          ),
        ]
          .filter((i) => Number.isInteger(i) && i >= 0 && i < events.length)
          .map((i) => events[i]);
  if (!selected.length) throw new Error("No valid events were selected.");

  const eventsDir = join(process.cwd(), "src", "events");
  const handlersDir = join(process.cwd(), "src", "handlers");
  await mkdir(eventsDir, { recursive: true });
  for (const event of selected) {
    const directory = join(eventsDir, event);
    await mkdir(directory, { recursive: true });
    const existing = (await discover(eventsDir)).filter(
      (h) => h.event === event,
    );
    if (existing.length)
      console.log(`\n${event} already has ${existing.length} handler(s).`);
    const defaultName = existing.length ? "handler" : event;
    const name =
      prompt(`Handler name for ${event} [${defaultName}]: `)?.trim() ||
      defaultName;
    const target = join(directory, fileName(name));
    if (await Bun.file(target).exists()) {
      console.log(`↳ skipped ${event}/${fileName(name)} (already exists)`);
      continue;
    }
    await writeFile(target, handlerSource(event, name));
    console.log(`✓ created events/${event}/${fileName(name)}`);
  }
  await updateBinder(eventsDir, handlersDir);
  console.log("✓ updated handlers/event.ts");
}

async function createCommand(): Promise<void> {
  const name = prompt("Command name: ")?.trim();
  if (!name) return;
  const description = prompt("Description: ")?.trim() || "A Lunibee command.";
  const dir = join(process.cwd(), "src", "commands");
  const file = fileName(name);
  const target = join(dir, file);
  await mkdir(dir, { recursive: true });
  if (await Bun.file(target).exists())
    throw new Error(`Command already exists: ${file}`);
  await writeFile(
    target,
    `import { SlashCommandBuilder } from "lunibee";\n\nexport default new SlashCommandBuilder()\n  .setName(${JSON.stringify(name.replace(/\.ts$/, ""))})\n  .setDescription(${JSON.stringify(description)});\n`,
  );
  console.log(`✓ created commands/${file}`);
}

async function createComponent(): Promise<void> {
  console.log("\n1. Button\n2. String Select\n3. Modal");
  const value = prompt("Component: ")?.trim();
  const type = (
    {
      "1": "button",
      "2": "select",
      "3": "modal",
      button: "button",
      select: "select",
      modal: "modal",
    } as Record<string, string>
  )[value ?? ""];
  if (!type) throw new Error("Unknown component type.");
  const name = prompt("Component name: ")?.trim();
  if (!name) return;
  const dir = join(process.cwd(), "src", "components");
  const file = fileName(name);
  const target = join(dir, file);
  await mkdir(dir, { recursive: true });
  if (await Bun.file(target).exists())
    throw new Error(`Component already exists: ${file}`);
  await writeFile(
    target,
    `/** ${type} component: ${name}. */\nexport const ${identifier(name.replace(/\.ts$/, ""))} = {\n  type: "${type}",\n  customId: ${JSON.stringify(name.replace(/\.ts$/, ""))},\n};\n`,
  );
  console.log(`✓ created components/${file}`);
}

async function list(kind: "handlers" | "commands"): Promise<void> {
  const dir = join(
    process.cwd(),
    "src",
    kind === "handlers" ? "events" : "commands",
  );
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    if (kind === "commands")
      for (const entry of entries.filter(
        (e) => e.isFile() && e.name.endsWith(".ts"),
      ))
        console.log(entry.name.slice(0, -3));
    else
      for (const event of entries.filter((e) => e.isDirectory())) {
        const handlers = await readdir(join(dir, event.name), {
          withFileTypes: true,
        });
        console.log(
          `${event.name}${
            handlers.length
              ? `\n  └─ ${handlers
                  .filter((h) => h.isFile())
                  .map((h) => h.name)
                  .join("\n  └─ ")}`
              : ""
          }`,
        );
      }
  } catch {
    console.log(`No ${kind} found.`);
  }
}

async function check(): Promise<void> {
  const packageFile = Bun.file(join(process.cwd(), "package.json"));
  if (!(await packageFile.exists()))
    return void console.log("⚠ package.json not found");
  const pkg = (await packageFile.json()) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  console.log(
    `${deps.lunibee || Object.keys(deps).some((x) => x.startsWith("@lunibee/")) ? "✓" : "⚠"} Lunibee dependency`,
  );
  for (const dir of ["src", "src/events", "src/commands"])
    console.log(
      `${(await Bun.file(join(process.cwd(), dir)).exists()) ? "✓" : "•"} ${dir}`,
    );
  console.log(
    `${(await Bun.file(join(process.cwd(), ".env")).exists()) ? "✓" : "⚠"} .env`,
  );
}

async function doctor(): Promise<void> {
  const packageFile = Bun.file(join(process.cwd(), "package.json"));
  if (!(await packageFile.exists()))
    return void console.log("✗ package.json is missing. Run: bun init");
  const pkg = (await packageFile.json()) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (
    !deps.lunibee &&
    !Object.keys(deps).some((x) => x.startsWith("@lunibee/"))
  )
    console.log("✗ No Lunibee package installed. Run: bun add lunibee");
  else console.log("✓ Lunibee package detected");
  console.log(
    `${(await Bun.file(join(process.cwd(), ".env")).exists()) ? "✓" : "⚠"} .env`,
  );
}

async function info(): Promise<void> {
  const file = Bun.file(join(process.cwd(), "package.json"));
  const pkg = (await file.exists())
    ? ((await file.json()) as { name?: string })
    : {};
  console.log(
    `🐝 Lunibee\n\nProject: ${pkg.name ?? "unknown"}\nRuntime: Bun ${Bun.version}\nCLI: @lunibee/cli@0.1.6`,
  );
}

function help(): void {
  console.log(
    `Lunibee CLI\n\nCommands:\n  lunibee create handler\n  lunibee create command\n  lunibee create component\n  lunibee list handlers\n  lunibee list commands\n  lunibee check\n  lunibee doctor\n  lunibee info\n  lunibee publish\n  lunibee status`,
  );
}

const command = Bun.argv[2] ?? "help";
const subcommand = Bun.argv[3];
try {
  if (command === "create" && subcommand === "handler") await createHandler();
  else if (command === "create" && subcommand === "command")
    await createCommand();
  else if (command === "create" && subcommand === "component")
    await createComponent();
  else if (
    command === "list" &&
    (subcommand === "handlers" || subcommand === "commands")
  )
    await list(subcommand);
  else if (command === "check") await check();
  else if (command === "doctor") await doctor();
  else if (command === "info") await info();
  else if (command === "publish") await publish();
  else if (command === "status") await status();
  else if (["help", "--help", "-h"].includes(command)) help();
  else throw new Error(`Unknown command: ${Bun.argv.slice(2).join(" ")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
