/** Permission overwrite target types. */
export enum PermissionOverwriteType {
    Role = 0,
    Member = 1,
}

/** Permission bit values exposed by Discord as an enum. */
export enum PermissionFlagsBits {
    CreateInstantInvite = "1",
    KickMembers = "2",
    BanMembers = "4",
    Administrator = "8",
    ManageChannels = "16",
    ManageGuild = "32",
    AddReactions = "64",
    ViewAuditLog = "128",
    PrioritySpeaker = "256",
    Stream = "512",
    ViewChannel = "1024",
    SendMessages = "2048",
    SendTTSMessages = "4096",
    ManageMessages = "8192",
    EmbedLinks = "16384",
    AttachFiles = "32768",
    ReadMessageHistory = "65536",
    MentionEveryone = "131072",
    UseExternalEmojis = "262144",
    ViewGuildInsights = "524288",
    Connect = "1048576",
    Speak = "2097152",
    MuteMembers = "4194304",
    DeafenMembers = "8388608",
    MoveMembers = "16777216",
    UseVAD = "33554432",
    ChangeNickname = "67108864",
    ManageNicknames = "134217728",
    ManageRoles = "268435456",
    ManageWebhooks = "536870912",
    ManageGuildExpressions = "1073741824",
    UseApplicationCommands = "2147483648",
    RequestToSpeak = "4294967296",
    ManageEvents = "8589934592",
    ManageThreads = "17179869184",
    CreatePublicThreads = "34359738368",
    CreatePrivateThreads = "68719476736",
    UseExternalStickers = "137438953472",
    SendMessagesInThreads = "274877906944",
    UseEmbeddedActivities = "549755813888",
    ModerateMembers = "1099511627776",
    ViewCreatorMonetizationAnalytics = "2199023255552",
    UseSoundboard = "4398046511104",
    CreateGuildExpressions = "8796093022208",
    CreateEvents = "17592186044416",
    UseExternalSounds = "35184372088832",
    SendVoiceMessages = "70368744177664",
    SendPolls = "562949953421312",
    UseExternalApps = "1125899906842624",
}

/** Permission bit values exposed by Discord as BigInt constants. */
export const Permissions = {
    CreateInstantInvite: 1n << 0n,
    KickMembers: 1n << 1n,
    BanMembers: 1n << 2n,
    Administrator: 1n << 3n,
    ManageChannels: 1n << 4n,
    ManageGuild: 1n << 5n,
    AddReactions: 1n << 6n,
    ViewAuditLog: 1n << 7n,
    PrioritySpeaker: 1n << 8n,
    Stream: 1n << 9n,
    ViewChannel: 1n << 10n,
    SendMessages: 1n << 11n,
    SendTTSMessages: 1n << 12n,
    ManageMessages: 1n << 13n,
    EmbedLinks: 1n << 14n,
    AttachFiles: 1n << 15n,
    ReadMessageHistory: 1n << 16n,
    MentionEveryone: 1n << 17n,
    UseExternalEmojis: 1n << 18n,
    ViewGuildInsights: 1n << 19n,
    Connect: 1n << 20n,
    Speak: 1n << 21n,
    MuteMembers: 1n << 22n,
    DeafenMembers: 1n << 23n,
    MoveMembers: 1n << 24n,
    UseVAD: 1n << 25n,
    ChangeNickname: 1n << 26n,
    ManageNicknames: 1n << 27n,
    ManageRoles: 1n << 28n,
    ManageWebhooks: 1n << 29n,
    ManageGuildExpressions: 1n << 30n,
    UseApplicationCommands: 1n << 31n,
    RequestToSpeak: 1n << 32n,
    ManageEvents: 1n << 33n,
    ManageThreads: 1n << 34n,
    CreatePublicThreads: 1n << 35n,
    CreatePrivateThreads: 1n << 36n,
    UseExternalStickers: 1n << 37n,
    SendMessagesInThreads: 1n << 38n,
    UseEmbeddedActivities: 1n << 39n,
    ModerateMembers: 1n << 40n,
    ViewCreatorMonetizationAnalytics: 1n << 41n,
    UseSoundboard: 1n << 42n,
    CreateGuildExpressions: 1n << 43n,
    CreateEvents: 1n << 44n,
    UseExternalSounds: 1n << 45n,
    SendVoiceMessages: 1n << 46n,
    SendPolls: 1n << 49n,
    UseExternalApps: 1n << 50n,
} as const;

/** Public permission names. */
export type PermissionName = keyof typeof Permissions | keyof typeof PermissionFlagsBits;

/** Immutable permission bitfield. */
export class PermissionSet {
    /** Permission bitfield. */
    public readonly bitfield: bigint;

    /** Creates a permission set. @param value Initial permission bitfield. @throws {RangeError} If the value is negative. @throws {TypeError} If the value is not a valid integer. */
    public constructor(value: bigint | number | string = 0n) {
        try {
            const bitfield = BigInt(value);
            if (bitfield < 0n) throw new RangeError("Permission bitfield cannot be negative.");
            this.bitfield = bitfield;
        } catch (error) {
            if (error instanceof RangeError) throw error;
            throw new TypeError("Permission bitfield must be a valid non-negative integer.", { cause: error });
        }
    }

    /** Checks whether all supplied permissions are present. @param permissions Permission names or raw bits. @returns True when every requested permission is present. */
    public has(...permissions: (bigint | number | string | PermissionName | PermissionFlagsBits)[]): boolean {
        return permissions.every(permission => {
            const bit = this.#resolve(permission);
            return (this.bitfield & bit) === bit;
        });
    }

    /** Checks whether any supplied permission is present. @param permissions Permission names or raw bits. @returns True when at least one requested permission is present. */
    public any(...permissions: (bigint | number | string | PermissionName | PermissionFlagsBits)[]): boolean {
        return permissions.some(permission => (this.bitfield & this.#resolve(permission)) !== 0n);
    }

    /** Returns a new set with permissions added. @param permissions Permission names or raw bits. @returns A new permission set. */
    public add(...permissions: (bigint | number | string | PermissionName | PermissionFlagsBits)[]): PermissionSet {
        let bitfield = this.bitfield;
        for (const permission of permissions) bitfield |= this.#resolve(permission);
        return new PermissionSet(bitfield);
    }

    /** Returns a new set with permissions removed. @param permissions Permission names or raw bits. @returns A new permission set. */
    public remove(...permissions: (bigint | number | string | PermissionName | PermissionFlagsBits)[]): PermissionSet {
        let bitfield = this.bitfield;
        for (const permission of permissions) bitfield &= ~this.#resolve(permission);
        return new PermissionSet(bitfield);
    }

    /** Checks equality with another permission set or raw bitfield. @param other Permission set or raw bitfield. @returns True when both values are equal. */
    public equals(other: PermissionSet | bigint | number | string): boolean {
        return this.bitfield === (other instanceof PermissionSet ? other.bitfield : new PermissionSet(other).bitfield);
    }

    /** Returns the decimal permission representation. @returns Decimal permission bitfield. */
    public toString(): string {
        return this.bitfield.toString();
    }

    /** Returns known permission names contained in this set. @returns Names of all enabled known permissions. */
    public toArray(): PermissionName[] {
        return (Object.keys(Permissions) as PermissionName[]).filter(permission => this.has(permission));
    }

    /** Resolves a named permission, enum value, or raw bit. @param permission Permission name, enum value, or raw bit. @returns Numeric permission bit. */
    #resolve(permission: bigint | number | string | PermissionName | PermissionFlagsBits): bigint {
        if (typeof permission === "bigint") return permission;
        if (typeof permission === "number") return BigInt(permission);
        if (typeof permission === "string") {
            if (permission in Permissions) return (Permissions as Record<string, bigint>)[permission]!;
            if (permission in PermissionFlagsBits) return BigInt((PermissionFlagsBits as Record<string, string>)[permission]!);
            return BigInt(permission);
        }
        return 0n;
    }
}

/** Discord.js-compatible name for the immutable permission bitfield. */
export class PermissionsBitField extends PermissionSet {
    /** Permission flags bits enum. */
    public static readonly Flags = PermissionFlagsBits;
    /** Permission flags constants. */
    public static readonly All = Permissions;

    /** Creates a permissions bitfield. @param value Initial permission bitfield. */
    public constructor(value: bigint | number | string = 0n) {
        super(value);
    }
}
