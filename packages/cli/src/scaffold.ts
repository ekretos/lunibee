import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommandStyle } from "./init.js";
import { CliError, paint, type IO } from "./io.js";

const CUSTOM_ID = /^[a-zA-Z0-9_:.-]{1,100}$/;

export interface ScaffoldOptions {
    force?: boolean;
    dryRun?: boolean;
}

export interface CommandScaffoldOptions extends ScaffoldOptions {
    /** A folder under src/commands. */
    category?: string;
    description?: string;
}

/** Asks for a value when it is missing and prompts are possible. */
function ask(
    io: IO,
    value: string | undefined,
    question: string,
    usage: string,
): string | null {
    if (value) return value;
    if (!io.interactive)
        throw new CliError(`Missing argument.`, `Usage: ${usage}`);
    return io.prompt(question)?.trim() || null;
}

async function emit(
    io: IO,
    root: string,
    relative: string,
    source: string,
    options: ScaffoldOptions,
): Promise<number> {
    const target = join(root, "src", relative);
    if ((await Bun.file(target).exists()) && !options.force)
        throw new CliError(
            `${relative} already exists.`,
            "Pass --force to overwrite it.",
        );
    if (options.dryRun) {
        io.out(`• would create ${relative}`);
        return 0;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
    io.out(`${paint(io, "green", "✓")} created ${relative}`);
    return 0;
}

export type ComponentKind = "button" | "select" | "modal";

const KINDS: Record<string, ComponentKind> = {
    "1": "button",
    "2": "select",
    "3": "modal",
    button: "button",
    select: "select",
    "string-select": "select",
    modal: "modal",
};

export function componentSource(kind: ComponentKind, customId: string): string {
    const id = JSON.stringify(customId);
    if (kind === "button")
        return `import { ButtonType, CreateActionRow, CreateButton, type Client, type ComponentInteraction } from "lunibee";

export const customId = ${id};

/** The row to send, e.g. \`reply({ components: [row()] })\`. */
export function row(): CreateActionRow {
  return new CreateActionRow().addComponents(
    new CreateButton().setCustomId(customId).setLabel("Confirm").setStyle(ButtonType.Primary),
  );
}

/** Handles a click. Check \`interaction.user\` before acting on someone's behalf. */
export async function handle(client: Client, interaction: ComponentInteraction): Promise<void> {
  void client;
  await interaction.reply({ content: "Clicked.", ephemeral: true });
}
`;
    if (kind === "select")
        return `import { CreateActionRow, CreateStringSelect, type Client, type ComponentInteraction } from "lunibee";

export const customId = ${id};

/** The row to send, e.g. \`reply({ components: [row()] })\`. */
export function row(): CreateActionRow {
  return new CreateActionRow().addComponents(
    new CreateStringSelect()
      .setCustomId(customId)
      .setPlaceholder("Choose an option")
      .addOptions({ label: "One", value: "one" }, { label: "Two", value: "two" }),
  );
}

/** Handles a pick. \`values\` come from the client: validate them before use. */
export async function handle(client: Client, interaction: ComponentInteraction): Promise<void> {
  void client;
  const allowed = new Set(["one", "two"]);
  const picked = interaction.values.filter((value) => allowed.has(value));
  await interaction.reply({ content: \`Picked: \${picked.join(", ") || "nothing"}\`, ephemeral: true });
}
`;
    return `import { CreateModal, CreateTextInput, TextInputType, type Client, type ModalSubmitInteraction } from "lunibee";

export const customId = ${id};

/** The modal to show, e.g. \`interaction.showModal(modal())\`. */
export function modal(): CreateModal {
  return new CreateModal()
    .setCustomId(customId)
    .setTitle("Feedback")
    .addTextInputs(
      new CreateTextInput().setCustomId("answer").setLabel("Your answer").setStyle(TextInputType.Paragraph),
    );
}

/** Handles the submitted modal. */
export async function handle(client: Client, interaction: ModalSubmitInteraction): Promise<void> {
  void client;
  const answer = interaction.getInputValue("answer") ?? "";
  await interaction.reply({ content: \`Received \${answer.length} characters.\`, ephemeral: true });
}
`;
}

/** `lunibee create component [button|select|modal] [name]`. */
export async function createComponent(
    io: IO,
    root: string,
    kindInput: string | undefined,
    nameInput: string | undefined,
    options: ScaffoldOptions = {},
): Promise<number> {
    const usage = "lunibee create component <button|select|modal> <name>";
    if (!kindInput && io.interactive)
        io.out("\n1. Button\n2. String select\n3. Modal");
    const kindAnswer = ask(io, kindInput, "Component:", usage);
    if (!kindAnswer) return 0;
    const lowered = kindAnswer.toLowerCase();
    const kind = Object.hasOwn(KINDS, lowered) ? KINDS[lowered] : undefined;
    if (!kind)
        throw new CliError(
            `Unknown component type: ${kindAnswer}`,
            "Use button, select or modal.",
        );
    const name = ask(
        io,
        nameInput,
        "Component name (also its custom ID):",
        usage,
    );
    if (!name) return 0;
    if (!CUSTOM_ID.test(name))
        throw new CliError(
            `Invalid component name: ${name}`,
            "Use 1-100 letters, digits, _, -, : or . (it is the custom ID).",
        );
    return emit(
        io,
        root,
        `components/${name.replace(/:/g, "-")}.ts`,
        componentSource(kind, name),
        options,
    );
}

/** A slash command name Discord accepts, kept to lowercase ASCII. */
const COMMAND_NAME = /^[a-z0-9_-]{1,32}$/;
const CATEGORY = /^[a-z0-9-][a-z0-9_-]*$/i;

/**
 * The commands an `init` project answers, read from its `src/types/index.ts`.
 * @throws {CliError} When the project has no such file.
 */
export async function projectCommandStyle(root: string): Promise<CommandStyle> {
    let types: string;
    try {
        types = await readFile(join(root, "src/types/index.ts"), "utf8");
    } catch {
        throw new CliError(
            "src/types/index.ts not found.",
            "lunibee create command works in a project made by `lunibee init`.",
        );
    }
    const message = types.includes("executeMessage(");
    if (!message) return "slash";
    return types.includes("CreateSlashCommand") ? "both" : "message";
}

export function commandSource(
    style: CommandStyle,
    name: string,
    description: string,
    types: string,
): string {
    const slash = style !== "message";
    const message = style !== "slash";
    return [
        slash ? `import { CreateSlashCommand } from "lunibee";\n` : "",
        `import { defineCommand } from ${JSON.stringify(types)};\n\n`,
        `/** ${[slash && `/${name}`, message && `!${name}`].filter(Boolean).join(" and ")}: ${description.replaceAll("*/", "* /")} */\n`,
        "export default defineCommand({\n",
        slash
            ? `    data: new CreateSlashCommand().setName(${JSON.stringify(name)}).setDescription(${JSON.stringify(description)}),\n    async execute({ interaction }) {\n        await interaction.reply("Hello from /${name}!");\n    },\n`
            : `    name: ${JSON.stringify(name)},\n    description: ${JSON.stringify(description)},\n`,
        message
            ? `    async executeMessage({ message, args }) {\n        await message.reply(\`Hello from ${name}! Arguments: \${args.join(" ") || "none"}\`);\n    },\n`
            : "",
        "});\n",
    ].join("");
}

/** `lunibee create command [name]`: a command in the project's style (slash, message or both). */
export async function createCommand(
    io: IO,
    root: string,
    nameInput: string | undefined,
    options: CommandScaffoldOptions = {},
): Promise<number> {
    const usage =
        "lunibee create command <name> [--category <folder>] [--description <text>]";
    const style = await projectCommandStyle(root);
    const name = ask(io, nameInput, "Command name:", usage)?.toLowerCase();
    if (!name) return 0;
    if (!COMMAND_NAME.test(name))
        throw new CliError(
            `Invalid command name: ${name}`,
            "Use 1-32 lowercase letters, digits, - or _.",
        );
    const category = options.category?.trim();
    if (category !== undefined && !CATEGORY.test(category))
        throw new CliError(
            `Invalid category: ${category}`,
            "Use letters, digits, - and _, not starting with _ (such folders are skipped).",
        );
    const description = options.description?.trim() || `Runs ${name}.`;
    if (description.length > 100)
        throw new CliError("The description is longer than 100 characters.");
    return emit(
        io,
        root,
        category ? `commands/${category}/${name}.ts` : `commands/${name}.ts`,
        commandSource(
            style,
            name,
            description,
            category ? "../../types/index.js" : "../types/index.js",
        ),
        options,
    );
}
