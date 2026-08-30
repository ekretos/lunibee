import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  Gateway,
  GatewayError,
  GatewayOpcodes,
} from "../packages/ws/src/index.ts";

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  closeCode?: number;
  closeReason?: string;
  #listeners = new Map<string, Set<(event: any) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static instances: FakeWebSocket[] = [];

  addEventListener(event: string, listener: (event: any) => void): void {
    let listeners = this.#listeners.get(event);
    if (!listeners) this.#listeners.set(event, (listeners = new Set()));
    listeners.add(listener);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN)
      throw new Error("socket is not open");
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.closeCode = code;
    this.closeReason = reason;
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  receive(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(value);
  }
}

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

describe("Gateway integration lifecycle", () => {
  test("settles connect only after the socket opens", async () => {
    const gateway = new Gateway({
      token: "token",
      intents: 1,
      reconnect: false,
    });
    let settled = false;
    const promise = gateway.connect("wss://example.test").then(() => {
      settled = true;
    });
    const socket = FakeWebSocket.instances[0]!;

    await Promise.resolve();
    expect(settled).toBe(false);
    socket.open();
    await promise;
    expect(settled).toBe(true);
    gateway.close();
  });

  test("responds to HELLO with IDENTIFY and schedules heartbeats", async () => {
    const gateway = new Gateway({
      token: "token",
      intents: 513,
      reconnect: false,
    });
    const promise = gateway.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await promise;

    socket.receive({
      op: GatewayOpcodes.Hello,
      d: { heartbeat_interval: 100 },
    });
    const identify = JSON.parse(socket.sent[0]!);
    expect(identify.op).toBe(GatewayOpcodes.Identify);
    expect(identify.d.token).toBe("token");
    expect(identify.d.intents).toBe(513);
    gateway.close();
  });

  test("marks heartbeat acknowledgements as healthy", async () => {
    const gateway = new Gateway({
      token: "token",
      intents: 1,
      reconnect: false,
    });
    const promise = gateway.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await promise;
    socket.receive({ op: GatewayOpcodes.Hello, d: { heartbeat_interval: 50 } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    socket.receive({ op: GatewayOpcodes.HeartbeatAck, d: null });
    expect(socket.closeCode).toBeUndefined();
    gateway.close();
  });

  test("reconnects after a recoverable close", async () => {
    const gateway = new Gateway({
      token: "token",
      intents: 1,
      reconnectBaseDelay: 1,
      reconnectMaxDelay: 1,
    });
    const first = gateway.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await first;
    socket.close(1000, "network failure");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(FakeWebSocket.instances.length).toBe(2);
    gateway.close();
  });

  test("clears session state after INVALID_SESSION", async () => {
    const gateway = new Gateway({
      token: "token",
      intents: 1,
      reconnect: false,
    });
    const promise = gateway.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await promise;
    socket.receive({
      op: GatewayOpcodes.Dispatch,
      t: "READY",
      s: 42,
      d: { session_id: "session", resume_gateway_url: "wss://resume.test" },
    });
    socket.receive({ op: GatewayOpcodes.InvalidSession, d: false });
    expect(socket.closeCode).toBe(1000);
    gateway.close();
  });

  test("reports and closes a zombie connection", async () => {
    const gateway = new Gateway({
      token: "token",
      intents: 1,
      reconnect: false,
      heartbeatAckTimeout: 10,
      zombieTimeout: 25,
    });
    const zombies: unknown[] = [];
    gateway.on("zombie", (data) => zombies.push(data));
    gateway.on("error", (error) => expect(error).toBeInstanceOf(GatewayError));
    const promise = gateway.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await promise;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(zombies.length).toBe(1);
    expect(socket.closeCode).toBe(1001);
    gateway.close();
  });
});
