/** Permission bit values exposed by Discord. */
export const Permissions = {
    /** Create instant invite permission. */ CreateInstantInvite: 1n << 0n,
    /** Kick members permission. */ KickMembers: 1n << 1n,
    /** Ban members permission. */ BanMembers: 1n << 2n,
    /** Administrator permission. */ Administrator: 1n << 3n,
    /** Manage channels permission. */ ManageChannels: 1n << 4n,
    /** Manage guild permission. */ ManageGuild: 1n << 5n,
    /** Add reactions permission. */ AddReactions: 1n << 6n,
    /** View audit log permission. */ ViewAuditLog: 1n << 7n,
    /** Priority speaker permission. */ PrioritySpeaker: 1n << 8n,
    /** Stream permission. */ Stream: 1n << 9n,
    /** View channel permission. */ ViewChannel: 1n << 10n,
    /** Send messages permission. */ SendMessages: 1n << 11n,
    /** Send TTS messages permission. */ SendTTSMessages: 1n << 12n,
    /** Manage messages permission. */ ManageMessages: 1n << 13n,
    /** Embed links permission. */ EmbedLinks: 1n << 14n,
    /** Attach files permission. */ AttachFiles: 1n << 15n,
    /** Read message history permission. */ ReadMessageHistory: 1n << 16n,
    /** Mention everyone permission. */ MentionEveryone: 1n << 17n,
    /** Use external emojis permission. */ UseExternalEmojis: 1n << 18n,
    /** View guild insights permission. */ ViewGuildInsights: 1n << 19n,
    /** Connect permission. */ Connect: 1n << 20n,
    /** Speak permission. */ Speak: 1n << 21n,
    /** Mute members permission. */ MuteMembers: 1n << 22n,
    /** Deafen members permission. */ DeafenMembers: 1n << 23n,
    /** Move members permission. */ MoveMembers: 1n << 24n,
    /** Use voice activity detection permission. */ UseVAD: 1n << 25n,
    /** Change nickname permission. */ ChangeNickname: 1n << 26n,
    /** Manage nicknames permission. */ ManageNicknames: 1n << 27n,
    /** Manage roles permission. */ ManageRoles: 1n << 28n,
    /** Manage webhooks permission. */ ManageWebhooks: 1n << 29n,
    /** Manage guild expressions permission. */ ManageGuildExpressions: 1n << 30n,
    /** Use application commands permission. */ UseApplicationCommands: 1n << 31n,
    /** Request to speak permission. */ RequestToSpeak: 1n << 32n,
    /** Manage events permission. */ ManageEvents: 1n << 33n,
    /** Manage threads permission. */ ManageThreads: 1n << 34n,
    /** Create public threads permission. */ CreatePublicThreads: 1n << 35n,
    /** Create private threads permission. */ CreatePrivateThreads: 1n << 36n,
    /** Use external stickers permission. */ UseExternalStickers: 1n << 37n,
    /** Send messages in threads permission. */ SendMessagesInThreads: 1n << 38n,
    /** Use embedded activities permission. */ UseEmbeddedActivities: 1n << 39n,
    /** Moderate members permission. */ ModerateMembers: 1n << 40n,
    /** View creator monetization analytics permission. */ ViewCreatorMonetizationAnalytics: 1n << 41n,
    /** Use soundboard permission. */ UseSoundboard: 1n << 42n,
    /** Create guild expressions permission. */ CreateGuildExpressions: 1n << 43n,
    /** Create events permission. */ CreateEvents: 1n << 44n,
    /** Use external sounds permission. */ UseExternalSounds: 1n << 45n,
    /** Send voice messages permission. */ SendVoiceMessages: 1n << 46n,
    /** Send polls permission. */ SendPolls: 1n << 49n,
    /** Use external apps permission. */ UseExternalApps: 1n << 50n
} as const;

/** Public permission names. */
export type PermissionName = keyof typeof Permissions;

/** Immutable Discord permission bitfield. */
export class PermissionSet {
    /** Permission bitfield. */ public readonly bitfield: bigint;
    /** Creates a permission set. @param value Initial permission bitfield. @throws {RangeError} If the value is negative. @throws {TypeError} If the value is not a valid integer. */
    public constructor(value: bigint | number | string = 0n) { try { const bitfield = BigInt(value); if (bitfield < 0n) throw new RangeError("Permission bitfield cannot be negative."); this.bitfield = bitfield; } catch (error) { if (error instanceof RangeError) throw error; throw new TypeError("Permission bitfield must be a valid non-negative integer.", { cause: error }); } }
    /** Checks whether all supplied permissions are present. @param permissions Permission names or raw bits. @returns True when every requested permission is present. */ public has(...permissions: (bigint | PermissionName)[]): boolean { return permissions.every(permission => (this.bitfield & this.#resolve(permission)) === this.#resolve(permission)); }
    /** Checks whether any supplied permission is present. @param permissions Permission names or raw bits. @returns True when at least one requested permission is present. */ public any(...permissions: (bigint | PermissionName)[]): boolean { return permissions.some(permission => (this.bitfield & this.#resolve(permission)) !== 0n); }
    /** Returns a new set with permissions added. @param permissions Permission names or raw bits. @returns A new permission set. */ public add(...permissions: (bigint | PermissionName)[]): PermissionSet { let bitfield = this.bitfield; for (const permission of permissions) bitfield |= this.#resolve(permission); return new PermissionSet(bitfield); }
    /** Returns a new set with permissions removed. @param permissions Permission names or raw bits. @returns A new permission set. */ public remove(...permissions: (bigint | PermissionName)[]): PermissionSet { let bitfield = this.bitfield; for (const permission of permissions) bitfield &= ~this.#resolve(permission); return new PermissionSet(bitfield); }
    /** Checks equality with another permission set or raw bitfield. @param other Permission set or raw bitfield. @returns True when both values are equal. */ public equals(other: PermissionSet | bigint | number | string): boolean { return this.bitfield === (other instanceof PermissionSet ? other.bitfield : new PermissionSet(other).bitfield); }
    /** Returns the decimal permission representation. @returns Decimal permission bitfield. */ public toString(): string { return this.bitfield.toString(); }
    /** Returns known permission names contained in this set. @returns Names of all enabled known permissions. */ public toArray(): PermissionName[] { return (Object.keys(Permissions) as PermissionName[]).filter(permission => this.has(permission)); }
    /** Resolves a named permission or raw bit. @param permission Permission name or raw bit. @returns Numeric permission bit. */ #resolve(permission: bigint | PermissionName): bigint { return typeof permission === "bigint" ? permission : Permissions[permission] as bigint; }
}

/** Discord.js-compatible permission bitfield. */
export class PermissionsBitField extends PermissionSet {
    /** Creates a permissions bitfield. @param value Initial permission bitfield. */
    public constructor(value: bigint | number | string = 0n) { super(value); }
}
