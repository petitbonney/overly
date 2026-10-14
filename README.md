# Overly

> Stream widgets, overlays and automations that run on your own machine.

Overly is a free, open-source desktop app for streamers. It lives in your system tray and connects to your Twitch channel. With it you can:

- build **widgets**: chat boxes, alerts, polls, bets, spin wheels, Twitch Plays, and more. You add them to OBS (or any streaming software) as a **Browser Source**.
- wire widgets to your channel with **pipelines**: node-based automations, in the style of n8n, that you build by dragging and linking nodes. For example: *channel-point reward → spin the wheel → when it lands, post the result in chat and play a sound*.

Everything runs locally: no cloud account, no third-party server between your channel and your overlays.

> [!NOTE]
> **Status: pre-alpha / planning.** Nothing is usable yet. See [ROADMAP.md](ROADMAP.md) for the plan.

> [!IMPORTANT]
> **Overly is fully vibe-coded.** The code is written by AI coding agents. Humans set the direction, review the work, and test it on real streams. Contributions written the same way are welcome. See [Contributing](#contributing).

---

## Features (planned)

- **System tray app**: starts quietly with Windows. The tray menu has two items:
  - **Dashboard**: opens the local web dashboard in your default browser.
  - **Quit**: stops Overly and all of its overlays.
- **Widgets**: things that persist on stream, such as a chat box, an alert box or a spin wheel.
  - Each widget has its own settings, a live preview, and (when it has a visual part) a **Copy URL** button to paste into an OBS Browser Source.
  - Widgets offer **actions** that pipelines can run (`show alert`, `spin`, `start poll`) and send **events** that can start pipelines (`wheel landed`, `poll ended`).
  - Built-in library: Chat view, Alerts, Poll, Bets, Spin wheel, Countdown, Goal bar, Twitch Plays, and more over time. Polls and bets can use **native Twitch Polls/Predictions** (Affiliate/Partner channels) or a **chat-vote mode** that works on any channel.
- **Pipelines**: node-based automations drawn on a canvas.
  - **Trigger nodes**: chat messages and commands, channel-point rewards, bits, subs, gifted subs, follows, raids, stream online/offline, timers, widget events, a manual button, a local URL for Stream Deck, and incoming webhooks.
  - **Logic nodes**: filter / if, switch, delay, random, cooldown (global or per user), wait-for-all (join), variables.
  - **Action nodes**: any widget action, send a chat message, fulfill or refund a reward, start a native poll or prediction, press a key, send an HTTP request.
  - Several links out of one node make the following actions **run in parallel**.
  - Each node can use earlier data, for example `{{ trigger.user.displayName }}`.
  - **Run history**: inspect what every node received and returned, and replay a run.
  - **Templates**, so you get common setups like "sub / bits / raid → alert" in one click.
- **Plugins**: anyone can publish new **nodes** and **widgets**. Import them from a **git URL** or a **local folder**. Because plugins can run their own Node code, Overly shows a **trust prompt** at import that lists the source, the permissions requested, and whether backend code is included.
- **Save / Import / Export** widgets and pipelines as shareable `.overly` files, including the images and sounds they use.
- **Works alongside n8n, Make or Zapier** through the webhook trigger and HTTP request nodes.
- **Platforms**: Twitch first. YouTube and TikTok are planned.
- **OS**: Windows first. macOS and Linux are planned.

## Dashboard

```
┌──────────────┬────────────────────────────────────────────┬─────────────┐
│ Widgets   [+]│                                            │ Node library│
│  Alerts      │  [Sub] ──► [If tier ≥ 2] ──► [Show alert]  │ 🔍 search   │
│  Chat        │                     │                      │ ▸ Triggers  │
│  Wheel       │                     └──────► [Send chat]   │ ▸ Logic     │
│              │                                            │ ▸ Actions   │
│ Pipelines [+]│              pipeline canvas               │ ▸ Widgets   │
│  Sub thanks ●│                                            │ ▸ Plugins   │
│  !spin       ├────────────────────────────────────────────┤             │
│  Raid combo  │ Bottom pane: settings of the selected node │             │
└──────────────┴────────────────────────────────────────────┴─────────────┘
```

- **Left pane**: two lists, **Widgets** and **Pipelines**, each with a **`+`** button.
  - **`+` Widget** opens the widget library. The new widget can come with ready-made pipelines.
  - **`+` Pipeline** creates an empty pipeline, or starts one from a template.
- **Selected widget** → the main pane shows its settings, a preview, **Copy URL**, **Test** buttons for each action, and the pipelines that use it.
- **Selected pipeline** → the main pane shows the canvas.
  - The **node library** on the right is collapsible. Drag nodes from it onto the canvas, then drag between ports to link them.
  - Clicking a node opens its settings in the **bottom pane**, which can be resized.
  - The toolbar has Enable, Save, Test run (with sample event data), Runs (history), and the pipeline's overlapping-run setting.

## How it works

```
┌──────────────────────── Overly (desktop) ─────────────────────────┐
│                                                                   │
│  Tauri shell (Rust)                Node sidecar (TypeScript)      │
│  ─ tray: Dashboard / Quit          ─ HTTP + WebSocket server      │
│  ─ starts / watches sidecar ◄─IPC─►─ Twitch (EventSub, Helix API) │
│  ─ OS keychain (tokens)            ─ pipeline engine              │
│  ─ keyboard input (Twitch Plays)   ─ widget + plugin runtime      │
│  ─ installer, auto-update          ─ storage (JSON in app data)   │
└──────────────────────────────────────┬────────────────────────────┘
                                       │ http://127.0.0.1:<port>
            ┌──────────────────────────┴──────────────────────┐
            ▼                                                 ▼
   Dashboard (React SPA)                         Overlays (one URL per widget)
   in your default browser                       in OBS Browser Sources
```

- **Tauri shell**: a small native process. It owns the tray icon, single-instance lock, autostart, installer and auto-updates. It also provides two OS-level services that are better done in Rust: secure token storage in the OS keychain, and keyboard input injection. It talks to the sidecar over stdio (JSON-RPC).
- **Node sidecar**: the actual app. It runs a bundled Node.js LTS runtime with Overly's server bundle. It serves the dashboard, the overlays, a REST API and a WebSocket bus. It also connects to Twitch, runs the pipeline engine, and hosts widgets and plugins.
- **Dashboard**: a React + Vite single-page app, served by the sidecar. The pipeline canvas uses [React Flow](https://reactflow.dev).
- **Overlays**: each widget with a visual part is served at a stable URL such as `http://127.0.0.1:<port>/o/<widget-id>`. OBS loads that URL, and the page receives its settings and actions over WebSocket through `@overly/sdk`.

### Core concepts

| Concept | Meaning |
|---|---|
| **Widget type** | A reusable kind of widget, such as "Alerts" or "Spin wheel". It declares its settings schema, an optional overlay page, its **actions**, its **events**, and optional backend logic (for example, poll vote counting). |
| **Widget** | A configured copy of a widget type, such as "Main alerts" or "Giveaway wheel". It has its own name, settings, internal state, and overlay URL. Several pipelines can drive the same widget, and its queue keeps alerts from overlapping. |
| **Event** | Something that happened, normalized across platforms: `chat.message`, `reward.redeemed`, `cheer`, `sub`, `sub.gift`, `follow`, `raid`, `stream.online`… Widgets also send events, like `wheel.landed`. |
| **Pipeline** | A graph of nodes, linked from left to right, that starts at one or more **trigger** nodes. Loops are not allowed. It has an enabled flag and an **overlapping-run setting**: what happens when it fires again while still running (run in parallel, queue, drop, or restart). |
| **Node** | One step of a pipeline: a **trigger**, **logic**, or **action** node. It has settings, input and output ports (an *If* node has `true` and `false` outputs), and gives an output that later nodes can use. |
| **Run** | One execution of a pipeline. The data from its trigger flows along the links. When one node links to several next nodes, those branches run in parallel. Each run is recorded with every node's input, output, timing and errors. |
| **Expression** | `{{ trigger.user.displayName }}`, `{{ nodes.Wheel.result }}`, `{{ vars.deaths }}`. Values from earlier nodes can be used in any node setting. Expressions are a safe template language, not arbitrary JavaScript. |
| **Plugin** | A package (`overly.plugin.json`) that adds node types and/or widget types, with optional backend code and declared **permissions** (`twitch:chat:write`, `twitch:polls`, `input:keyboard`, `network`…). Built-in features are built as plugins in the same format. |

### Security model (summary)

- By default the server binds to **`127.0.0.1` only**. LAN access, for two-PC setups, is opt-in and adds a secret token to overlay URLs.
- Dashboard API calls need a session that is created when you open the dashboard from the tray. The server also checks `Host` and `Origin` headers, which blocks attacks from other websites open in your browser (CSRF and DNS rebinding). Stream Deck trigger URLs and webhooks use per-pipeline secret keys.
- Twitch tokens are kept in the OS keychain, never in plain-text config files or exports.
- Third-party plugins with backend code are **full-trust code**. Overly runs each one in its own process, so a crash cannot take the app down, and only gives it the platform APIs matching the permissions it declared. You should still only import plugins from sources you trust.

## Why not embed n8n or Node-RED?

| Option | Verdict |
|---|---|
| **n8n** | Its [Sustainable Use License](https://docs.n8n.io/sustainable-use-license/) is not OSI-approved. It can't ship inside an MIT app. n8n is also built for server workflows that are stored per run in a database, not for real-time stream events. Its editor is written in Vue. **Instead, Overly works with it:** a webhook trigger and an HTTP request node let your n8n workflows and Overly pipelines call each other. Overly also borrows n8n's UX ideas (expressions, run inspector). |
| **Node-RED** | Apache-2.0 licensed and embeddable, but its editor is jQuery-based, and community nodes' settings screens can't be reused in a React UI. It was considered and rejected; see `docs/adr/`. |
| **Own engine + React Flow** | ✅ Chosen. Small, fast, stateful, MIT-licensed, and the editor is integrated with the dashboard. |

## Tech stack

| Area | Choice |
|---|---|
| Language | TypeScript everywhere (except the Tauri shell, which is Rust) |
| Tooling | [Bun](https://bun.sh) as package manager, workspace manager and script runner. Node.js LTS stays the runtime of the shipped server. |
| Desktop shell | [Tauri v2](https://tauri.app): tray, sidecar, updater, autostart, single-instance |
| Backend | Node.js LTS, [Fastify](https://fastify.dev) with WebSocket |
| Frontend | React, Vite, TanStack Query, [React Flow](https://reactflow.dev) (`@xyflow/react`); settings forms generated from JSON Schema |
| Twitch | EventSub over WebSocket, Helix API, OAuth Device Code Flow |
| Validation | Zod schemas shared between server, dashboard and SDK |
| Storage | JSON documents in the OS app-data folder (atomic writes, versioned schemas) |
| Git import | [isomorphic-git](https://isomorphic-git.org), so users don't need git installed |
| Tests | Vitest, Playwright, Twitch CLI mock EventSub server |
| Packaging | Tauri bundler: NSIS installer for Windows; GitHub Actions CI |

## Repository layout

```
overly/
├─ apps/
│  ├─ desktop/        Tauri shell (Rust): tray, sidecar lifecycle, keychain, input
│  ├─ server/         Node sidecar (TS): HTTP/WS, platforms, pipeline engine, plugin host, storage
│  └─ dashboard/      React SPA (widget pages, pipeline canvas)
├─ packages/
│  ├─ shared/         Shared types + Zod schemas (events, plugin manifest, widgets, pipelines)
│  ├─ sdk/            @overly/sdk: overlay side, node/widget backend side
│  └─ create-plugin/  `bun create overly-plugin` scaffolder
├─ plugins/           Built-in plugins (core nodes, Twitch nodes, built-in widgets)
└─ docs/              Architecture, plugin authoring guide, ADRs
```

## Development

Prerequisites: [Bun](https://bun.sh) (package manager and scripts), Node.js LTS (the server runtime), and the Rust stable toolchain (only needed for the Tauri shell).

```bash
bun install
```

```bash
bun run lint && bun run typecheck && bun run test
```

See [AGENTS.md](AGENTS.md#commands) for every command.

> Coming in [Phase 1](ROADMAP.md#phase-1--walking-skeleton-tray--sidecar--dashboard): `bun run dev` starts the Node server and the dashboard with hot reload, without the Tauri shell, so you can work on almost everything from any OS without Rust. To run the full desktop app with the tray icon:

```bash
bun run dev:desktop
```

> Use `bun run test`, not `bun test`. The tests use Vitest, while `bun test` starts Bun's own test runner.

## Contributing

Overly is built by humans steering AI coding agents. The repository includes agent instructions ([AGENTS.md](AGENTS.md), imported by `CLAUDE.md`) so that any agent produces consistent work. See [CONTRIBUTING.md](CONTRIBUTING.md). Whether you write code by hand or with an agent:

- open an issue before starting large changes,
- keep PRs focused, with tests,
- describe how you verified the change, ideally on a real or mock stream.

## License

[MIT](LICENSE)
