# 0007. The server binds to 127.0.0.1; LAN access is opt-in

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

The local server controls the streamer's channel (chat, rewards, polls) and, later, keyboard input. Any web page open in the same browser can send requests to `localhost`, and DNS rebinding can make a remote page look same-origin.

## Decision

- The server binds to **127.0.0.1** only by default.
- **LAN access** (for two-PC setups) is **opt-in**, and LAN overlay URLs carry a secret **token**.
- The server checks a **Host allowlist** and the **Origin** of state-changing requests and WebSocket upgrades. Dashboard API calls need a session created from a one-time token in the URL the tray opens.

## Alternatives considered

- **Bind to 0.0.0.0 by default:** convenient for two-PC setups, but exposes the API to the whole network.

## Consequences

- Two-PC streamers must turn on LAN access and use the tokenized URLs.
- The security checks are built in Phase 1, before any feature that changes state.
