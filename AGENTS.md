# AGENTS.md

Instructions for AI coding agents (and humans) working on Overly. `CLAUDE.md` imports this file. Read [README.md](README.md) for the product and [ROADMAP.md](ROADMAP.md) for the plan: work happens phase by phase, and each phase has exit criteria.

## What Overly is

A desktop app for streamers that lives in the system tray. It serves **widgets** (overlays added to OBS as Browser Sources) and runs **pipelines** (node-based automations) driven by Twitch events. Everything runs locally.

## Architecture

```
Tauri shell (Rust, apps/desktop)          tray, single instance, keychain, input injection
   │ spawns + stdio JSON-RPC
   ▼
Node sidecar (TS, apps/server)            Fastify HTTP + WebSocket on 127.0.0.1
   ├─ platforms (Twitch EventSub/Helix) → event bus
   ├─ pipeline engine (triggers → logic → actions)
   ├─ widget host + action queues
   ├─ plugin registry / plugin host (third-party backends in child processes)
   └─ storage (JSON documents in the OS app-data folder)
   ▲ HTTP + WS
Dashboard (React SPA, apps/dashboard)     opened in the default browser
Overlays (/o/<widgetId>, @overly/sdk)     loaded by OBS Browser Sources
```

| Path | Contents |
|---|---|
| `apps/desktop` | Tauri v2 shell (Rust, `src-tauri/`). No windows, only a tray. |
| `apps/server` | Node sidecar: HTTP/WS server, platforms, pipeline engine, plugin host, storage. |
| `apps/dashboard` | React SPA: widget pages, pipeline canvas (React Flow). |
| `packages/shared` | Types and Zod schemas shared by everything (events, manifests, widgets, pipelines), plus constants such as the Twitch Client ID. |
| `packages/sdk` | `@overly/sdk`: overlay side and widget/node backend side. Public API for plugin authors. |
| `packages/create-plugin` | `bun create overly-plugin` scaffolder. |
| `plugins/` | Built-in plugins, in the same format as third-party ones. |
| `docs/adr/` | Architecture Decision Records. Read them before changing anything they cover. |

Workspaces import each other by package name (`@overly/shared`), declared as `"workspace:*"` dependencies and as TypeScript project `references`.

## Glossary

- **Widget type**: a kind of widget declared by a plugin ("Alerts", "Spin wheel"): settings schema, optional overlay, actions, events, optional backend.
- **Widget**: a configured instance of a widget type, with its own name, settings, state, action queue and overlay URL.
- **Action**: something a widget can do (`show-alert`, `spin`), with a parameter schema. Pipelines call actions.
- **Event**: something that happened. Platform events are normalized (`chat.message`, `sub`, `raid`…). Widgets also emit events (`wheel.landed`).
- **Pipeline**: a graph of nodes without loops, starting from trigger nodes. It has an overlapping-run setting: parallel, queue, drop or restart.
- **Node**: one step of a pipeline, a **trigger**, **logic** or **action** node, with settings and input/output ports.
- **Run**: one execution of a pipeline, with the trigger payload and every node's input, output, timing and errors.
- **Expression**: `{{ trigger.user.displayName }}`. A safe template language, never `eval`.
- **Plugin**: a package with an `overly.plugin.json` manifest that adds node types and/or widget types, optionally with backend code and declared permissions.

## Commands

Run everything from the repository root.

| Command | What it does |
|---|---|
| `bun install` | Install dependencies (`--frozen-lockfile` in CI) |
| `bun run lint` | ESLint (type-aware) and Prettier check |
| `bun run format` | Format with Prettier |
| `bun run typecheck` | `tsc -b` across all project references |
| `bun run test` | Vitest, all workspaces, under Node |
| `bun run check:desktop` | `cargo check` for the Tauri shell (needs Rust) |

Use **`bun run test`, never `bun test`**: `bun test` starts Bun's own test runner, which is not what CI runs. Run a single workspace's tests with `bun run test --project @overly/shared`.

## Conventions

- **TypeScript everywhere** except the shell. Strict settings live in `tsconfig.base.json`; don't loosen them. No `any`, no non-null `!` assertions without a comment saying why.
- **ESM only.** Relative imports use the `.js` extension (`./twitch.js`). Use `import type` for types.
- **Runtime:** server code targets **Node.js LTS**. Don't use Bun-only APIs (`Bun.*`, `bun:*`) outside build scripts (ADR 0010).
- **Validation:** data crossing a boundary (HTTP, WebSocket, files, plugin manifests, IPC) is parsed with Zod schemas from `@overly/shared`.
- **Tests** sit next to the code as `*.test.ts`. New behavior comes with tests. Bug fixes come with a test that failed before the fix.
- **Dependencies:** add them to the workspace that uses them, not to the root (the root only holds shared tooling). Licenses must be MIT-compatible (ADR 0009). Pin exact versions.
- **Formatting:** Prettier for code, JSON and YAML; Markdown is not auto-formatted. Rust uses `cargo fmt`.
- **Decisions:** a change that contradicts an ADR needs a new ADR that supersedes it (see `docs/adr/README.md`).
- **Security:** keep the localhost model (ADR 0007): bind to 127.0.0.1, check Host and Origin. Don't weaken it to make something work.
- **Commits:** small and focused, imperative subject line. Use a branch and a pull request, never push to `master`.

## Never commit secrets

Never commit tokens, passwords, API keys, client secrets, `.env` files, private keys or user data, even in tests or fixtures (use obviously fake values). Twitch tokens belong in the OS keychain. The Twitch **Client ID** is public and is the one exception. If a secret is committed by mistake, tell a maintainer right away: it must be revoked, not just deleted.

## Definition of done

A change is done when:

1. `bun run lint`, `bun run typecheck` and `bun run test` pass locally (and `cargo fmt --check`, `cargo clippy` and `cargo test` if `apps/desktop` changed).
2. New behavior has tests, and the tests would fail without the change.
3. Docs are updated: this file for new conventions or commands, an ADR for architecture decisions, ROADMAP checkboxes for roadmap items.
4. CI passes on Linux and Windows.
5. The PR describes how the change was verified, ideally on a real or mock stream for user-facing features.
6. A human has reviewed it.
