import { describe, expect, test } from "bun:test";
import { AuditLog, AuditLogEntry } from "../packages/structures/src/index.js";
import type { APIAuditLog, APIAuditLogEntry } from "../packages/types/src/index.js";

describe("AuditLog Structure", () => {
    test("creates an AuditLog and entries correctly", () => {
        const rawEntry: APIAuditLogEntry = {
            id: "1234567890",
            target_id: "9876543210",
            user_id: "111111111",
            action_type: 1,
            changes: [
                { key: "name", old_value: "foo", new_value: "bar" }
            ],
            reason: "Testing",
        };
        
        const rawAuditLog: APIAuditLog = {
            audit_log_entries: [rawEntry],
            guild_scheduled_events: [],
            integrations: [],
            threads: [],
            users: [],
            webhooks: [],
            application_commands: [],
            auto_moderation_rules: [],
        };
        
        const auditLog = new AuditLog(rawAuditLog);
        
        expect(auditLog.entries.size).toBe(1);
        const entry = auditLog.entries.get("1234567890");
        expect(entry).toBeDefined();
        
        if (entry) {
            expect(entry.id).toBe("1234567890");
            expect(entry.targetId).toBe("9876543210");
            expect(entry.userId).toBe("111111111");
            expect(entry.actionType).toBe(1);
            expect(entry.changes.length).toBe(1);
            expect(entry.changes[0].key).toBe("name");
            expect(entry.changes[0].old_value).toBe("foo");
            expect(entry.changes[0].new_value).toBe("bar");
            expect(entry.reason).toBe("Testing");
            expect(entry.options).toBeNull();
        }
    });
});
