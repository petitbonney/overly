# 0015. Widget backends talk to the host through JSON messages; built-ins are bundled

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

ADR 0005 decides that plugins may ship backend code, that third-party backends run in their own process (Phase 8), and that built-in plugins use the same format. Phase 2 needs backends now (the Text banner keeps its state, Alerts emits `alert.finished`), but only built-in ones. If built-in backends call the server directly, nothing guarantees that the same code will work across a process boundary later.

## Decision

- Backends and the server (the host) exchange **JSON messages** only, defined with Zod in `@overly/shared` (`start`, `settings`, `action`, `overlayConnected`, `overlayActionResult`, `migrate`, `stop`; and back `ready`, `actionResult`, `setState`, `emitToOverlay`, `overlayAction`, `emitEvent`, `log`, `migrateResult`). The receiving side validates every message.
- The backend side of the protocol lives in the SDK: `runPluginBackend(definition, channel)`, with `definePluginBackend` and `defineWidgetBackend` for authors. One connection serves all widgets of a plugin; the host drops messages about widgets it didn't start on that connection.
- Built-in backends are **imported into the sidecar bundle** (`apps/server/src/plugins/builtin.ts`) and run in-process behind a channel that **JSON-clones every message** and delivers it asynchronously, so anything a child process couldn't carry fails now.
- The manifest's `backend` path stays required and checked for built-ins, so a built-in plugin folder is a valid plugin folder. The build copies it but never runs it.

## Alternatives considered

- **Build each built-in backend and load it with `import()` from the plugin folder:** closer to Phase 8, but every plugin would need its own build step, and `bun run dev` would need to watch them all.
- **Direct function calls for built-ins, messages only for third parties:** simpler today, but built-ins could use things (functions, class instances, shared objects) that break once they move out of process, and the protocol would have no real user until Phase 8.

## Consequences

- Phase 8 only swaps the channel (in-process for child-process IPC) and adds permission checks; plugin code and the protocol don't change.
- Built-in backend code ships inside `server.mjs`. Updating a built-in plugin means updating Overly.
- Every call pays for a JSON round trip, which is negligible at stream event rates.
