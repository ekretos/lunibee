---
title: Creating a Bot
description: Setting up your Discord Application, Bot Account, and Bot Token.
---


To connect Lunibee to Discord, you need a Bot Token from the Discord Developer Portal.

## 1. Create an Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** in the top right.
3. Give your application a name (e.g. `My Lunibee Bot`) and accept the Developer Terms.

## 2. Generate a Bot Token

1. In your application dashboard, navigate to the **Bot** tab on the left sidebar.
2. Click **Reset Token** to generate a fresh token.
3. Copy the token and save it in a safe place.

> [!CAUTION]
> Never commit your bot token to source control or share it publicly. Use environment variables (such as a `.env` file).

## 3. Configure Privileged Gateway Intents

Under the **Privileged Gateway Intents** section on the Bot page, enable the intents your bot needs:
- **Message Content Intent** (Required if your bot reads standard message text for prefix commands)
- **Server Members Intent** (Required for guild member events and tracking)
- **Presence Intent** (Required if your bot tracks user statuses)

## 4. Invite the Bot to Your Server

1. Navigate to **OAuth2** -> **URL Generator** on the left menu.
2. Select the `bot` and `applications.commands` scopes.
3. Check the permissions your bot will need (e.g., `Send Messages`, `Embed Links`, `Read Message History`).
4. Copy the generated URL at the bottom, paste it into your browser, and select your server to invite your bot!
