import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { syncCommands } from "./commands.js";
import { CliError, paint, type IO } from "./io.js";

/** Discord's chat-input command name rule. */
const COMMAND_NAME = /^[-_\p{Ll}\p{Lo}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
const SEGMENT = /^[a-zA-Z0-9_-]+$/;
const CUSTOM_ID = /^[a-zA-Z0-9_:.-]{1,100}$/;

export interface ScaffoldOptions {
    force?: boolean;
    dryRun?: boolean;
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

/** Validates `a/b` folder paths under src/commands. */
function category(value: string | undefined): string[] {
    if (!value) return [];
    const parts = value.split("/").filter(Boolean);
    for (const part of parts)
        if (!SEGMENT.test(part))
            throw new CliError(
                `Invalid category: ${value}`,
                "Use letters, digits, - and _, separated by /.",
            );
    return parts;
}

export type CommandMode = "slash" | "prefix" | "both";

/** Source of a `command()` file; `mode` picks slash (default), prefix-only or both. */
export function commandSource(
    name: string,
    description: string,
    mode: CommandMode = "slash",
): string {
    const lines = [
        `  name: ${JSON.stringify(name)},`,
        `  description: ${JSON.stringify(description)},`,
    ];
    if (mode === "prefix") lines.push("  slash: false,");
    if (mode !== "slash") lines.push("  prefix: true,");
    return `import { command } from "lunibee";

/** Runs ${mode === "prefix" ? "!" : "/"}${name}. */
export default command({
${lines.join("\n")}
  async run({ reply }) {
    await reply(${JSON.stringify(`${name} works.`)});
  },
});
`;
}

export interface CommandOptions extends ScaffoldOptions {
    description?: string;
    category?: string;
    mode?: CommandMode;
}

/** `lunibee create command [name] [--slash|--prefix|--both] [--description] [--category]`. */
export async function createCommand(
    io: IO,
    root: string,
    input: string | undefined,
    options: CommandOptions = {},
): Promise<number> {
    const usage =
        "lunibee create command <name> [--slash|--prefix|--both] [--description <text>] [--category <folder>]";
    const name = ask(io, input, "Command name:", usage);
    if (!name) return 0;
    if (!COMMAND_NAME.test(name))
        throw new CliError(
            `Invalid command name: ${name}`,
            "Discord requires 1-32 lowercase letters, digits, - or _.",
        );
    const description =
        options.description ??
        ((input || !io.interactive
            ? undefined
            : io.prompt("Description:")?.trim()) ||
            "A Lunibee command.");
    if (description.length < 1 || description.length > 100)
        throw new CliError("The description must be 1-100 characters.");
    const folder = category(options.category);
    const code = await emit(
        io,
        root,
        ["commands", ...folder, `${name}.ts`].join("/"),
        commandSource(name, description, options.mode),
        options,
    );
    return options.dryRun ? code : syncCommands(io, root);
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
    const kind = KINDS[kindAnswer.toLowerCase()];
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
