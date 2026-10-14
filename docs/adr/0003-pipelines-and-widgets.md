# 0003. Automation with pipelines; widgets are a separate concept

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

Streamers want "when X happens, do Y and Z": a channel-point reward spins a wheel, the result goes to chat and plays a sound. Some on-stream things (an alert box, a wheel, a poll) persist between events, have settings and an overlay URL, and must not overlap with themselves.

## Decision

- **Pipelines** are node graphs: **triggers → logic → actions**, without loops, edited on a canvas. One output linked to several nodes runs those branches **in parallel**. Each execution is a **run**.
- **Widgets** are a separate, persistent concept: settings, internal state, an action queue and an overlay URL. Pipelines drive widgets through **widget actions** (`show-alert`, `spin`) and react to them through **widget events** (`wheel.landed`).
- Some widgets, such as the chat view, read events directly and need no pipeline.

## Alternatives considered

- **Widgets with built-in rules (each widget decides when it fires):** simple at first, but logic gets duplicated across widgets and can't be combined.
- **Everything is a node (widgets live inside pipelines):** a widget used by several pipelines would have no single owner for its settings, state and queue.

## Consequences

- The plugin manifest describes widget actions and events with schemas and sample payloads, so the editor can generate action nodes and event triggers.
- A widget's queue serializes its actions even when several pipelines drive it.
