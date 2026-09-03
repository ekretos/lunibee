import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export interface AttachmentData {
    name: string;
    description?: string;
    file: Uint8Array | ArrayBuffer | Blob | Buffer | string;
}

/** Builder for message attachments and file uploads. */
export class AttachmentBuilder {
    public name: string;
    public description?: string;
    public file: Uint8Array | ArrayBuffer | Blob | Buffer | string;

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
            const buffer = await readFile(this.file);
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
        throw new TypeError("Attachment file must be a supported binary value or file path.");
    }
}
