/** Permission bit values exposed by Discord. */
export const Permissions = {
    CreateInstantInvite: 1n << 0n, KickMembers: 1n << 1n, BanMembers: 1n << 2n, Administrator: 1n << 3n,
    ManageChannels: 1n << 4n, ManageGuild: 1n << 5n, AddReactions: 1n << 6n, ViewAuditLog: 1n << 7n,
    PrioritySpeaker: 1n << 8n, Stream: 1n << 9n, ViewChannel: 1n << 10n, SendMessages: 1n << 11n,
    SendTTSMessages: 1n << 12n, ManageMessages: 1n << 13n, EmbedLinks: 1n << 14n, AttachFiles: 1n << 15n,
    ReadMessageHistory: 1n << 16n, MentionEveryone: 1n << 17n, UseExternalEmojis: 1n << 18n, ViewGuildInsights: 1n << 19n,
    Connect: 1n << 20n, Speak: 1n << 21n, MuteMembers: 1n << 22n, DeafenMembers: 1n << 23n,
    MoveMembers: 1n << 24n, UseVAD: 1n << 25n, ChangeNickname: 1n << 26n, ManageNicknames: 1n << 27n,
    ManageRoles: 1n << 28n, ManageWebhooks: 1n << 29n, ManageGuildExpressions: 1n << 30n, UseApplicationCommands: 1n << 31n,
    RequestToSpeak: 1n << 32n, ManageEvents: 1n << 33n, ManageThreads: 1n << 34n, CreatePublicThreads: 1n << 35n,
    CreatePrivateThreads: 1n << 36n, UseExternalStickers: 1n << 37n, SendMessagesInThreads: 1n << 38n,
    UseEmbeddedActivities: 1n << 39n, ModerateMembers: 1n << 40n, ViewCreatorMonetizationAnalytics: 1n << 41n,
    UseSoundboard: 1n << 42n, CreateGuildExpressions: 1n << 43n, CreateEvents: 1n << 44n, UseExternalSounds: 1n << 45n,
    SendVoiceMessages: 1n << 46n, SendPolls: 1n << 49n, UseExternalApps: 1n << 50n
} as const;

/** Public permission names. */
export type PermissionName = keyof typeof Permissions;

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
    public has(...permissions: (bigint | PermissionName)[]): boolean {
        return permissions.every(permission => {
            const bit = this.#resolve(permission);
            return (this.bitfield & bit) === bit;
        });
    }

    /** Checks whether any supplied permission is present. @param permissions Permission names or raw bits. @returns True when at least one requested permission is present. */
    public any(...permissions: (bigint | PermissionName)[]): boolean {
        return permissions.some(permission => (this.bitfield & this.#resolve(permission)) !== 0n);
    }

    /** Returns a new set with permissions added. @param permissions Permission names or raw bits. @returns A new permission set. */
    public add(...permissions: (bigint | PermissionName)[]): PermissionSet {
        let bitfield = this.bitfield;
        for (const permission of permissions) bitfield |= this.#resolve(permission);
        return new PermissionSet(bitfield);
    }

    /** Returns a new set with permissions removed. @param permissions Permission names or raw bits. @returns A new permission set. */
    public remove(...permissions: (bigint | PermissionName)[]): PermissionSet {
        let bitfield = this.bitfield;
        for (const permission of permissions) bitfield &= ~this.#resolve(permission);
        return new PermissionSet(bitfield);
    }

    /** Checks equality with another permission set or raw bitfield. @param other Permission set or raw bitfield. @returns True when both values are equal. */
    public equals(other: PermissionSet | bigint | number | string): boolean {
        return this.bitfield === (other instanceof PermissionSet ? other.bitfield : new PermissionSet(other).bitfield);
    }

    /** Returns the decimal permission representation. @returns Decimal permission bitfield. */
    public toString(): string { return this.bitfield.toString(); }

    /** Returns known permission names contained in this set. @returns Names of all enabled known permissions. */
    public toArray(): PermissionName[] {
        return (Object.keys(Permissions) as PermissionName[]).filter(permission => this.has(permission));
    }

    /** Resolves a named permission or raw bit. @param permission Permission name or raw bit. @returns Numeric permission bit. */
    #resolve(permission: bigint | PermissionName): bigint {
        return typeof permission === "bigint" ? permission : Permissions[permission] as bigint;
    }
}
