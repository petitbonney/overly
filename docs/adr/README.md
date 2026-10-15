# Architecture Decision Records

Each file records one decision: the context, what was decided, and what follows from it. ADRs are never rewritten after they are accepted. To change a decision, add a new ADR that **supersedes** the old one, and set the old one's status to `Superseded by NNNN`.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-tauri-shell-with-node-sidecar.md) | Tauri v2 desktop shell with a Node sidecar | Accepted |
| [0002](0002-dashboard-in-default-browser.md) | The dashboard opens in the default browser | Accepted |
| [0003](0003-pipelines-and-widgets.md) | Automation with pipelines; widgets are a separate concept | Accepted |
| [0004](0004-in-house-engine-and-react-flow.md) | In-house pipeline engine and React Flow editor; no n8n or Node-RED | Accepted |
| [0005](0005-plugins-with-isolated-backends.md) | Plugins add nodes and widgets, with isolated backend code | Accepted |
| [0006](0006-native-and-chat-vote-polls.md) | Polls and bets support native Twitch and chat-vote modes | Accepted |
| [0007](0007-localhost-binding.md) | The server binds to 127.0.0.1; LAN access is opt-in | Accepted |
| [0008](0008-twitch-device-code-flow.md) | Twitch sign-in with a shipped Client ID and the Device Code Flow | Accepted |
| [0009](0009-mit-license-and-ai-written-code.md) | MIT license; code written by AI agents, reviewed by humans | Accepted |
| [0010](0010-bun-tooling-node-runtime.md) | Bun for tooling, Node.js LTS as the shipped runtime | Accepted |
| [0011](0011-dashboard-stack.md) | Dashboard stack: React Router, TanStack Query and Mantine | Accepted |
| [0012](0012-local-server-port-and-sessions.md) | Fixed default port 6859 and signed dashboard sessions | Accepted |
| [0013](0013-plugin-schema-subset.md) | Plugin schemas are a JSON Schema subset, validated with Zod and rendered by Overly | Accepted |
| [0014](0014-overlay-serving-and-isolation.md) | Overlays run in an opaque-origin sandbox, served without a session | Accepted |
| [0015](0015-widget-backend-protocol.md) | Widget backends talk to the host through JSON messages; built-ins are bundled | Accepted |

New ADRs copy [template.md](template.md) and take the next number.
