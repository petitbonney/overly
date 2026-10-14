# Overly Roadmap

This roadmap is split into phases. Each phase ends with something you can run and demonstrate, and has **exit criteria** that must all pass before the next phase starts. Phases are done in order, unless they are marked as parallelizable.

**Milestones**

| Milestone | After phase | Meaning |
|---|---|---|
| `v0.1` alpha | 6 | Usable on a real Twitch stream: core widgets driven by pipelines, from a dev build |
| `v0.5` beta | 9 | Import/export, third-party plugins (nodes and widgets), Twitch Plays |
| `v1.0` | 10 | Signed Windows installer with auto-update, documented, stable formats |
| `v1.x` | 11+ | macOS/Linux, YouTube, TikTok |

**Decisions already made** (record each one as an ADR in `docs/adr/` during Phase 0):

1. The desktop shell is **Tauri v2** with a **Node sidecar**, which bundles the Node LTS runtime and Overly's server bundle.
2. The dashboard opens in the **default browser**. Overly opens no native windows.
3. Automation uses **pipelines**: node graphs (triggers → logic → actions) with parallel branches, edited on a canvas. **Widgets** are a separate, persistent concept (settings, state, overlay URL) that pipelines drive through widget actions and listen to through widget events.
4. The pipeline engine is **built in-house**, and the editor uses **React Flow**. **n8n is not embedded**: its license is incompatible with MIT, it is built for server workflows rather than real-time events, and its editor is Vue. Overly connects to it through webhook and HTTP nodes instead. **Node-RED was considered and rejected**: its editor is jQuery-based, and its nodes' settings screens can't be reused in React.
5. Extensions are **plugins** that add node types and/or widget types. They may include **backend code**, accepted through a trust prompt and run in an isolated process with permission-scoped APIs. Built-in features use the same plugin format.
6. Polls and bets support both **native Twitch** and **chat-vote** modes, chosen per widget.
7. The server binds to **127.0.0.1**. LAN access is opt-in and uses tokens in URLs.
8. Twitch sign-in uses a **project Client ID shipped with the app and the Device Code Flow** (public client, no secret). Users can override the Client ID in settings.
9. The license is **MIT**. The code is vibe-coded: written by AI agents and reviewed by humans.
10. **Bun** is the package manager, workspace manager and script runner (`bun.lock` is committed). **Node.js LTS** stays the runtime of the shipped sidecar, and server tests run under Node through Vitest, so behavior matches production.

---

## Phase 0 — Foundations

**Goal:** a repository that any contributor (human or agent) can clone, build, lint and test, with conventions written down.

- [ ] Monorepo with **Bun workspaces**: `apps/{desktop,server,dashboard}`, `packages/{shared,sdk,create-plugin}`, `plugins/`. Pin the Bun version (`packageManager` field) and commit `bun.lock`.
- [ ] TypeScript project references, a strict `tsconfig` base, ESLint and Prettier
- [ ] Vitest workspace config. A placeholder test in each package.
- [ ] `AGENTS.md` and `CLAUDE.md`: architecture summary, glossary (widget, pipeline, node, run, plugin), conventions, commands, the definition of done, and "never commit secrets"
- [ ] `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and PR templates
- [ ] `docs/adr/` containing the 10 decisions above
- [ ] GitHub Actions (`oven-sh/setup-bun` and `actions/setup-node`): lint, typecheck and test on `ubuntu-latest` and `windows-latest`. `cargo check` for the shell.
- [ ] Renovate or Dependabot configuration
- [ ] Register the Overly Twitch application (public client type, Device Code Flow enabled) and record its Client ID in the config

**Exit criteria:** `bun install --frozen-lockfile && bun run lint && bun run typecheck && bun run test` passes in CI on Windows and Linux.

---

## Phase 1 — Walking skeleton (tray → sidecar → dashboard)

**Goal:** the desktop app starts, shows a tray icon, starts the Node server, and opens an empty dashboard in the browser. Quit stops everything cleanly.

### Server (`apps/server`)
- [ ] Fastify app: `/api/health`, static serving of the dashboard build, and a WebSocket endpoint `/ws`
- [ ] Config loader: app-data directory per OS, `settings.json` with schema version, atomic writes
- [ ] Port: fixed default (configurable), because OBS URLs must stay stable. If the port is busy, report a clear error to the shell.
- [ ] stdio JSON-RPC channel to the shell: `ready {port}`, `shutdown`, `getDashboardUrl`
- [ ] Graceful shutdown: close WebSockets, stop pipeline runs and flush writes, within a time limit
- [ ] Structured logging (pino) to a rotating file in app data

### Localhost security
- [ ] Bind `127.0.0.1` only
- [ ] `Host` header allowlist (`127.0.0.1:<port>`, `localhost:<port>`), to block DNS rebinding
- [ ] Dashboard session: the tray opens `/?t=<one-time token>`, which the server exchanges for an HttpOnly, SameSite=Strict cookie
- [ ] `Origin` check on every state-changing request and on the WebSocket upgrade

### Desktop shell (`apps/desktop`)
- [ ] Tauri v2 app with no windows
- [ ] Tray icon with **Dashboard** and **Quit**. The tooltip shows the status (starting / running / error).
- [ ] Spawn the sidecar (bundled `node` binary plus `server.mjs`), wait for `ready`, and restart it with backoff if it crashes
- [ ] Single-instance lock: launching a second time opens the dashboard
- [ ] **Quit**: send `shutdown`, wait, kill the sidecar after a timeout, then exit

### Dashboard (`apps/dashboard`)
- [ ] Vite + React + TypeScript + router + TanStack Query
- [ ] App layout: left pane with empty **Widgets** and **Pipelines** sections (each with `+`), main pane (empty state), header (connection status placeholder)
- [ ] Light and dark theme

**Exit criteria:** on Windows, `bun run dev:desktop` shows the tray. *Dashboard* opens the browser to a working dashboard. *Quit* leaves no orphan `node` process. A request from another origin is rejected.

---

## Phase 2 — Plugin format & widgets

**Goal:** you can add, configure, preview and save widgets, copy an overlay URL that works in OBS, and test widget actions by hand. There is no Twitch connection and there are no pipelines yet.

### Plugin format (`packages/shared`, `docs/plugins/`)
- [ ] `overly.plugin.json` manifest spec (with a Zod schema and a JSON Schema export):
  - `id`, `name`, `version`, `apiVersion`, `description`, `author`, `icon`, `permissions`, optional `backend` entry
  - `widgets[]`: `type`, name, icon, `settings` (JSON Schema plus UI hints), optional `overlay` (entry HTML and recommended size), `actions` (parameter schema, output schema, sample parameters), `events` (payload schema, sample payload)
  - `nodes[]`: reserved for Phase 4 (declared now so the format doesn't need to change later)
- [ ] Versioning rules: `apiVersion` compatibility check, and settings `migrate` hooks between plugin versions
- [ ] Built-in features use the same format from day one (`plugins/`)

### Runtime (`apps/server`)
- [ ] Plugin registry: load built-in plugins, validate manifests, and report broken plugins in the dashboard without crashing
- [ ] Widget store: create, read, update, delete, duplicate and enable/disable. One JSON document per widget.
- [ ] Widget host: widget backend logic gets a context with `settings`, persistent `state`, `emitToOverlay`, `emitEvent` (for pipelines later), `log`, and permission-scoped platform APIs. Built-in plugins run in the server process. The isolated process for third-party plugins comes in Phase 8, but the message-based API is designed for it now.
- [ ] Per-widget **action queue** (for actions that take time, such as alerts) with priority and a maximum length
- [ ] Overlay serving: `/o/<widgetId>` serves the overlay with the SDK injected. Plugin static files are served under a per-plugin path.
- [ ] WebSocket bus: overlays subscribe to their widget and receive `settings` (on load and when saved), `action` and custom messages
- [ ] Asset library: upload images, sounds, fonts and videos to app data, served at `/assets/<id>`, and selectable from settings fields

### SDK (`packages/sdk`)
- [ ] Overlay side: `overly.onSettings()`, `overly.onAction(name, fn)`, `overly.on(msg, fn)`, `overly.actionDone(result)`, reconnect with backoff, `isPreview`
- [ ] Backend side: typed widget context (as described in Runtime above)
- [ ] Published types so plugin authors get autocompletion

### Dashboard
- [ ] **Widgets** list: search, enabled toggle, type icon, broken badge
- [ ] `+` opens the **widget library modal** (grid of widget types with search and description) and creates a widget
- [ ] Widget page: name, a settings form generated from the schema, and **Save** with a dirty indicator and a "discard changes" option
- [ ] **Preview**: an iframe of the overlay with `?preview=1` (muted by default, scaled to fit), for widget types that have an overlay
- [ ] **Copy URL** button with the recommended Browser Source size, shown only when the widget has an overlay
- [ ] **Test** buttons that run each action with its sample parameters
- [ ] Delete and duplicate widgets

### First built-in widgets (to validate the format)
- [ ] **Text banner**: actions `show(text)` and `hide`
- [ ] **Alerts (basic)**: image, sound and text template, queued. Action: `show-alert(title, message, variant)`.

**Exit criteria:** create an Alerts widget, configure an image and a sound, save, copy the URL into OBS, press *Test*, and see and hear the alert in OBS and in the preview. Three quick *Test* presses play one after another, not on top of each other. Restarting the app keeps everything.

---

## Phase 3 — Twitch connection

**Goal:** connect a Twitch account and see live, normalized events in the dashboard.

- [ ] **Device Code Flow** sign-in in the dashboard: show the code and a link to `twitch.tv/activate`, poll for the token, then show the connected account
- [ ] Token storage in the **OS keychain** through the shell (`secrets.get/set/delete` over IPC)
- [ ] Token refresh, including rotating single-use refresh tokens for public clients. Show a re-authentication prompt when needed.
- [ ] Requested scopes, documented with the reason for each: `user:read:chat`, `user:write:chat`, `channel:read:redemptions`, `channel:manage:redemptions`, `bits:read`, `channel:read:subscriptions`, `moderator:read:followers`, `channel:manage:polls`, `channel:manage:predictions`, `moderator:read:chatters`
- [ ] **EventSub over WebSocket**: connection manager (welcome, keepalive, reconnect message, session migration), subscriptions created from the scopes granted, and subscription cost limits handled
- [ ] Helix client with rate-limit handling, with [twurple](https://twurple.js.org) as the candidate library
- [ ] **Normalized event model** in `packages/shared`. Every event has `platform`, `type` (`chat.message`, `reward.redeemed`, `cheer`, `sub`, `sub.gift`, `follow`, `raid`, `stream.online`, `stream.offline`), a normalized `user` with roles (broadcaster, mod, vip, sub), and a `raw` payload. Each type has a **sample payload**, used by test runs later.
- [ ] Chat message parsing: emotes (Twitch, with optional BTTV/FFZ/7TV later), badges, mentions, commands (`!cmd args`)
- [ ] Internal **event bus** that later feeds pipeline triggers and widget backends (a chat widget subscribes directly, with no pipeline needed)
- [ ] Dashboard **Event log** view: live stream of events with filters. Click an event to "replay" it.
- [ ] Optional **bot account** (a second sign-in) used to send chat messages
- [ ] Dev tooling: `bun run` scripts to run the **Twitch CLI mock EventSub WebSocket server** and fire test events, plus a "fake event" panel in the dashboard (dev builds only)

**Exit criteria:** after signing in, real chat messages, a test redemption and mock sub/cheer/raid events appear in the event log within about 1 s. Killing the network and restoring it reconnects automatically. Restarting the app keeps you signed in.

---

## Phase 4 — Pipeline engine & editor (core)

**Goal:** you can build a pipeline on a canvas that turns Twitch events into widget actions, with parallel branches.

### Model (`packages/shared`)
- [ ] Pipeline document: `{ id, name, enabled, overlap: parallel|queue|drop|restart, maxQueue, nodes[], edges[], viewport }`
- [ ] Node: `{ id, type (plugin:node), name, settings, position, disabled }`. Edge: `{ from: node.port, to: node.port }`.
- [ ] Node type definition in plugin manifests (`nodes[]`): category (`trigger` / `logic` / `action`), icon, input and output ports, settings schema, output schema (used for expression autocomplete), required permissions
- [ ] Validation: no loops, required settings filled, ports compatible, referenced widgets exist. Invalid pipelines can be saved but not enabled.

### Engine (`apps/server`)
- [ ] Trigger registry: trigger nodes subscribe to the event bus, timers, or manual/HTTP sources. Each match starts a **run**.
- [ ] Executor: follows the graph from the trigger. A node runs when its input arrives. One output linked to several nodes → those branches run **in parallel**. Each node gets `{ trigger, nodes, vars }` context and returns an output on one or more ports.
- [ ] **Expressions**: `{{ path }}` templates with a small, safe set of helpers (`upper`, `default`, `random`, `pluralize`, number formatting). No `eval`.
- [ ] Overlapping runs, per the pipeline setting: parallel, queue (with max), drop, or restart
- [ ] Per-node timeout, cancellation (restart mode, shutdown), and error handling: a failed node marks the run as failed and logs it
- [ ] Node execution API matches the widget host API, so third-party nodes can later run out of process without changes

### Core nodes (built-in plugins)
- [ ] **Triggers**: Twitch event (with typed filters per event: bits amount, sub tier, raid viewers…), chat command / message match (command, contains, regex, role filter), channel-point reward (pick from the channel's rewards), **timer** (every N min, only-while-live option, minimum chat activity, random offset), **manual** (dashboard button)
- [ ] **Logic**: filter / if (`true`/`false` ports), switch (N ports), delay
- [ ] **Actions**: one node per **widget action** (generated from widget manifests, with a widget picker), send chat message, fulfill / refund redemption (Overly-owned rewards only)

### Editor (`apps/dashboard`)
- [ ] `+` Pipeline creates an empty pipeline and opens the canvas
- [ ] Canvas with **React Flow**: pan, zoom, select, multi-select, delete, snap to grid
- [ ] **Node library** right pane: search, categories (Triggers, Logic, Actions, Widgets, Plugins), drag a node onto the canvas
- [ ] Drag from an output port to an input port to link. Invalid links are refused with a hint.
- [ ] **Bottom pane**: the selected node's settings form, generated from the schema, with an **expression editor** (autocomplete from the trigger and earlier nodes' output schemas)
- [ ] Toolbar: name, enable toggle (blocked if invalid), Save with dirty indicator, overlapping-run setting
- [ ] **Test run**: run the pipeline with the trigger's sample payload, or with an event picked from the event log. Each node shows a live status (running / done / failed) on the canvas.
- [ ] Pipelines list: enabled dot, error badge, search

**Exit criteria:** build `Sub → If tier ≥ 2 → (Show alert ∥ Send chat "Thanks {{ trigger.user.displayName }}!")` with no code. A mock tier-2 sub runs both branches in parallel, and a tier-1 sub runs neither. `!hello` → Text banner works. A 2-minute timer pipeline only fires while the mock stream is online. Queue mode on an alert pipeline plays 5 rapid mock subs in order.

---

## Phase 5 — Pipelines (advanced)

**Goal:** pipelines are pleasant to debug, to reuse, and to connect to the outside world.

- [ ] **Run history** per pipeline: the last N runs (persisted, size-limited), each with the trigger payload, every node's input and output, duration and error. Opening a run highlights its path on the canvas. **Replay** a run with the same trigger data.
- [ ] More logic nodes: **cooldown** (global and per user, with an optional "on cooldown" output port), **wait for all** (join parallel branches), random (pick an output or a value), counter, **variables** (get/set/increment; global and persistent, with a variables page in the dashboard)
- [ ] **Error output port** on action nodes (optional), to handle failures in the graph
- [ ] **Widget event triggers**: `wheel.landed`, `poll.ended`, `alert.finished`… generated from widget manifests
- [ ] **Stream Deck / external triggers**: a "trigger URL" node that gives a secret local URL (`POST /hooks/<pipeline>/<key>`)
- [ ] **n8n / Make / Zapier interop**: a **webhook trigger** node (JSON body becomes the trigger payload) and an **HTTP request** action node (method, headers, body with expressions; `network` permission)
- [ ] **Templates**: built-in pipeline templates (sub/bits/raid alerts, `!command` reply, reward → wheel → announce result, timed chat reminder). When you add a widget, Overly suggests its templates.
- [ ] Editor comfort: undo/redo, copy/paste nodes (also between pipelines), duplicate pipeline, minimap, auto-layout, sticky notes, disable node, "pin" a node's sample output for testing
- [ ] Widget page lists the **pipelines that use the widget**. Deleting a widget warns about the pipelines it would break.

**Exit criteria:** a pipeline `Reward → Spin wheel` plus a second pipeline `wheel.landed → Send chat + Show alert` work end to end. A failed HTTP request goes to the error port and is visible in run history. An n8n workflow can trigger an Overly pipeline by webhook, and an Overly pipeline can call an n8n webhook. Undo/redo works for every canvas action.

---

## Phase 6 — Core widget library → **v0.1 alpha**

**Goal:** the most-used stream widgets are built in, polished, and use only the public plugin format, each with its actions, events and templates.

- [ ] **Chat view**: listens to chat directly (no pipeline needed). Themes, emotes and badges, message fade-out, hide commands and bots, max lines, deleted-message and ban handling.
- [ ] **Alerts (full)**: variants (per event type and amount ranges) chosen by the action's `variant` parameter, layouts, text-to-speech toggle (OS/browser voices), animations. Templates: follow, sub, gift, bits, raid.
- [ ] **Poll**:
  - native mode: create, end and visualize a Twitch Poll (needs Affiliate/Partner, detected and explained in the UI)
  - chat mode: `!vote <n>`, one vote per user, live bars, timer
  - actions `start`, `end`; events `poll.started`, `poll.ended(winner)`
- [ ] **Bets**:
  - native mode: Twitch Predictions (create, lock, resolve, cancel)
  - chat mode: viewers pick an outcome with `!bet <n>`, and winners are announced. No currency in v0.1 (see the backlog for loyalty points).
  - actions `open`, `lock`, `resolve(outcome)`, `cancel`; events `bet.locked`, `bet.resolved`
- [ ] **Spin wheel**: segments (weights, colors), action `spin`, event `wheel.landed(segment)`
- [ ] **Countdown / timer** (actions `start`, `add`, `pause`; event `countdown.finished`) and **Goal bar** (actions `set`, `add`; event `goal.reached`)
- [ ] Shared overlay styling primitives in the SDK (fonts, safe areas, transitions)
- [ ] Screenshots and GIFs of each widget and an example pipeline for the README
- [ ] First-run onboarding: connect Twitch, add an Alerts widget, accept its suggested pipelines, then copy the URL to OBS

**Exit criteria:** a full test stream on a real channel, with chat view, alert pipelines, a chat poll, a reward → wheel → announcement chain and a native prediction, runs for 2 h without restarts, without memory growth above 20%, and with p95 time from event to overlay under 300 ms. **Tag `v0.1.0`.**

---

## Phase 7 — Save, import, export

**Goal:** configurations are portable and safe.

- [ ] **Export**: any selection of widgets and pipelines to a `.overly` file (a zip with `manifest.json`, the widget and pipeline JSON files, and the assets they reference). Exporting a pipeline offers to include the widgets it uses. Secrets, tokens and hook keys are never included.
- [ ] **Import**:
  - preview the content (plugins needed, versions, conflicts) before applying
  - missing plugins: offer to install them if the source is known; otherwise import the items as disabled and broken
  - **ID remapping**: pipelines are re-linked to the imported widgets, or the user maps them onto existing widgets
  - name conflicts: rename or replace
  - run settings migrations when versions differ
- [ ] Automatic local **backups** (rotating, daily and before each import or update) with restore from the dashboard
- [ ] A versioned file-format spec in `docs/`, with a JSON Schema
- [ ] Settings page: data folder location, open the folder, port, language placeholder

**Exit criteria:** export everything on machine A and import it on a fresh machine B. Every overlay works after copying the URLs again, and every pipeline drives the right widget. Importing only a pipeline onto machine B lets you map it onto B's existing Alerts widget. A corrupted import file is rejected with a clear message and changes nothing.

---

## Phase 8 — Third-party plugins (custom nodes & widgets)

**Goal:** anyone can build, share and install nodes and widgets.

- [ ] **Import from local folder**, in two modes:
  - *Install (copy)*: a snapshot of the folder
  - *Link (dev mode)*: watches the folder and hot-reloads the overlay, the backend and node definitions on change
- [ ] **Import from git URL** using isomorphic-git (no git needed on the user's machine): clone a tag or branch, pin the commit
- [ ] Manifest and file validation, size limits, and a check that every manifest path stays inside the plugin folder
- [ ] **Isolated plugin host**: each third-party plugin's backend (widget logic and node execution) runs in its **own child process**, using the message API from Phases 2 and 4, with crash isolation, restart with backoff, and a per-call timeout
- [ ] **Trust prompt** before enabling, showing: the source (URL and commit, or path), author, the nodes and widgets it adds, the permissions requested in plain language, a prominent **"includes backend code"** warning, and the file list. The user must explicitly confirm.
- [ ] Stored trust record per plugin (source, commit, permissions hash). A **new trust prompt is required if permissions or the backend change** on update.
- [ ] **Permission enforcement**: the platform APIs a plugin gets (chat write, polls, rewards, input, network) are limited to the permissions it declared. Investigate the Node permission model (`--permission`) for file system and child-process restrictions in plugin processes.
- [ ] **Updates**: check git remotes for new tags, show a changelog link, update with a migration
- [ ] Uninstall a plugin (affected widgets and pipelines are disabled first, with confirmation)
- [ ] Node library and widget library show a **"Plugins"** section with the source of each item
- [ ] `bun create overly-plugin` (also works with `npm create` for authors without Bun): template with a sample node, a sample widget (overlay plus backend), types, a local dev harness with mock events, and a README
- [ ] **Plugin authoring guide** in `docs/plugins/`: manifest reference, SDK reference, node ports and outputs, widget actions and events, permissions, publishing checklist
- [ ] An example community-style plugin in a separate repo, to test the git import end to end

**Exit criteria:** scaffold a plugin with one node and one widget, link it in dev mode, edit it and see a hot reload, push it to a git repo, install it by URL on another machine through the trust prompt, and use both in a pipeline. Updating it with a permission change asks for trust again. A plugin that crashes in a loop doesn't affect other pipelines.

---

## Phase 9 — Twitch Plays → **v0.5 beta**

**Goal:** chat controls a game on the streamer's PC.

- [ ] Shell capability `input.keyboard` (and later `input.mouse`): Rust input injection (e.g. `enigo`, or `SendInput` with **scancodes** so it works with DirectInput games), exposed to the sidecar over IPC and gated by the `input:keyboard` permission
- [ ] Generic **Press key** action node (key, hold duration, combos). Simple setups need nothing else: `!jump → Press Space`.
- [ ] **Twitch Plays** widget, for the stateful modes (backend plus an optional overlay that shows recent inputs and votes):
  - command map: `!up` → `W` held for 200 ms, combos, aliases
  - modes: **anarchy** (every command runs), **democracy** (vote window, then the winner runs), with a mode switch by chat vote or by the streamer
  - rate limits per user and globally, role restrictions, a blocklist
  - **target window guard**: only send inputs while the chosen game window has focus (applies to the Press key node too)
  - **emergency stop**: global hotkey (registered by the shell) and a dashboard button, which also pause every pipeline that uses input nodes
  - events `plays.input`, `plays.mode-changed`, so pipelines can react (for example, an alert when democracy wins)
- [ ] Safety documentation: risks, recommended settings, and a warning that some games' anti-cheat may react to injected input
- [ ] Beta hardening: fix bugs from alpha users, profile performance (overlay frame time, engine throughput and server CPU at high chat rates), run a soak test with simulated high chat volume across many pipelines

**Exit criteria:** an emulator game is playable from mock chat in both modes, the emergency stop works instantly, and no inputs are sent when the game loses focus. The engine sustains 50 chat messages per second across 20 enabled pipelines without falling behind. **Tag `v0.5.0`.**

---

## Phase 10 — Windows release → **v1.0**

**Goal:** a non-technical streamer can install and update Overly safely.

- [ ] Tauri bundler: **NSIS installer** (per-user install, no admin), with the WebView2 bootstrapper as Tauri requires
- [ ] **Code signing** for Windows (evaluate SignPath Foundation for OSS, or Azure Trusted Signing), to avoid SmartScreen warnings
- [ ] **Auto-update** with the Tauri updater plugin: signed update manifests on GitHub Releases, an update-available notice in the dashboard, and update on quit or on demand
- [ ] **Autostart** with Windows (setting, off by default) through the Tauri autostart plugin
- [ ] Release CI: tag → build → sign → upload → update manifest. Reproducible version numbers.
- [ ] Diagnostics: a "Copy diagnostics" button (version, logs, settings without secrets) for bug reports. No telemetry.
- [ ] **Docs site** (e.g. GitHub Pages): install, OBS setup, each built-in widget, pipeline basics and every built-in node, recipes ("sub alert", "!command", "reward → wheel"), import/export, plugins, FAQ and troubleshooting (port in use, firewall, OBS cache)
- [ ] Accessibility pass on the dashboard (keyboard navigation including the canvas, contrast, labels)
- [ ] Freeze and document stable formats: plugin manifest `apiVersion: 1`, pipeline format v1, export format v1, SDK 1.0

**Exit criteria:** on a clean Windows 10 and Windows 11 VM, the installer runs without admin or SmartScreen blocks. The app updates from the previous release automatically. The docs cover first stream setup from start to finish. **Tag `v1.0.0`.**

---

## Phase 11 — macOS & Linux (parallelizable after Phase 10)

- [ ] macOS: menu-bar tray, `.dmg`, signing and notarization, Keychain, Accessibility permission flow for input nodes
- [ ] Linux: AppImage and `.deb`, Secret Service keyring, tray support differences (AppIndicator), and X11 vs. Wayland limits for input injection, documented
- [ ] CI matrix and update manifests for all three OSes

## Phase 12 — YouTube

- [ ] OAuth (installed-app flow), and live chat via the YouTube Live Streaming API (polling or streaming, with quota-aware polling)
- [ ] Map Super Chats, Super Stickers, memberships and gifted memberships to normalized events (`cheer`-like, `sub`, `sub.gift`)
- [ ] Platform filter on trigger nodes, platform-aware "send chat message" node, multi-platform chat view (platform badges)
- [ ] Note the quota and latency limits in the docs

## Phase 13 — TikTok

- [ ] Research the current official options (TikTok LIVE APIs and developer programs) before building anything. If only unofficial connectors exist, put the platform behind an **"experimental"** flag with a clear warning about breakage and ToS risk.
- [ ] Map gifts, likes, follows, shares and comments to normalized events

---

## Backlog / ideas (not scheduled)

- **OBS WebSocket nodes**: switch scene, toggle source, start replay buffer, plus a "scene changed" trigger
- **Sub-pipelines**: a "call pipeline" node with inputs and outputs, for reuse
- **Script node**: custom JavaScript in a sandboxed process, for power users
- **Loops / for-each** over lists (e.g. each gifted sub recipient)
- **Loyalty points** ledger (earn by watch time or chat) to power wagers in chat-mode bets and point-based redemptions
- Pipeline folders and tags, search across all pipelines ("which pipelines use this widget or reward?")
- Third-party emotes (BTTV, FFZ, 7TV) in the chat view
- Plugin **registry / gallery** (curated index of git URLs), with in-app browsing
- Sound board widget, TTS for chat messages, "now playing" widget
- Localization (i18n) of the dashboard
- Virtual gamepad node for Twitch Plays (ViGEm on Windows)
- Profile switching (different sets of widgets and pipelines per game or show)
- Remote-control dashboard from a phone on the LAN (follows from the LAN opt-in)
