# Phase 1: walking skeleton (tray → sidecar → dashboard)

- **Date:** 2026-10-14
- **Roadmap:** [Phase 1](../../../ROADMAP.md#phase-1--walking-skeleton-tray--sidecar--dashboard)
- **Status:** approved design, waiting for spec review

## Goal and success criteria

The desktop app starts, shows a tray icon, starts the Node server, and opens an empty dashboard in the default browser. Quit stops everything cleanly. The localhost security model of ADR 0007 is in place before any feature that changes state.

Phase 1 is done when:

1. On Windows, `bun run dev:desktop` shows the tray. *Dashboard* opens the browser on a working dashboard. *Quit* leaves no orphan `node` process. A request from another origin is rejected. (Roadmap exit criteria.)
2. The definition of done in `AGENTS.md` holds: lint, typecheck and tests pass, `cargo fmt --check`, `cargo clippy` and `cargo test` pass, CI passes on Linux and Windows, and docs are updated.

Verification is done on macOS during development. The Windows exit criteria need a manual check on a Windows machine; CI covers compilation, clippy and tests on Windows.

## Decisions made during design

| Topic | Decision |
|---|---|
| Dashboard UI | **Mantine 9** (MIT): built-in light/dark theming, accessible modals, menus and inputs for Phase 2. Recorded in ADR 0011. |
| Router | **React Router 8**, declarative routes. |
| Default port | **6859** ("OVLY" on a phone keypad). Avoids OBS WebSocket (4455), DroidCam (4747) and Streamer.bot (7474, 8080). Configurable in `settings.json`. Recorded in ADR 0012. |
| Dev loop | **Vite dev server with a proxy** to Fastify. The server accepts one extra origin only when started with `--dev-origin`. |
| Sessions | **Signed, stateless cookies**, so sessions survive sidecar restarts and dev reloads. Recorded in ADR 0012. |
| Server bundle | `bun build --target=node` (Bun APIs are allowed in build scripts, ADR 0010). |
| Packaging | Phase 1 resolves a bundled `node` and `server.mjs` when they exist, and falls back to the repository in debug builds. Bundler configuration (`externalBin`, resources) waits for Phase 10. |
| Delivery | One branch, `phase-1-walking-skeleton`, with small focused commits and one pull request. |

## Architecture

```
Tauri shell (Rust)  ── spawn, stdio NDJSON JSON-RPC ──►  Node sidecar (server.mjs)
  tray: status / Dashboard / Quit                          Fastify on 127.0.0.1:6859
  supervisor: ready wait, backoff, kill                    /api/health, /api/session
  single instance, opener                                  /?t=<token> exchange, /ws
                                                           static dashboard (SPA)
                                                                 ▲
                                          browser ── HTTP + WS ──┘
                                          (React + Mantine dashboard)
```

## 1. Server (`apps/server`)

### Entry point and options

`src/main.ts` parses its arguments with `node:util` `parseArgs`:

| Option | Meaning |
|---|---|
| `--rpc` | Started by the shell: stdout is reserved for JSON-RPC, stdin EOF triggers shutdown. |
| `--data-dir <path>` | Overrides the data directory (also `OVERLY_DATA_DIR`). |
| `--port <n>` | Overrides the port for this run, without saving it. `0` picks a free port (tests). |
| `--dev-origin <origin>` | Extra allowed origin, used only by `bun run dev`. |
| `--dashboard-dir <path>` | Overrides where the dashboard build is served from. Defaults to `dashboard/` next to the bundle. |
| `--pretty-logs` | Also writes human-readable logs to stderr (dev). |

Without `--rpc` (standalone dev), the server prints the dashboard URL, with a one-time token, to stderr after it starts.

### Data directory

| OS | Default |
|---|---|
| Windows | `%APPDATA%\Overly` |
| macOS | `~/Library/Application Support/Overly` |
| Linux | `$XDG_DATA_HOME/overly`, or `~/.local/share/overly` |

`bun run dev` uses `.dev-data/` at the repository root (git-ignored) and port 6860, so development never touches real data and can run next to an installed Overly.

### Settings and JSON documents

- `settings.json`: `{ "schemaVersion": 1, "server": { "port": 6859 } }`. The Zod schema lives in `@overly/shared`.
- `JsonDocument<T>` (reused for widgets in Phase 2):
  - load: read, parse, run migrations up to the current `schemaVersion`, validate with Zod
  - missing file: use defaults and write them
  - corrupt file (invalid JSON or schema): rename it to `settings.json.corrupt-<timestamp>`, use defaults, log a warning
  - file with a newer `schemaVersion` than this build knows: fatal error `config_unsupported`, the file is left untouched
  - writes are serialized, a newer pending write replaces an older one, and `flush()` resolves when everything is on disk
- Atomic write: write to a temp file in the same directory, fsync, rename over the target. On Windows, retry the rename a few times on `EPERM`/`EBUSY` (antivirus and indexers hold files briefly).

### Logging

- pino, through a pino-roll stream (not a worker transport, so it bundles): `<data>/logs/overly.log`, 10 MB per file, 5 files kept.
- `--pretty-logs` adds a pino-pretty stream on stderr. pino-pretty is loaded with a dynamic import and kept out of the bundle.
- Redaction: `cookie` and `set-cookie` headers, and the `t` query parameter in logged URLs.
- Nothing writes to stdout. ESLint `no-console` is an error in `apps/server/src` (tests excepted).

### HTTP and WebSocket

- `GET /api/health` → `{ status: "ok", version }`. No session needed.
- `GET /api/session` → `{ authenticated: true }`, or `401`.
- `GET /?t=<token>`: the session exchange (see Security).
- `/ws`: sends `{ type: "hello", version }` on connect, pings every 30 s, closes idle peers that miss a pong, closes all sockets with code 1001 on shutdown. Message schemas live in `@overly/shared`. Phase 1 ignores client messages.
- Static dashboard: `@fastify/static` serves the dashboard folder. Unknown `GET` paths outside `/api/`, `/ws`, `/o/` and `/assets/` fall back to `index.html` for client routes. If the folder is missing, `/` answers with a short text explaining that the dashboard isn't built.

### Shutdown

- Triggers: the `shutdown` RPC request, SIGINT/SIGTERM, and stdin EOF in `--rpc` mode (the shell died).
- Order: stop accepting connections and close WebSockets, run registered shutdown hooks (pipeline runs register here later), flush JSON documents, flush the logger.
- Idempotent. A 5 s deadline covers the whole sequence; past it the process exits with code 1. A clean shutdown exits with code 0.

### Startup errors

| Cause | `fatal` code | Message (example) |
|---|---|---|
| `EADDRINUSE` | `port_in_use` | Port 6859 is already in use by another program. Close it, or change `server.port` in `<path>/settings.json`. |
| `EACCES` | `port_unavailable` | Windows can reserve port ranges (Hyper-V, WSL); same hint. |
| newer settings file | `config_unsupported` | settings.json was written by a newer version of Overly. |
| anything else | `startup_failed` | the error message |

In `--rpc` mode the error is sent as a `fatal` notification; in every mode it is logged and the process exits with code 1.

### Build

`bun run build` builds the dashboard, then `bun build src/main.ts --target=node --format=esm` writes `apps/server/dist/sidecar/server.mjs` and copies `apps/dashboard/dist/web` to `apps/server/dist/sidecar/dashboard`. Optional native modules of `ws` (`bufferutil`, `utf-8-validate`) and `pino-pretty` stay external.

## 2. Localhost security

- **Bind:** `127.0.0.1` only. Generated URLs use `127.0.0.1`, never `localhost`.
- **Host allowlist:** a global `onRequest` hook, first in the chain, also applied to WebSocket upgrades. Allowed: `127.0.0.1:<port>` and `localhost:<port>`. Anything else, or no Host header → `403 {"error":"forbidden_host"}`.
- **Origin check:** on every method except GET, HEAD and OPTIONS, and on the `/ws` upgrade. The Origin header must be present and be `http://127.0.0.1:<port>`, `http://localhost:<port>`, or the `--dev-origin` value. Otherwise → `403 {"error":"forbidden_origin"}`. Phase 5's webhook and trigger URLs will be explicit exceptions with their own keys.
- **One-time tokens:** `getDashboardUrl` issues 32 random bytes (base64url), kept in memory, single use, valid for 2 minutes. The URL is `http://127.0.0.1:<port>/?t=<token>`.
- **Exchange:** `GET /?t=<token>`: a valid token is consumed, the session cookie is set, and the response is `303` to `/`, which removes the token from the address bar and history. The response has `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. An invalid or expired token also gets `303` to `/`, without a cookie.
- **Session cookie:** `overly_session`, `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` (30 days). The value (`<random id>.<issued-at>`) is signed with HMAC through `@fastify/cookie`. The key is 32 random bytes in `<data>/session.key`, created on first run with mode `0600`. Signed stateless sessions survive sidecar restarts. Deleting `session.key` signs every browser out.
- **Session required:** every `/api/*` route except `/api/health` (→ `401 {"error":"no_session"}`), and the `/ws` upgrade. Overlays get their own per-widget authorization in Phase 2, because OBS doesn't share the browser's cookies.
- **Headers:** `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` everywhere; `X-Frame-Options: DENY` on dashboard pages. A Content-Security-Policy is deferred to Phase 2.

## 3. Sidecar protocol and desktop shell

### Protocol (`docs/sidecar-protocol.md`, Zod schemas in `@overly/shared`)

JSON-RPC 2.0, one JSON message per line, UTF-8, on the sidecar's stdin (shell → server) and stdout (server → shell). Stderr carries plain log lines that the shell writes to its own log.

| Direction | Kind | Method | Params / result |
|---|---|---|---|
| server → shell | notification | `ready` | `{ port, version }` |
| server → shell | notification | `fatal` | `{ code, message }`, then exit |
| shell → server | request | `getDashboardUrl` | → `{ url }` |
| shell → server | request | `shutdown` | → `{}`, then shutdown and exit |

Both sides implement a two-way peer (requests with ids, responses, notifications, per-request timeouts), so Phase 3 can add server → shell requests (`secrets.get/set/delete`) without changing the framing. Unknown methods get the JSON-RPC `-32601` error; malformed lines are logged and skipped.

### Shell (`apps/desktop/src-tauri`)

- **No windows.** macOS uses the accessory activation policy (no Dock icon). Windows release builds have no console, and the sidecar is spawned with `CREATE_NO_WINDOW`.
- **Single instance:** `tauri-plugin-single-instance`, registered first. A second launch behaves like a *Dashboard* click.
- **Tray:** a disabled status item, then **Dashboard** and **Quit**. The status text is also the tooltip: "Starting…", "Running on port 6859", "Restarting (attempt 3)…", "Error: <fatal message>". The status item exists because Linux AppIndicator has no tooltips.
- **Supervisor**, a state machine `Starting → Running → Backoff → Starting…`, plus `Fatal` and `Stopping`:
  - spawns the sidecar with piped stdio and waits up to 20 s for `ready`; a timeout kills the process and counts as a crash
  - after a crash, restarts with backoff: 0.5 s, 1 s, 2 s, doubling up to 30 s; the attempt counter resets after 60 s of `Running`
  - never restarts after a `fatal` notification
  - publishes its status on a watch channel that the tray follows
- **Locating the sidecar:**
  - node: `OVERLY_NODE`, then `node`/`node.exe` next to the shell executable (where Tauri puts `externalBin` sidecars), then `node` on PATH in debug builds only
  - script: `OVERLY_SERVER_SCRIPT`, then `<resource dir>/server/server.mjs`, then `apps/server/dist/sidecar/server.mjs` from the repository in debug builds only
  - a missing node or script is a `Fatal` status with a clear message
- **No orphans:** stdin EOF shuts the server down on every OS; on Windows the sidecar is also assigned to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so it dies even if the shell is killed; tokio `kill_on_drop` as a last resort.
- **Dashboard:** in `Running`, call `getDashboardUrl` and open the URL with `tauri-plugin-opener`. In `Starting` or `Backoff`, wait for `Running` (up to 20 s) first. In `Fatal`, do nothing; the status item explains why.
- **Quit:** send `shutdown`, wait up to 8 s for the process to exit (the server's own deadline is 5 s), kill it otherwise, then exit the app.
- **Logging:** `tauri-plugin-log` to the OS log directory and stdout, including the sidecar's stderr lines.
- **Crates:** `tauri` (`tray-icon`, `image-png`), `tauri-plugin-single-instance`, `tauri-plugin-opener`, `tauri-plugin-log`, `log`, `serde`, `serde_json`, `tokio` (`process`, `io-util`, `time`, `sync`, `macros`), and `windows-sys` (Job Objects) on Windows only.

## 4. Dashboard (`apps/dashboard`)

- **Stack:** Vite with `@vitejs/plugin-react`, React 19, React Router 8, TanStack Query 5, Mantine 9 (`@mantine/core`, `@mantine/hooks`, `postcss-preset-mantine`).
- **Routes:** `/` (layout with the empty state) and a not-found page.
- **Layout** (Mantine `AppShell`):
  - header: "Overly", server connection state from the WebSocket ("Connected" / "Reconnecting…"), a "Twitch: not connected" placeholder, and a light / dark / auto theme toggle
  - left pane: **Widgets** and **Pipelines** sections, each with an empty state and a `+` button, disabled with a "coming in a later version" tooltip
  - main pane: an empty state
- **Theme:** `defaultColorScheme="auto"` follows the OS; a manual choice is stored by Mantine's local-storage color-scheme manager (a per-browser preference).
- **Session gate:** a query on `/api/session`. A `401` renders only the "No active session — open the dashboard from the Overly tray icon" screen.
- **Server connection:** a hook connects to the same-origin `/ws`, validates messages with the shared Zod schemas, and reconnects with backoff from 0.5 s to 10 s. Its state drives the header indicator.
- **API client:** a thin same-origin `fetch` wrapper that throws a typed `ApiError` with the status code.
- **Build:** `vite build` writes to `apps/dashboard/dist/web` (tsc keeps its declarations in `dist/`).
- **Dev proxy:** `/api`, `/ws` (WebSocket) and `^/\?t=` go to `http://127.0.0.1:6860` with `changeOrigin` (rewrites Host, not Origin).

## 5. Tooling, CI and docs

- **Root scripts:**
  - `dev`: `bun run --filter` runs the server (`tsx watch src/main.ts --port 6860 --data-dir ../../.dev-data --dev-origin http://localhost:5173 --pretty-logs`) and Vite (`--port 5173 --strictPort`) in parallel
  - `build`: dashboard build, then server bundle
  - `dev:desktop`: `build`, then `cargo run` for the shell
- **ESLint:** `eslint-plugin-react-hooks` for the dashboard; `no-console` as an error in `apps/server/src`, except tests.
- **CI:** the `js` job adds `bun run build` and the sidecar process test against the bundle, on Linux and Windows. The `desktop` job adds `actions/setup-node` for the fake-sidecar tests.
- **Docs:**
  - `docs/sidecar-protocol.md`
  - ADR 0011: dashboard stack (Mantine, React Router, TanStack Query)
  - ADR 0012: fixed default port 6859 and signed session cookies (extends ADR 0007)
  - `AGENTS.md`: new commands; "stdout belongs to JSON-RPC in the server: use the logger"
  - `README.md`: the Phase 1 note becomes run instructions
  - `ROADMAP.md`: Phase 1 boxes; Phase 10 gets the bundling items (`externalBin` node, `server.mjs` and dashboard as resources)
  - `.gitignore`: `.dev-data/`

## Error handling summary

| Situation | Behavior |
|---|---|
| Port busy or reserved | `fatal` → tray shows the error, no restart |
| Corrupt `settings.json` | backed up, defaults used, warning logged |
| `settings.json` from a newer version | `fatal config_unsupported`, file untouched |
| Sidecar crash | restart with backoff, status shows the attempt |
| No `ready` within 20 s | kill, then restart with backoff |
| Shutdown takes too long | server exits with code 1 after 5 s; the shell kills it after 8 s |
| Dashboard loses the WebSocket | header shows "Reconnecting…", reconnects with backoff |
| No or invalid session | dashboard shows the "open from the tray" screen |
| Missing node or `server.mjs` | `Fatal` status with the path that was searched |

## Testing

- **Server unit tests:** data-dir resolution per OS, atomic write (including rename retry), `JsonDocument` (defaults, migrations, corrupt file, newer version, write coalescing, flush), token issuer (single use, expiry), shutdown ordering and deadline, JSON-RPC peer over `PassThrough` streams.
- **Server HTTP tests** (`fastify.inject()`): health without a session; wrong or missing Host; cross-origin POST and POST without Origin; token exchange, reuse and expiry; tampered cookie; `/api/session` with and without a cookie; SPA fallback.
- **Server WebSocket tests** (real socket on port 0): `hello` on connect; forged Origin and Host rejected; no session rejected; close code 1001 on shutdown.
- **Sidecar process test:** spawns the server with `--rpc --port 0` and a temp data dir: `ready`, health over HTTP, `getDashboardUrl`, token exchange, `shutdown` → exit code 0; stdin EOF → exit. It runs against the source (through tsx) by default, and against the bundle when `OVERLY_SIDECAR_ENTRY` points to it (CI).
- **Shell tests:** protocol encoding and decoding, backoff schedule, sidecar path resolution, status transitions; supervisor integration tests with a fake Node sidecar (modes: ready, crash, fatal, hang on shutdown) covering restart with backoff, no restart after `fatal`, and the kill after a hung shutdown.
- **Dashboard tests** (Vitest, jsdom, Testing Library): layout sections and empty state; no-session screen on `401`; connection indicator with a mocked WebSocket; theme toggle.

## Out of scope

Content-Security-Policy, the installer and bundler configuration (Phase 10), widgets, overlays and the overlay WebSocket channel (Phase 2), Twitch (Phase 3), the settings page (Phase 7).
