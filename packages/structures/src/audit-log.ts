import { BaseStructure } from "./base.js";
import type {
    APIAuditLog,
    APIAuditLogEntry,
    APIAuditLogChange,
    APIAuditLogOptions,
} from "@lunibee/types";

/** What `info` holds for each action type that carries extra details (numbers are parsed from Discord's strings). */
export interface AuditLogInfoByType {
    /** Overwrite created, updated or deleted: a role (`type` 0) or a member (`type` 1). */
    13: AuditLogOverwriteInfo;
    14: AuditLogOverwriteInfo;
    15: AuditLogOverwriteInfo;
    /** Member prune. */
    21: { deleteMemberDays: number; membersRemoved: number };
    /** Members moved between voice channels. */
    26: { channelId: string; count: number };
    /** Members disconnected from voice. */
    27: { count: number };
    /** Message deleted in a channel. */
    72: { channelId: string; count: number };
    /** Messages bulk deleted. */
    73: { count: number };
    /** Message pinned or unpinned. */
    74: { channelId: string; messageId: string };
    75: { channelId: string; messageId: string };
    /** Stage instance created, updated or deleted. */
    83: { channelId: string };
    84: { channelId: string };
    85: { channelId: string };
    /** Application command permissions updated. */
    121: { applicationId: string };
    /** AutoMod blocked a message, flagged it, or timed a member out. */
    143: AuditLogAutoModInfo;
    144: AuditLogAutoModInfo;
    145: AuditLogAutoModInfo;
}

/** The overwrite an audit entry is about. */
export interface AuditLogOverwriteInfo {
    /** The role or user the overwrite is for. */
    id: string;
    /** 0 role, 1 member. */
    type: number;
    roleName?: string;
}

/** The rule behind an AutoMod audit entry. */
export interface AuditLogAutoModInfo {
    ruleName: string;
    ruleTriggerType: number;
    channelId?: string;
}

/** The details object of an action type, or `undefined` when the type has none. */
export type AuditLogInfo<T extends number> = number extends T
    ? AuditLogInfoByType[keyof AuditLogInfoByType] | undefined
    : T extends keyof AuditLogInfoByType
      ? AuditLogInfoByType[T]
      : undefined;

function int(value: string | undefined): number {
    return Number(value ?? 0);
}

/** Reads Discord's string-valued options into the typed `info` of one action type. */
function parseInfo(
    type: number,
    options: APIAuditLogOptions | undefined,
): AuditLogInfoByType[keyof AuditLogInfoByType] | undefined {
    if (!options) return undefined;
    switch (type) {
        case 13:
        case 14:
        case 15:
            return {
                id: options.id ?? "",
                type: int(options.type),
                roleName: options.role_name,
            };
        case 21:
            return {
                deleteMemberDays: int(options.delete_member_days),
                membersRemoved: int(options.members_removed),
            };
        case 26:
        case 72:
            return {
                channelId: options.channel_id ?? "",
                count: int(options.count),
            };
        case 27:
        case 73:
            return { count: int(options.count) };
        case 74:
        case 75:
            return {
                channelId: options.channel_id ?? "",
                messageId: options.message_id ?? "",
            };
        case 83:
        case 84:
        case 85:
            return { channelId: options.channel_id ?? "" };
        case 121:
            return { applicationId: options.app_id ?? "" };
        case 143:
        case 144:
        case 145:
            return {
                ruleName: options.auto_moderation_rule_name ?? "",
                ruleTriggerType: int(options.auto_moderation_rule_trigger_type),
                channelId: options.channel_id,
            };
        default:
            return undefined;
    }
}

/** Represents a single entry in a Discord audit log. */
export class AuditLogEntry<T extends number = number> extends BaseStructure {
    /** The ID of the affected entity. */
    public readonly targetId: string | null;
    /** The ID of the user who made the changes. */
    public readonly userId: string | null;
    /** The action type of this entry. */
    public readonly actionType: T;
    /** The changes made to the target. */
    public readonly changes: APIAuditLogChange[];
    /** Additional info for certain action types. */
    public readonly options: APIAuditLogOptions | null;
    /** The action's details with numbers parsed, typed by action type (`undefined` for types that have none). `options` is Discord's raw object. */
    public readonly info: AuditLogInfo<T>;
    /** The reason for the change, if any. */
    public readonly reason: string | null;

    /** Creates an audit log entry. */
    public constructor(data: APIAuditLogEntry) {
        super(data.id);
        this.targetId = data.target_id;
        this.userId = data.user_id;
        this.actionType = data.action_type as T;
        this.info = parseInfo(
            data.action_type,
            data.options,
        ) as AuditLogInfo<T>;
        this.changes = data.changes ?? [];
        this.options = data.options ?? null;
        this.reason = data.reason ?? null;
    }

    /** Narrows the entry to one action type, so `info` is typed for it. */
    public is<K extends number>(type: K): this is AuditLogEntry<K> {
        return (this.actionType as number) === type;
    }

    /** One change by its key (`"nick"`, `"permissions"`...), or `undefined`. */
    public change(key: string): { old: unknown; new: unknown } | undefined {
        const found = this.changes.find((change) => change.key === key);
        return found && { old: found.old_value, new: found.new_value };
    }
}

/** Which entries {@link AuditLog.find} and {@link AuditLog.filter} keep. Every field given must match. */
export interface AuditLogQuery<T extends number = number> {
    /** One action type, or any of several. */
    type?: T | readonly T[];
    /** The affected entity. */
    targetId?: string;
    /** Who did it. */
    userId?: string;
    /** Only entries created at or after this time (a Date, an ISO string or milliseconds). */
    since?: Date | string | number;
}

/** Represents a Discord audit log. */
export class AuditLog {
    /** The entries in the audit log. */
    public readonly entries: Map<string, AuditLogEntry>;
    // Depending on what else is needed, we could parse the users, webhooks, etc.
    // However, the typical structure mainly exposes the entries.

    /** Creates an audit log. */
    public constructor(data: APIAuditLog) {
        this.entries = new Map();
        for (const entryData of data.audit_log_entries) {
            this.entries.set(entryData.id, new AuditLogEntry(entryData));
        }
    }

    /** The entries that match `query`, newest first (the order Discord returns them in). */
    public filter<T extends number = number>(
        query: AuditLogQuery<T>,
    ): AuditLogEntry<T>[] {
        const types =
            query.type === undefined
                ? undefined
                : Array.isArray(query.type)
                  ? (query.type as readonly number[])
                  : [query.type as number];
        const since =
            query.since === undefined
                ? undefined
                : new Date(query.since).getTime();
        const matches: AuditLogEntry<T>[] = [];
        for (const entry of this.entries.values()) {
            if (types && !types.includes(entry.actionType)) continue;
            if (
                query.targetId !== undefined &&
                entry.targetId !== query.targetId
            )
                continue;
            if (query.userId !== undefined && entry.userId !== query.userId)
                continue;
            if (since !== undefined && entry.createdAt.getTime() < since)
                continue;
            matches.push(entry as unknown as AuditLogEntry<T>);
        }
        return matches;
    }

    /** The newest entry that matches `query`, or `undefined`. */
    public find<T extends number = number>(
        query: AuditLogQuery<T>,
    ): AuditLogEntry<T> | undefined {
        return this.filter(query)[0];
    }
}
