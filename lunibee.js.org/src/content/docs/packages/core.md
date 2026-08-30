---
title: "@lunibee/core"
description: Main Client coordinator, event emitter, and lifecycle state.
---

# `@lunibee/core`

The `@lunibee/core` package provides the main `Client` abstraction and ties together `@lunibee/ws`, `@lunibee/rest`, and `@lunibee/managers`.

## Installation

```bash
bun add @lunibee/core
```

## Exports

- `Client`: High-level bot coordinator
- `HandlerRegistry`: Type-safe Gateway event dispatch registry
- `PermissionsBitField`: Permission bit manipulation
