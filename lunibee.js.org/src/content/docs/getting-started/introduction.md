---
title: Introduction
description: What is Lunibee and why should you use it?
---

# Introduction to Lunibee 🐝

**Lunibee** is a modern, lightweight, Bun-first Discord API wrapper for TypeScript. It is designed to provide high performance, low overhead, and a delightful developer experience.

## Philosophy

Traditional Discord libraries often carry heavy legacy abstractions, large dependency trees, and runtimes optimized solely for Node.js. Lunibee was created with a clean slate:

1. **Bun-First Performance**: Leverages Bun's native WebSocket, HTTP client, and microsecond-fast runtime primitives.
2. **Modular Architecture**: Everything is partitioned into focused, layered packages (`@lunibee/core`, `@lunibee/ws`, `@lunibee/rest`, `@lunibee/builders`, etc.). You can use the high-level `lunibee` package or import individual modules directly for microservices.
3. **Resilient Gateway Lifecycle**: Built-in heartbeat acknowledgment verification, zombie connection termination, automatic resume URL tracking, and non-blocking reconnect handling.
4. **Compile-Time Safety**: Discord payload limits (title lengths, embed counts, button constraints) are verified at build time and in builders before network dispatch.
5. **Predictable Caching**: Canonical instance guarantees ensure that modifying or re-fetching resources never yields mismatched, desynchronized objects.

## Comparison with other libraries

| Feature | Lunibee | Traditional Libraries |
| :--- | :--- | :--- |
| **Runtime Target** | Bun native | Node.js |
| **Bundle Size** | Minimal, zero unnecessary dependencies | Large dependency tree |
| **Package Separation** | 100% modular monorepo | Monolithic |
| **Gateway ACKs** | Auto-detected zombie teardown | Often hangs on silent drops |
| **Builder Validation** | Strict compile-time and runtime checks | Ad-hoc runtime throws |
| **Rate Limiting** | Precise bucket-aware retries | Global mutex or complex queues |

Ready to get started? Head over to [Installation](/getting-started/installation/)!
