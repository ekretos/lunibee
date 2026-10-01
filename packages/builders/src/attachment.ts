import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

export interface AttachmentData {
    name: string;
    description?: string;
    file: Uint8Array | ArrayBuffer | Blob | Buffer | string;
    /**
     * Folder a string `file` must stay inside (symlinks included). Set it
     * whenever the path is not one you wrote yourself, e.g. from a command
     * option: without it, any readable file on the machine can be uploaded.
     */
    root?: string;
}

/** Builder for message attachments and file uploads. */
export class CreateAttachment {
    public name: string;
    public description?: string;
    public file: Uint8Array | ArrayBuffer | Blob | Buffer | string;
    /** Folder a string `file` must stay inside; see {@link AttachmentData.root}. */
    public root?: string;

    public constructor(
        file: Uint8Array | ArrayBuffer | Blob | Buffer | string,
        data?: Partial<Omit<AttachmentData, "file">> | string,
    ) {
        this.file = file;
        if (typeof data === "string") {
            this.name = data;
        } else {
            this.name =
                data?.name ??
                (typeof file === "string" ? basename(file) : "file.bin");
            this.description = data?.description;
            this.root = data?.root;
        }
    }

    /** Sets the attachment filename. */
    public setName(name: string): this {
        this.name = name;
        return this;
    }

    /** Sets the attachment description / alt text. */
    public setDescription(description: string): this {
        this.description = description;
        return this;
    }

    /** Sets the file contents. */
    public setFile(
        file: Uint8Array | ArrayBuffer | Blob | Buffer | string,
    ): this {
        this.file = file;
        return this;
    }

    /** Resolves the attachment payload to a binary Uint8Array. */
    public async toBuffer(): Promise<Uint8Array> {
        if (typeof this.file === "string") {
            const path =
                this.root === undefined
                    ? this.file
                    : await insideRoot(this.root, this.file);
            const buffer = await readFile(path);
            return new Uint8Array(buffer);
        }
        if (this.file instanceof Uint8Array) return this.file;
        if (this.file instanceof ArrayBuffer) return new Uint8Array(this.file);
        if (this.file instanceof Blob) {
            const buf = await this.file.arrayBuffer();
            return new Uint8Array(buf);
        }
        if (typeof Buffer !== "undefined" && Buffer.isBuffer(this.file)) {
            return new Uint8Array(this.file);
        }
        throw new TypeError(
            "Attachment file must be a supported binary value or file path.",
        );
    }
}

// ─── Deprecated names (0.2.2), removed in 0.3.0 ────────────────────────────────
// Builders are now `CreateX` (`ButtonBuilder` → `CreateButton`); `…Style` became
// `…Type` and `…Type` became `…Enum`.

/** @deprecated Use {@link CreateAttachment}. Removed in 0.3.0. */
export const AttachmentBuilder = CreateAttachment;
/** @deprecated Use {@link CreateAttachment}. Removed in 0.3.0. */
export type AttachmentBuilder = CreateAttachment;

/** Resolves `file` against `root`, refusing anything outside it (after following symlinks). */
async function insideRoot(root: string, file: string): Promise<string> {
    const base = await realpath(root);
    const target = await realpath(resolve(base, file)).catch(() => {
        throw new Error("Attachment file was not found inside its root.");
    });
    const rel = relative(base, target);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
        throw new Error("Attachment file is outside its root folder.");
    return target;
}
