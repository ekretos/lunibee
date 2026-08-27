import { describe, expect, test } from "bun:test";
import { ClientState } from "@lunibee/core";

describe("ClientState", () => {
    test("starts idle", () => {
        expect(new ClientState().status).toBe("idle");
    });

    test("accepts valid lifecycle transitions", () => {
        const state = new ClientState();
        state.transition("connecting");
        state.transition("ready");
        state.transition("disconnecting");
        state.transition("disconnected");
        expect(state.status).toBe("disconnected");
    });

    test("rejects invalid lifecycle transitions", () => {
        const state = new ClientState();
        expect(() => state.transition("ready")).toThrow("Invalid client state transition: idle -> ready");
    });

    test("reports transition availability", () => {
        const state = new ClientState();
        expect(state.canTransition("connecting")).toBe(true);
        expect(state.canTransition("ready")).toBe(false);
    });
});
