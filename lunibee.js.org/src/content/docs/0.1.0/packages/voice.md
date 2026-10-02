---
title: "@lunibee/voice"
description: Discord Voice server connections and audio streaming.
slug: 0.1.0/packages/voice
---

# `@lunibee/voice`

`@lunibee/voice` provides audio transport, Voice Gateway v4 connections, and packet encryption.

## Installation

```bash
bun add @lunibee/voice
```

## Features

* UDP voice packet transmission.
* `xsalsa20_poly1305` and `aead_xchacha20_poly1305_ietf` encryption.
* Direct Opus/PCM audio streaming.
