---
title: "@lunibee/ws"
description: High-performance Discord WebSocket Gateway connection.
slug: 0.1.0/packages/ws
---

# `@lunibee/ws`

The `@lunibee/ws` package handles the Discord Gateway WebSocket protocol.

## Installation

```bash
bun add @lunibee/ws
```

## Features

* Automatic Heartbeat ACK watchdog and zombie connection detection.
* Fast session resume using `resume_gateway_url`.
* Opcode dispatching and typed gateway events.
