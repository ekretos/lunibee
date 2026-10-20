import { afterEach, describe, expect, test } from "bun:test";
import {
    DaveSession,
    SILENCE_FRAME,
    VoiceNetworking,
    VoiceOpcodes,
    loadDave,
    maxDaveProtocolVersion,
} from "../packages/voice/src/index.ts";
import { startFakeVoiceServer } from "./helpers/fake-voice-server.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function until<T>(
    check: () => T | undefined | false,
    ms = 3000,
): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) throw new Error("until() timed out");
        await Bun.sleep(5);
    }
}

/**
 * A scripted DAVE implementation: it records what the client asks of it and
 * "encrypts" by prefixing 0xEE, so the test can see which frames went through it.
 */
function scriptedDave() {
    const calls: string[] = [];
    let ready = false;
    let failNextCommit = false;
    class DAVESession {
        public constructor(version: number, userId: string, channelId: string) {
            calls.push(`new v${version} ${userId} ${channelId}`);
        }
        get ready() {
            return ready;
        }
        get voicePrivacyCode() {
            return ready ? "12345 67890" : "";
        }
        reinit(version: number) {
            calls.push(`reinit v${version}`);
        }
        reset() {
            calls.push("reset");
        }
        setExternalSender(data: Buffer) {
            calls.push(`external ${[...data]}`);
        }
        getSerializedKeyPackage() {
            calls.push("keyPackage");
            return Buffer.from([0x4b, 0x50]);
        }
        processProposals(op: number, proposals: Buffer, users?: string[]) {
            calls.push(`proposals ${op} ${[...proposals]} [${users}]`);
            return {
                commit: Buffer.from([0xc0]),
                welcome: Buffer.from([0x3e]),
            };
        }
        processWelcome(welcome: Buffer) {
            calls.push(`welcome ${[...welcome]}`);
            ready = true;
        }
        processCommit(commit: Buffer) {
            if (failNextCommit) {
                failNextCommit = false;
                throw new Error("bad commit");
            }
            calls.push(`commit ${[...commit]}`);
            ready = true;
        }
        encryptOpus(packet: Buffer) {
            return Buffer.concat([Buffer.from([0xee]), packet]);
        }
        decrypt(_user: string, _media: number, packet: Buffer) {
            if (packet[0] !== 0xee) throw new Error("not E2EE");
            return packet.subarray(1);
        }
        canPassthrough() {
            return false;
        }
        setPassthroughMode(on: boolean, expiry?: number) {
            calls.push(`passthrough ${on} ${expiry}`);
        }
    }
    return {
        calls,
        failCommit: () => (failNextCommit = true),
        module: { DAVE_PROTOCOL_VERSION: 1, DAVESession },
    };
}

describe("DAVE over the voice gateway", () => {
    test("the whole flow: key package, external sender, proposals, welcome, transitions, E2EE frames", async () => {
        const server = await startFakeVoiceServer({ daveVersion: 1 });
        cleanup.push(() => server.stop());
        const dave = scriptedDave();
        const audio: number[][] = [];
        const networking = new VoiceNetworking(
            {
                guildId: "1",
                channelId: "2",
                userId: "3",
                sessionId: "s",
                token: "t",
                endpoint: server.endpoint,
            },
            { audio: (_user, frame) => audio.push([...frame]) },
            { url: server.url, daveModule: dave.module as never },
        );
        cleanup.push(() => networking.destroy());
        await until(() => networking.state === "ready");
        expect(server.state.identifies[0]!.max_dave_protocol_version).toBe(1);
        // A key package (op 26) goes out as soon as the session is up.
        await until(() =>
            server.state.binary.some(
                (b) => b.op === VoiceOpcodes.DaveMlsKeyPackage,
            ),
        );
        expect([
            ...server.state.binary.find((b) => b.op === 26)!.payload,
        ]).toEqual([0x4b, 0x50]);
        expect(dave.calls.slice(0, 2)).toEqual(["new v1 3 2", "keyPackage"]);

        server.json(VoiceOpcodes.ClientsConnect, { user_ids: ["4", "5"] });
        server.binary(VoiceOpcodes.DaveMlsExternalSender, Uint8Array.of(1, 2));
        // Proposals (op 27): first byte is the operation type.
        server.binary(VoiceOpcodes.DaveMlsProposals, Uint8Array.of(0, 7, 7));
        await until(() =>
            server.state.binary.some(
                (b) => b.op === VoiceOpcodes.DaveMlsCommitWelcome,
            ),
        );
        expect([
            ...server.state.binary.find((b) => b.op === 28)!.payload,
        ]).toEqual([0xc0, 0x3e]);
        expect(dave.calls).toContain("external 1,2");
        expect(dave.calls).toContain("proposals 0 7,7 [4,5]");

        // Welcome (op 30) for transition 5: answer "transition ready" (op 23).
        server.binary(VoiceOpcodes.DaveMlsWelcome, Uint8Array.of(0, 5, 0xaa));
        await until(() =>
            server.state.json.some(
                (j) => j.op === VoiceOpcodes.DaveTransitionReady,
            ),
        );
        expect(server.state.json.find((j) => j.op === 23)!.d).toEqual({
            transition_id: 5,
        });
        server.json(VoiceOpcodes.DaveExecuteTransition, { transition_id: 5 });
        await Bun.sleep(30);
        expect(networking.dave!.active).toBe(true);
        expect(networking.dave!.voicePrivacyCode).toBe("12345 67890");

        // Outgoing frames are E2EE; silence frames are not.
        networking.sendFrame(Uint8Array.of(1, 2));
        networking.sendFrame(SILENCE_FRAME);
        await until(() => server.state.packets.length === 2);
        expect([...server.state.packets[0]!.payload]).toEqual([0xee, 1, 2]);
        expect([...server.state.packets[1]!.payload]).toEqual([
            ...SILENCE_FRAME,
        ]);

        // Incoming frames are decrypted; a frame that fails is dropped.
        server.json(VoiceOpcodes.Speaking, {
            user_id: "4",
            ssrc: 55,
            speaking: 1,
        });
        await Bun.sleep(20);
        server.sendAudio(55, Uint8Array.of(0xee, 9), 1);
        server.sendAudio(55, Uint8Array.of(0x01, 9), 2);
        await until(() => audio.length >= 1);
        await Bun.sleep(30);
        expect(audio).toEqual([[9]]);

        // A commit that fails is reported (op 31) and the session starts over.
        dave.failCommit();
        server.binary(
            VoiceOpcodes.DaveMlsAnnounceCommitTransition,
            Uint8Array.of(0, 6, 1),
        );
        await until(() =>
            server.state.json.some(
                (j) => j.op === VoiceOpcodes.DaveMlsInvalidCommitWelcome,
            ),
        );
        expect(server.state.json.find((j) => j.op === 31)!.d).toEqual({
            transition_id: 6,
        });
        expect(dave.calls.filter((c) => c === "keyPackage").length).toBe(2);

        // Prepare transition to v0 (downgrade) → passthrough, then op 23; epoch 1 re-inits.
        server.json(VoiceOpcodes.DavePrepareTransition, {
            transition_id: 7,
            protocol_version: 0,
        });
        await until(
            () => server.state.json.filter((j) => j.op === 23).length === 2,
        );
        expect(dave.calls).toContain("passthrough true 24");
        server.json(VoiceOpcodes.DavePrepareEpoch, {
            epoch: 1,
            protocol_version: 1,
        });
        await until(
            () => dave.calls.filter((c) => c === "keyPackage").length === 3,
        );
    });

    test("transition 0 executes at once, and an unknown transition is ignored", () => {
        const dave = scriptedDave();
        const session = new DaveSession(dave.module as never, 1, "3", "2", {
            keyPackage: () => undefined,
            invalidTransition: () => undefined,
        });
        expect(session.prepareTransition(0, 1)).toBe(false);
        expect(session.executeTransition(42)).toBe(false);
        expect(session.decrypt(Uint8Array.of(1), "4")).toEqual(
            Uint8Array.of(1),
        ); // no session yet: passthrough
        session.destroy();
    });
});

describe("@snazzah/davey", () => {
    test("loads under Bun and builds a real MLS key package", async () => {
        const module = await loadDave();
        expect(module).not.toBeNull();
        expect(await maxDaveProtocolVersion()).toBeGreaterThanOrEqual(1);
        const packages: Uint8Array[] = [];
        const session = new DaveSession(
            module!,
            1,
            "100000000000000003",
            "100000000000000002",
            {
                keyPackage: (payload) => packages.push(payload),
                invalidTransition: () => undefined,
            },
        );
        session.reinit();
        expect(packages.length).toBe(1);
        expect(packages[0]!.length).toBeGreaterThan(100);
        // Not in a group yet: DAVE is required, so frames are dropped, not sent in the clear.
        expect(session.active).toBe(false);
        expect(session.encrypt(Uint8Array.of(1, 2, 3))).toBeNull();
        session.destroy();
    });
});
