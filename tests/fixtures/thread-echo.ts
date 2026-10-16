// A cluster thread for the threadFork unit test: echoes through its endpoint.
import { threadEndpoint } from "../../packages/sharding/src/thread.ts";

const port = threadEndpoint()!;
const listener = (frame: { exit?: number; echo?: unknown; off?: boolean }) => {
    if (frame.off) {
        port.off("message", listener as never);
        port.send({ off: true });
        return;
    }
    if (frame.exit !== undefined) process.exit(frame.exit);
    port.send({
        echo: frame.echo,
        env: process.env.CLUSTER_ID,
        same: threadEndpoint() === port,
    });
};
port.on("message", listener as never);
port.on("disconnect", () => undefined);
port.send({ up: true });
