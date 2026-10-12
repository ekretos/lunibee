# Examples

Examples are kept outside `packages/` so they remain documentation and integration material rather than published runtime packages.

- `basic/`: one `Client` with a slash command.
- `cluster/`: a `ClusterManager` parent and a worker running a `ShardManager`; `host.ts` joins extra machines (needs `DISCORD_TOKEN`; start `manager.ts`).
