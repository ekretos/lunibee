# @lunibee/handlers

> A small, typed event-handler registry.

```bash
bun add @lunibee/handlers
```

```ts
import { HandlerRegistry } from "@lunibee/handlers";

type Events = {
    greet: [name: string];
    shutdown: [];
};

const handlers = new HandlerRegistry<Events>();
handlers.on("greet", (name) => console.log(`Hello ${name}`));
handlers.once("shutdown", () => console.log("Bye"));

await handlers.emit("greet", "bee"); // handlers run in order and are awaited
await handlers.dispatch("shutdown");
```

`on`, `once` and `off` register and remove handlers; `dispatch` (alias `emit`) awaits each
handler in registration order. The `lunibee` CLI generates a registry file that binds
`src/events/*` handlers to a client.
