import { BaseStructure } from "./base.js";
import type { 
    APIAuditLog, 
    APIAuditLogEntry, 
    APIAuditLogChange, 
    APIAuditLogOptions 
} from "@lunibee/types";

/** Represents a single entry in a Discord audit log. */
export class AuditLogEntry extends BaseStructure {
    /** The ID of the affected entity. */
    public readonly targetId: string | null;
    /** The ID of the user who made the changes. */
    public readonly userId: string | null;
    /** The action type of this entry. */
    public readonly actionType: number;
    /** The changes made to the target. */
    public readonly changes: APIAuditLogChange[];
    /** Additional info for certain action types. */
    public readonly options: APIAuditLogOptions | null;
    /** The reason for the change, if any. */
    public readonly reason: string | null;

    /** Creates an audit log entry. */
    public constructor(data: APIAuditLogEntry) {
        super(data.id);
        this.targetId = data.target_id;
        this.userId = data.user_id;
        this.actionType = data.action_type;
        this.changes = data.changes ?? [];
        this.options = data.options ?? null;
        this.reason = data.reason ?? null;
    }
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
}
