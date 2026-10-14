# 0004. In-house pipeline engine and React Flow editor; no n8n or Node-RED

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

The pipeline engine must react to live stream events in milliseconds, hold state (queues, cooldowns, variables), and ship inside an MIT-licensed desktop app. The editor must be part of the React dashboard and reuse its settings forms.

## Decision

Overly builds its **own pipeline engine** in TypeScript, and the editor uses **React Flow** (`@xyflow/react`).

## Alternatives considered

- **Embed n8n:** its Sustainable Use License is not OSI-approved and is incompatible with shipping inside an MIT app. It is built for server workflows stored per run in a database, not real-time events. Its editor is Vue. Overly **connects to it instead**, through webhook trigger and HTTP request nodes.
- **Embed Node-RED:** Apache-2.0 and embeddable, but its editor is jQuery-based, and community nodes' settings screens can't be reused in a React UI.

## Consequences

- We own the executor, expressions, overlap modes, timeouts and run history, and must test them well.
- The engine's node execution API matches the widget host API, so third-party nodes can run out of process (ADR 0005).
- n8n, Make and Zapier users get interop rather than embedding.
