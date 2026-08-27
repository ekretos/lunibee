# Lunibee architecture

Lunibee is organized around a lightweight Bun-first core.

- `packages/` contains distributable library packages.
- `tests/` contains repository-level validation.
- `examples/` contains user-facing usage examples.
- `docs/` contains project documentation.
- `benchmarks/` contains performance experiments.
- `.github/workflows/` contains repository automation.

Discord entities such as messages and interactions belong to `structures`. Transport systems such as REST and Gateway remain independent. Builders construct Discord payloads without becoming resource structures.
