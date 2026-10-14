# 0005. Plugins add nodes and widgets, with isolated backend code

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

The community should be able to add widget types and node types. Many useful plugins need server-side logic (vote counting, API calls), so plugins must be able to ship code that runs on the user's machine.

## Decision

- Extensions are **plugins**, described by an `overly.plugin.json` manifest, that add **node types and/or widget types**.
- Plugins may include **backend code**. It is accepted through a **trust prompt** (source, author, permissions, an "includes backend code" warning) and runs in its **own child process**, with **permission-scoped** platform APIs and a message-based API.
- **Built-in features use the same plugin format** (`plugins/`). Built-in plugins may run in the server process; the message-based API keeps that an implementation detail.

## Alternatives considered

- **Overlay-only plugins (no backend):** safe, but can't do vote counting, timers or external calls.
- **In-process third-party code:** a crashing or slow plugin would take down the server and every pipeline.

## Consequences

- Plugin backends are still full-trust code; isolation limits crashes and API access, not what the code can do on the machine. The docs and the trust prompt say so.
- The manifest format and the host API are public contracts, versioned with `apiVersion` and frozen at v1.0.
