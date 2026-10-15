# Phase 2: plugin format & widgets

- **Date:** 2026-10-14
- **Roadmap:** [Phase 2](../../../ROADMAP.md#phase-2--plugin-format--widgets)
- **Status:** approved design, waiting for spec review

## Goal and success criteria

You can add, configure, preview and save widgets, copy an overlay URL that works in OBS, and test widget actions by hand. There is no Twitch connection and there are no pipelines yet. The plugin format, the widget host and the SDK are designed so that third-party plugins (Phase 8) and pipelines (Phase 4) fit without format changes.

Phase 2 is done when:

1. Create an Alerts widget, configure an image and a sound, save, copy the URL into OBS, press *Test*, and see and hear the alert in OBS and in the preview. Three quick *Test* presses play one after another, not on top of each other. Restarting the app keeps everything. (Roadmap exit criteria.)
2. The definition of done in `AGENTS.md` holds: lint, typecheck and tests pass, CI passes on Linux and Windows, and docs are updated.

Verification is done on macOS during development, with a browser tab on the overlay URL standing in for OBS. The OBS check needs a manual run on a machine with OBS.

## Decisions made during design

| Topic | Decision |
|---|---|
| Settings and parameter schemas | A **subset of JSON Schema** with `x-overly` UI hints. A converter in `@overly/shared` turns it into Zod for validation on the server and in the dashboard; the dashboard renders it with its own Mantine renderer. No Ajv, no form library, no `eval`. Recorded in ADR 0013. |
| Overlay isolation | Every overlay response carries `Content-Security-Policy: sandbox allow-scripts`, so overlay code runs in an **opaque origin** everywhere (OBS, preview, a browser tab) and can never use the dashboard session. The preview iframe is also sandboxed. The overlay WebSocket accepts `Origin: null`; public plugin files, the SDK and assets are served with `Access-Control-Allow-Origin: *`. Recorded in ADR 0014. |
| Live preview | The settings form sends **draft settings** to the preview iframe with `postMessage`; the SDK applies them in preview mode only. OBS changes on Save. |
| Widget backends | Backends talk to the host through a **JSON message protocol**. Built-in backends are imported into the sidecar bundle and run in-process behind a channel that JSON-clones every message. Phase 8 swaps the channel for a child process. Recorded in ADR 0015. |
| Overlay code of built-in plugins | Plain JavaScript modules with `// @ts-check` against the SDK's types, and **no build step**: the same format a third-party plugin ships. |
| Overlay action completion | An action is done when its `onAction` handler returns or resolves, and failed when it throws. This replaces the roadmap's `overly.actionDone(result)`, which is ambiguous when actions overlap. |
| No overlay connected | An overlay action finishes at once with a `no_overlay` warning. The queue never waits for OBS. |
| IDs | Widget and asset IDs are 12 random characters from `[a-z0-9]` (about 62 bits): short enough for OBS URLs, safe on case-insensitive file systems. |
| Asset upload | Raw request body (`POST /api/assets?name=<file>`), no multipart dependency. Types are allowed by file extension. 100 MB per file. Identical files (sha256) are stored once. |
| New dependencies | Dashboard: `@mantine/form` and `@mantine/notifications` 9.7.2. Server: `semver` 7.8.5 (ISC) and `@types/semver` 7.8.0. |
| Delivery | One branch, `phase-2-plugins-widgets`, with small focused commits and one pull request. |

## Architecture

```
plugins/<name>/                         apps/server (sidecar)
  overly.plugin.json  ───── load ────►   PluginRegistry ──► widget types, compiled Zod schemas
  src/backend.ts ──── static import ──►  builtin backends ──► BackendHost ◄─ JSON messages ─► SDK backend runtime
  overlay/*.html|js|css                  WidgetStore (<data>/widgets/<id>.json)
  icons/*.svg                            WidgetService ── ActionQueue (per widget) ──► backend handler or OverlayHub
                                         OverlayHub ◄── /o/<id>/ws ── overlay page (SDK) in OBS / preview iframe
                                         AssetStore (<data>/assets/) ── /assets/<id>
                                         EventBus (widget events; Phase 3 adds platform events)
                                               ▲ /api/* + /ws
                                         dashboard: widget list, library modal, widget page, asset picker
```

## 1. Plugin format (`packages/shared`, `docs/plugins/`)

### Manifest: `overly.plugin.json`

```json
{
  "$schema": "../../docs/plugins/overly.plugin.schema.json",
  "id": "overly.alerts",
  "name": "Alerts",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Image, sound and text alerts, played one after another.",
  "author": "Overly",
  "icon": "icons/alerts.svg",
  "permissions": [],
  "backend": "src/backend.ts",
  "widgets": [
    {
      "type": "alerts",
      "name": "Alerts",
      "description": "Shows an image, plays a sound and displays a message.",
      "icon": "icons/alerts.svg",
      "settings": { "type": "object", "properties": { "…": {} } },
      "overlay": { "entry": "overlay/index.html", "width": 1920, "height": 1080 },
      "queue": { "maxLength": 100 },
      "actions": [
        {
          "name": "show-alert",
          "title": "Show alert",
          "params": { "type": "object", "properties": { "…": {} }, "required": ["title"] },
          "sample": { "title": "Ada just followed!", "message": "", "variant": "follow" },
          "queued": true,
          "timeoutMs": 90000
        }
      ],
      "events": [
        { "name": "alert.finished", "title": "Alert finished", "payload": { "…": {} }, "sample": { "…": {} } }
      ]
    }
  ],
  "nodes": []
}
```

| Field | Rule |
|---|---|
| `$schema` | Optional, ignored. Lets editors validate the file. |
| `id` | `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`, at most 64 characters. The `overly.` prefix is reserved for built-in plugins (enforced when third-party plugins arrive in Phase 8). |
| `name` | 1–64 characters. |
| `version` | Semantic version (`1.0.0`, `1.1.0-beta.1`). |
| `apiVersion` | Positive integer. This build supports `1`. |
| `description` | Optional, at most 500 characters. |
| `author` | Optional free text, at most 200 characters. |
| `icon` | Optional relative path to an `.svg`, `.png` or `.webp` file in the plugin folder. |
| `permissions` | Optional list of unique values from: `events:read`, `chat:write`, `rewards:manage`, `polls:manage`, `predictions:manage`, `input:keyboard`, `input:mouse`, `network`. Unknown values are an error. The list grows when each API arrives (Phases 3, 8, 9). |
| `backend` | Optional relative path to the backend module. |
| `widgets` | Widget type declarations (below). |
| `nodes` | Node type declarations, **validated but not used** until Phase 4 (below). |

A plugin declares at least one widget or node. Unknown keys are an error (typos like `setings` are caught), except `$schema` at the root.

**Relative paths** use `/`, have no empty, `.` or `..` segments, no leading `/`, no `\` and no `:`. The registry also checks that the resolved path stays inside the plugin folder (after resolving symlinks) and that the file exists.

**Widget type:**

| Field | Rule |
|---|---|
| `type` | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters, unique in the plugin. Referenced as `<pluginId>:<type>`, e.g. `overly.alerts:alerts`. |
| `name`, `description`, `icon` | As for the plugin. The widget icon falls back to the plugin icon. |
| `settings` | Root object schema (see the schema subset). Every leaf has a `default`. Defaults to an empty object schema. |
| `overlay` | Optional: `entry` (relative path ending in `.html`), `width` (1–7680) and `height` (1–4320), the recommended Browser Source size. |
| `queue` | Optional: `maxLength` (1–1000, default 100), the most pending queued actions. |
| `actions` | Action declarations, unique names. |
| `events` | Event declarations, unique names. |

**Action:** `name` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), `title` (1–64), optional `description`, `params` (root object schema; defaults optional), optional `output` (root object schema), `sample` (object, must validate against `params`), `queued` (default `false`), `timeoutMs` (100–600000, default 30000). Queued actions wait their turn in the widget's queue; the others run at once.

**Event:** `name` (`^[a-z0-9]+(?:[.-][a-z0-9]+)*$`, e.g. `alert.finished`), `title`, optional `description`, `payload` (root object schema), `sample` (must validate against `payload`).

**Node type (reserved for Phase 4):** `type`, `name`, optional `description` and `icon`, `category` (`trigger` | `logic` | `action`), `inputs` and `outputs` (lists of `{ name, title? }`), `settings` (root object schema), optional `output` (root object schema), `permissions`. Phase 2 validates them and ignores them.

**Every action needs a handler.** An action is handled by the plugin backend when the backend registers a handler for it, otherwise by the overlay. A widget type without an overlay must have a backend that handles all of its actions; this is checked when the backend reports what it handles (see section 3).

### Schema subset (ADR 0013)

Settings, action parameters and outputs, and event payloads all use the same subset of JSON Schema 2020-12. Anything outside the subset is a manifest error, so every valid manifest renders and validates.

| `type` | Keywords |
|---|---|
| `string` | `default`, `enum` (1–100 unique values), `minLength`, `maxLength` (at most 100000) |
| `number`, `integer` | `default`, `enum`, `minimum`, `maximum`, `multipleOf` (> 0) |
| `boolean` | `default` |
| `object` | `properties` (at most 100; keys match `^[A-Za-z][A-Za-z0-9_]{0,63}$`), `required` |
| `array` | `items` (one schema), `default`, `minItems`, `maxItems` (at most 1000) |

Every schema may have `title` (at most 100 characters), `description` (at most 500) and `x-overly` UI hints:

| Hint | Applies to | Meaning |
|---|---|---|
| `widget: "textarea"` | string | Multi-line input. |
| `widget: "color"` | string | Color picker. The value must be `#rrggbb` or `#rrggbbaa`. |
| `widget: "asset"` + `accept` | string | Asset picker. `accept` lists asset kinds (`image`, `audio`, `video`, `font`). The value is `""` (none) or an asset ID. |
| `widget: "slider"` | number, integer | Slider. Requires `minimum` and `maximum`. |
| `unit` | number, integer | Suffix shown after the input (`s`, `px`, `%`). |
| `placeholder` | string, number | Input placeholder. |
| `enumLabels` | any `enum` | Display labels, same length as `enum`. |

Nesting is limited to 5 levels. Root schemas (`settings`, `params`, `output`, `payload`) must be objects.

**Semantics of the Zod conversion** (`schemaToZod` in `@overly/shared`):

- Fields with a `default` use Zod `prefault`, so a missing value becomes the default, and the default itself is validated.
- An object field without a `default` gets one built from its children's defaults.
- Object properties outside `required` and without a `default` are optional.
- Unknown keys in values are stripped. This drops removed settings when a plugin updates.
- `widget: "color"` and `widget: "asset"` add their value format checks.

**Settings rule:** every leaf of a widget type's `settings` has a `default` (arrays included). `settingsDefaults(schema)` parses `{}`, so a new widget always has valid settings. The registry checks this, and checks every `sample` against its schema, when the plugin loads.

### Versioning rules

- **`apiVersion`:** the loader first parses a minimal header (`id`, `name`, `version`, `apiVersion`) and checks `apiVersion` against `SUPPORTED_API_VERSIONS = [1]` before the full parse, so a plugin written for another API gets one clear error ("needs a newer version of Overly (plugin API 2)") instead of a list of unknown keys. Breaking manifest or SDK changes after v1.0 bump `apiVersion`.
- **Plugin `version`:** each widget document stores the `pluginVersion` that last wrote its settings. On load:
  - same version: nothing to do.
  - **older** document (the plugin was updated): if the plugin's backend defines `migrateSettings` for that widget type, it runs with `{ from, to }`; then the settings are parsed with the current schema (new defaults filled in, removed keys dropped). If that succeeds, the document is saved with the new `pluginVersion`. Otherwise the widget is broken (`settings_invalid`) and the file is left as it was until the user saves fixed settings.
  - **newer** document (Overly or the plugin was downgraded): the widget is broken (`newer_plugin_version`), read-only, and its file is never written.
- Version comparisons use `semver`.

### JSON Schema export

`bun run generate:schemas` writes `docs/plugins/overly.plugin.schema.json` from the Zod manifest schema (`z.toJSONSchema`). A test in `@overly/shared` fails when the committed file differs from the generated one.

## 2. Server runtime (`apps/server`)

### Options and data layout

New CLI options, resolved like `--dashboard-dir`:

| Option | Default | `bun run dev` |
|---|---|---|
| `--plugins-dir <path>` | `plugins/` next to the bundle | `../../plugins` |
| `--overlay-sdk <path>` | `sdk/overlay.js` next to the bundle | `../../packages/sdk/dist/browser/overlay.js` |

```
<data>/
  settings.json, session.key, logs/      (Phase 1)
  widgets/<id>.json                      one document per widget
  assets/index.json                      asset index
  assets/<id>.<ext>                      asset files
```

### Plugin registry

- `PluginRegistry.load({ pluginsDir, builtinBackends })` reads every subfolder of `pluginsDir` that has an `overly.plugin.json`. Folders without one are ignored.
- Each plugin is either **ok** or **broken** with a list of readable errors (invalid JSON, schema issues with their paths, unsupported `apiVersion`, a missing or escaping file, an invalid sample or default, a duplicate plugin ID, a missing backend, an action without a handler). A broken plugin never stops the server.
- For ok plugins it compiles and caches the Zod schemas of every widget type: settings, each action's params and output, each event's payload, and the settings defaults.
- **Public files** of a plugin, the only files served over HTTP: everything under the directory of each overlay `entry`, plus the icon files. `publicPaths(manifest)` lives in `@overly/shared` so the build's copy script uses the same rule.
- **Built-in backends** (`apps/server/src/plugins/builtin.ts`) map plugin IDs to modules imported from the plugin workspaces (`@overly/plugin-alerts/backend`). They are bundled into `server.mjs`. A manifest with a `backend` but no registered module is broken ("backend not available"); Phase 8 adds third-party backends in child processes.

### Widget documents and store

```ts
WidgetDocumentSchema = {
  schemaVersion: 1,
  id: string,             // ^[a-z0-9]{12}$, equals the file name
  type: string,           // "<pluginId>:<type>"
  name: string,           // 1–100 characters, trimmed
  enabled: boolean,
  pluginVersion: string,  // semver
  settings: Record<string, unknown>,
  state: JsonValue,       // owned by the backend, null by default
  createdAt: string,      // ISO 8601
  updatedAt: string,
}
```

- `WidgetStore` loads `<data>/widgets/*.json` at startup and keeps the documents in memory. Each document has its own serialized, coalescing atomic writer (extracted from `JsonDocument` into a shared `SerializedWriter`).
- A file that can't be used (invalid JSON, schema mismatch, a file name that doesn't match its `id`) is kept as an **unreadable** entry: listed as broken, never rewritten or renamed, and only deletable. A document with a newer `schemaVersion` is broken (`unsupported_version`) the same way.
- Create, update, delete and duplicate are applied in memory first, then written. Delete waits for a pending write, then removes the file.

**Widget status:** `ok`, or `broken` with problems:

| Code | Meaning |
|---|---|
| `unreadable` | The file can't be parsed. |
| `unsupported_version` | Written by a newer Overly. |
| `plugin_missing` | No plugin with that ID. |
| `plugin_broken` | The plugin failed to load. |
| `type_missing` | The plugin has no such widget type. |
| `settings_invalid` | Settings fail the current schema (after migration). |
| `newer_plugin_version` | Written by a newer version of the plugin. |

A broken widget can't run actions, its overlay is inactive, and its backend isn't started. `settings_invalid` is fixed by saving valid settings from the dashboard. A backend whose `onStart` throws is logged with the plugin and widget IDs; the widget stays ok, and actions that reach the backend report their own errors.

### HTTP API

Every route needs the dashboard session. Bodies and answers are Zod schemas in `@overly/shared` (`api.ts`).

| Route | Body | Answer |
|---|---|---|
| `GET /api/plugins` | | `{ plugins: PluginInfo[] }`: `id`, `name`, `version`, `description`, `author`, `iconUrl`, `status` (`ok` or `broken`), `errors`, and `widgetTypes` (`type` reference, `name`, `description`, `iconUrl`, `settings` schema, `overlay` size or `null`, `actions` with `params`, `sample` and `queued`, `events`) |
| `GET /api/widgets` | | `{ widgets: WidgetSummary[] }`, sorted by name: `id`, `name`, `type`, `typeName`, `iconUrl`, `enabled`, `status`, `problems` |
| `POST /api/widgets` | `{ type, name? }` | `201 WidgetDetail` |
| `GET /api/widgets/:id` | | `WidgetDetail`: a summary plus `settings`, `overlayUrl` (`http://127.0.0.1:<port>/o/<id>`, or `null`), `overlay` size (or `null`) and `runtime` |
| `PATCH /api/widgets/:id` | `{ name?, enabled?, settings? }` | `WidgetDetail` |
| `DELETE /api/widgets/:id` | | `204` |
| `POST /api/widgets/:id/duplicate` | | `201 WidgetDetail` |
| `POST /api/widgets/:id/actions/:action` | `{ params?, priority? }` | `202 { actionId, status }` |
| `GET /api/assets?kind=<kind>` | | `{ assets: Asset[] }` |
| `POST /api/assets?name=<file name>` | the file | `201 Asset`, or `200 Asset` for a known file |
| `DELETE /api/assets/:id` | | `204` |

Errors keep the Phase 1 shape and may add details: `{ error, message?, issues? }`, where `issues` is a list of `{ path, message }`. New codes: `invalid_body`, `widget_not_found`, `widget_type_not_found`, `widget_broken`, `widget_disabled`, `action_not_found`, `invalid_params`, `invalid_settings`, `queue_full`, `asset_not_found`, `asset_too_large`, `unsupported_asset_type`.

### Widget service

`WidgetService` ties the store, the registry, the backend host, the overlay hub and the queues together, and is what the routes call:

- **create** `{ type, name? }`: the type must be available. Settings are the defaults, the state is `null`, `enabled` is `true`. The default name is the type's name, made unique with a number (`Alerts 2`).
- **update** `{ name?, enabled?, settings? }`: settings replace the whole object and are validated with the type's schema (`invalid_settings` with issues). Saving valid settings clears `settings_invalid`. Overlays receive the new settings, the backend gets `settings`.
- **enable / disable**: disabling cancels pending queued actions, stops the backend and makes overlays inactive; enabling does the reverse.
- **duplicate**: new ID, name `<name> (copy)`, same type, settings, `enabled` and `pluginVersion`, state `null`.
- **delete**: cancels the queue, stops the backend, closes overlay sockets with code 4404, removes the file.
- Every change broadcasts `widgets.changed` on the dashboard WebSocket.

### Actions and the queue

`POST /api/widgets/:id/actions/:action` with `{ params, priority? }`:

1. The widget must exist (`widget_not_found`), be ok (`widget_broken`) and enabled (`widget_disabled`); the action must be declared (`action_not_found`).
2. `params` are parsed with the action's schema (`invalid_params` with issues). Parsing fills defaults.
3. A **queued** action goes into the widget's `ActionQueue`; others run at once. The response is `202 { actionId, status }`, where `actionId` is a random ID.
4. When it runs, the action goes to the plugin backend if the backend handles it, otherwise to the overlay through the `OverlayHub`.
5. The whole run is limited by `timeoutMs`. A result that fails the action's `output` schema makes the action fail (`invalid_output`).
6. Status changes are broadcast as `widget.action` messages: `queued`, `running`, `done` (with `warnings`, such as `no_overlay`), `failed` (with `error`), `cancelled`.

**`ActionQueue`** (one per widget): pending items are ordered by `priority` (integer from -100 to 100, default 0, higher first), then by arrival. One item runs at a time; the next starts when it finishes, fails or times out. A push beyond `queue.maxLength` pending items is rejected (`429 queue_full`). `cancelAll()` resolves every pending item as `cancelled`. The queue depth is broadcast as `widget.runtime`.

### Overlay hub

`OverlayHub` keeps the overlay sockets of each widget, each marked live or preview (`?preview=1` on the socket URL).

- **On connect:** an unknown widget closes the socket with code 4404. Otherwise the hub sends `init` (widget, `active`, settings), then tells the backend `overlayConnected`.
- **`runAction(widgetId, name, params, timeoutMs)`:** sends `action` with a new delivery ID to every socket connected at that moment, live and preview alike.
  - No socket: resolves at once as `{ delivered: false }`, and the action gets the `no_overlay` warning.
  - The first `actionDone` resolves `{ delivered: true, result }`.
  - It rejects only when every target has answered `actionFailed` or disconnected and at least one failed; the first error message is kept.
  - If every target disconnects without answering, it resolves `{ delivered: false }`.
  - Past `timeoutMs` it rejects with `timeout`.
  - Late answers are ignored.
- `active` is `enabled && status === ok`. Inactive overlays receive `widget { active: false }` and the SDK hides the page.
- Connected counts (`live`, `preview`) are part of `widget.runtime`.

### Backend host and protocol (ADR 0015)

Plugin backends talk to the host only through JSON messages, validated with Zod schemas from `@overly/shared` on the receiving side. One connection per plugin serves all of its widgets; messages carry `widgetId`.

Host → backend:

| Message | Fields |
|---|---|
| `start` | `widgetId`, `widgetType`, `widget { id, name }`, `settings`, `state` |
| `settings` | `widgetId`, `settings` |
| `action` | `widgetId`, `callId`, `actionId`, `name`, `params` |
| `overlayConnected` | `widgetId`, `overlayId`, `preview` |
| `overlayActionResult` | `widgetId`, `requestId`, `ok`, `delivered`, `result` or `error` |
| `migrate` | `requestId`, `widgetType`, `settings`, `from`, `to` |
| `stop` | `widgetId` |

Backend → host:

| Message | Fields |
|---|---|
| `ready` | `widgets { [type]: { actions: string[], migrates: boolean } }`, sent once after the module loads |
| `actionResult` | `widgetId`, `callId`, `ok`, `result` or `error` |
| `setState` | `widgetId`, `state` (JSON, at most 1 MB serialized) |
| `emitToOverlay` | `widgetId`, `name`, `payload`, optional `overlayId` (one overlay) |
| `overlayAction` | `widgetId`, `requestId`, optional `callId` (set when sent while handling an action, so the host can attach the `no_overlay` warning to it), `name`, `params`, optional `timeoutMs` (defaults to the time the action has left) |
| `emitEvent` | `widgetId`, `name`, `payload` |
| `log` | optional `widgetId`, `level`, `msg`, optional `data` |
| `migrateResult` | `requestId`, `ok`, `settings` or `error` |

- **In-process channel:** `createInProcessChannel()` returns two ends; `send` JSON-serializes and parses each message and delivers it in a microtask, so built-in backends can't depend on anything a child process couldn't send. Phase 8 replaces it with child-process IPC.
- **Startup:** the host creates the connection for each ok plugin with a backend, waits up to 5 s for `ready`, and checks it against the manifest (unknown widget types or actions, and actions with no handler on a type without an overlay, make the plugin broken). Then it sends `start` for every enabled, ok widget of that plugin.
- **Checks on what the backend sends:** `emitEvent` payloads are parsed with the declared event schema (unknown or invalid events are logged and dropped); `setState` is saved to the widget document; `log` goes to the pino logger with the plugin ID and widget ID; an invalid message is logged and dropped.
- **Shutdown:** `stop` for every widget, with a 1 s grace period inside the server's shutdown deadline.

### Event bus

A small typed `EventBus` (`publish`, `subscribe`). Widget events are published as `{ source: 'widget', widgetId, widgetType, name, payload, at }` and logged at debug level. Phase 3 adds platform events, Phase 5 subscribes pipeline triggers.

### Assets

- **Upload:** `POST /api/assets?name=<file name>` with the file as the raw body (the dashboard sends the `File` with `fetch`). Session and Origin checks apply as for any API call.
- **Allowed types**, by the lowercase extension of `name`:
  - image: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`
  - audio: `.mp3`, `.ogg`, `.opus`, `.wav`, `.m4a`, `.flac`
  - video: `.mp4`, `.webm`
  - font: `.woff2`, `.woff`, `.ttf`, `.otf`

  Anything else is `415 unsupported_asset_type`.
- **Storage:** the body streams to a temporary file in `assets/` while its size is counted and hashed (sha256). Past 100 MB the upload is aborted with `413 asset_too_large` and the temporary file is removed. A file with a known sha256 returns the existing asset (`200`); otherwise the file is renamed to `<id><ext>` and added to `assets/index.json` (`201`).
- **Index:** a `JsonDocument` holding `{ schemaVersion: 1, assets: Asset[] }`, where `Asset = { id, name, kind, mime, size, sha256, createdAt }`.
- **Listing and deleting:** `GET /api/assets?kind=<kind>` lists them, newest first. `DELETE /api/assets/:id` removes the index entry, then the file. References in widget settings are not tracked: a deleted asset shows as "Missing asset" in the picker and doesn't load in overlays.
- **Serving:** `GET /assets/:id` has no session check (OBS has no cookie). It serves the stored MIME type with range requests, `Cache-Control: public, max-age=31536000, immutable`, `Access-Control-Allow-Origin: *`, and `Content-Security-Policy: sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'`, so an SVG opened directly can't run scripts on Overly's origin.

## 3. Overlays, public files and security (ADR 0014)

### Routes without a session

| Route | Serves |
|---|---|
| `GET /o/:widgetId` | The overlay page (below). An unknown widget, a type without an overlay, or a missing or broken plugin: `404` with a short HTML page. Other broken widgets get their page, inactive. |
| `GET /o/:widgetId/ws` | The overlay WebSocket. |
| `GET /plugins/:pluginId/*` | A public file of an ok plugin. Anything else is `404`. |
| `GET /sdk/overlay.js` | The overlay SDK bundle (`404` with a hint when it isn't built). |
| `GET /assets/:id` | An asset. |

`/plugins/` and `/sdk/` join `/api/`, `/ws`, `/o/` and `/assets/` in the reserved prefixes that never fall back to the dashboard page. The Host check still applies to all of them.

### The overlay page

The server reads the type's `overlay.entry` file and inserts, right after the opening `<head>` tag (or at the top of the document when there is none):

```html
<base href="/plugins/<pluginId>/<entry directory>/">
<script src="/sdk/overlay.js"></script>
```

Relative URLs in the plugin's HTML, CSS and scripts therefore resolve to its public files, and `window.overly` exists before the plugin's own scripts run. The SDK reads the widget ID from `location.pathname` and the preview flags from `location.search`, so nothing else is injected.

Headers: `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store`, and

```
Content-Security-Policy: sandbox allow-scripts; frame-ancestors http://127.0.0.1:<port> http://localhost:<port> [dev origins]
```

### Isolation model

- `sandbox allow-scripts` without `allow-same-origin` runs the overlay in an **opaque origin**, whether OBS loads it, the dashboard previews it, or someone opens the URL in their browser. Overlay code can't read the session cookie, can't call `/api/*` with it, and has no `localStorage`, `IndexedDB` or cookies. Persistent state belongs to the plugin backend. Overlays behave the same in OBS and in the preview.
- The overlay WebSocket upgrade accepts the usual allowed origins **and `Origin: null`** (the opaque origin), on `/o/<id>/ws` only. Anyone who knows a widget ID can receive that widget's settings and actions and answer them; widget IDs are random, and settings hold no secrets. The dashboard WebSocket `/ws` keeps its strict checks.
- Public plugin files, the SDK and assets send `Access-Control-Allow-Origin: *`, which module scripts, fonts and `fetch` from an opaque origin need. They are public by design.
- LAN access (ADR 0007) will add tokens to overlay URLs; until then the widget ID is the overlay's only credential.

### Dashboard Content-Security-Policy

Deferred from Phase 1. The dashboard's HTML responses get:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:;
connect-src 'self' ws://<host>; frame-src 'self'; frame-ancestors 'none';
object-src 'none'; base-uri 'none'; form-action 'self'
```

`<host>` is the request's (already allowlisted) Host header. Mantine needs `'unsafe-inline'` styles. `X-Frame-Options: DENY` stays.

### Overlay WebSocket protocol

Server → overlay:

| Message | Fields |
|---|---|
| `init` | `widget { id, name, type }`, `active`, `settings` |
| `settings` | `settings` |
| `widget` | `name`, `active` |
| `action` | `id` (delivery ID), `name`, `params` |
| `message` | `name`, `payload` (from `emitToOverlay`) |

Overlay → server: `actionDone { id, result? }` and `actionFailed { id, error }` (at most 500 characters). Invalid messages are ignored and logged at debug level. Close codes: `4404` widget unknown or deleted (the SDK stops reconnecting), `1001` server shutdown.

### Dashboard WebSocket messages

`ServerMessageSchema` gains:

| Message | Fields |
|---|---|
| `widgets.changed` | optional `widgetId` |
| `widget.runtime` | `widgetId`, `runtime { overlays { live, preview }, queue { pending, running } }` (`running` is an action name or `null`) |
| `widget.action` | `widgetId`, `actionId`, `action`, `status`, `warnings`, optional `error` |

The hub gets `broadcast(message)`.

## 4. SDK (`packages/sdk`)

### Overlay side (`@overly/sdk/overlay`)

Built with `bun build --target=browser --format=iife` to `packages/sdk/dist/browser/overlay.js`, served at `/sdk/overlay.js`, and exposed as `window.overly`:

```ts
interface OverlaySdk {
  readonly widgetId: string;
  readonly isPreview: boolean;
  readonly muted: boolean;
  readonly settings: Record<string, unknown> | undefined;
  onSettings(fn: (settings, widget: { id; name; type }) => void): () => void;
  onAction(name: string, fn: (params, info: { id: string }) => unknown): () => void;
  on(name: string, fn: (payload: unknown) => void): () => void;
  assetUrl(id: string): string; // "" for an empty ID, otherwise /assets/<id>
}
```

- **Connection:** connects after `DOMContentLoaded` to `/o/<id>/ws` (plus `?preview=1`), and reconnects with backoff from 0.5 s, doubling up to 10 s. After `4404` it stops and hides the page.
- **Settings:** `onSettings` handlers run on `init`, on every `settings` message, and at once when registered after settings arrived.
- **Actions:** the handler's return value (or resolved value) becomes `actionDone`; a throw or rejection becomes `actionFailed` with the error message. An action without a handler fails with `no handler for "<name>"`. Overlays register handlers synchronously while the page loads.
- **Active state:** while `active` is `false`, the SDK hides `document.documentElement` (`visibility: hidden`).
- **Preview:** `isPreview` is `?preview=1`. Sound is muted unless `?muted=0`: while muted, the SDK patches `HTMLMediaElement.prototype.play` to set `muted = true` first, so overlays that ignore `overly.muted` stay silent too.
- **Draft settings (preview only):** the SDK accepts `postMessage` events from `window.parent` shaped `{ source: 'overly-dashboard', type: 'draft-settings', settings }`. A non-null `settings` overrides the server's settings for `onSettings` until it is cleared with `settings: null`, which re-applies the latest server settings.
- **Types:** `@overly/sdk/overlay` exports `OverlaySdk` and `createOverlaySdk(env)` (the testable factory: window, WebSocket constructor, timers). `@overly/sdk/overlay-global` is a `.d.ts` declaring `var overly: OverlaySdk`, for plain-JS overlays with `// @ts-check`.

### Backend side (`@overly/sdk/backend`)

```ts
export default definePluginBackend({
  widgets: {
    banner: defineWidgetBackend<BannerSettings, BannerState>({
      initialState: { visible: false, text: '' },
      onStart(ctx) {},
      onSettings(ctx, previous) {},
      onOverlayConnect(ctx, overlay) { overlay.emit('banner', ctx.state); },
      actions: {
        show(params, ctx, info) { ctx.setState({ visible: true, text: params.text }); ctx.emitToOverlay('banner', ctx.state); },
      },
      migrateSettings(settings, { from, to }) { return settings; },
      onStop(ctx) {},
    }),
  },
});
```

**The context** each handler gets:
- `widget { id, name, type }`, `settings` and `state` (`initialState` when the stored state is `null`)
- `setState(next)`
- `emitToOverlay(name, payload?)`
- `runOverlayAction(name, params?, { timeoutMs? })`, which resolves `{ delivered: true, result }` or `{ delivered: false }`
- `emitEvent(name, payload?)`
- `log.debug/info/warn/error(msg, data?)`
- `platform`: permission-scoped platform APIs, an empty object until Phase 3

**Runtime:** `runPluginBackend(definition, channelEnd)` is the backend half of the protocol. Overly runs it in-process now, and in a child process for third-party plugins in Phase 8.

**Typing:** settings and state types come from the author (`defineWidgetBackend<S, St>`). The manifest stays the runtime source of truth.

## 5. Dashboard (`apps/dashboard`)

### Data and live updates

- The API client gains `apiSend` (POST, PATCH, DELETE with JSON) and `apiUpload` (raw `File` body).
- The TanStack Query keys are `['plugins']`, `['widgets']`, `['widget', id]` and `['assets', kind]`.
- `ServerConnectionProvider` parses `/ws` messages:
  - `widgets.changed` invalidates the widget queries
  - `widget.runtime` updates the `runtime` of the `['widget', id]` data
  - `widget.action` goes to a subscriber that updates Test notifications
- `@mantine/notifications` is added to the providers.

### Sidebar: widget list

The `+` button is enabled and opens the library modal. The section has a search field that filters by name and type name, and one row per widget:
- the type icon (`<img>` from `/plugins/…`)
- the name
- a **Broken** badge, with the first problem in a tooltip
- an enable switch, disabled when the widget is broken

The rows are links to `/widgets/:id`, with the current one highlighted. Empty state: "No widgets yet."

### Widget library modal

- A search field and a grid of cards (icon, name, description, plugin name).
- Clicking a card creates the widget, closes the modal and opens the widget page.
- Broken plugins are listed under the grid with their errors. The home page shows the same list in an alert, so a broken plugin is noticed without opening the modal.

### Widget page (`/widgets/:widgetId`)

- **Header:**
  - type icon, name, type name
  - enable switch (saved at once)
  - menu with **Duplicate** and **Delete** (Delete asks for confirmation, then returns to `/`)
- **Problems:** a red alert lists the problems of a broken widget.
  - For `plugin_missing`, `plugin_broken`, `type_missing`, `unreadable` and `unsupported_version`, the page shows only the alert and Delete.
  - For `newer_plugin_version`, the settings form is shown read-only.
  - For `settings_invalid`, the form shows the issues.
- **Overlay card** (types with an overlay):
  - the overlay URL `http://127.0.0.1:<port>/o/<id>` (from the API) in a read-only input
  - a **Copy URL** button
  - the text "Recommended Browser Source size: 1920 × 1080"
  - the connection status ("Not in OBS yet" or "1 overlay connected"; previews aren't counted)
- **Preview:**
  - `<iframe src="/o/<id>?preview=1" sandbox="allow-scripts" allow="autoplay" title="Overlay preview">` at the recommended size, scaled to the card's width with a CSS transform, on a checkerboard background
  - an **Unmute / Mute** toggle (reloads with `&muted=0`) and a **Reload** button
  - an inactive widget shows a "Disabled" note over the preview
- **Test card:** one **Test: <action title>** button per action, sending its `sample`, plus the queue status ("2 waiting"). A notification follows each action from this tab: loading, then "Done", "Done, but no overlay is connected: add the URL to OBS or keep the preview open", or "Failed: <error>".
- **Settings card:**
  - the **Name** field and the generated settings fields, in one `@mantine/form` form
  - **Save** (disabled when nothing changed or the form is invalid) and **Discard changes** (disabled when nothing changed)
  - an "Unsaved changes" indicator, and a `beforeunload` warning while there are unsaved changes
  - validation runs `schemaToZod`, and issues map to field paths
- **Live preview:** while the form is dirty and valid, the draft settings are posted to the iframe (debounced 150 ms) and re-posted when the iframe reloads. Save and Discard post `settings: null`.

### Generated fields

| Schema | Input |
|---|---|
| string | `TextInput`; `Select` with `enum`; `Textarea` (autosize) with `widget: "textarea"`; `ColorInput` (`hexa`) with `widget: "color"`; `AssetField` with `widget: "asset"` |
| number, integer | `NumberInput` (`min`, `max`, `step` = `multipleOf`, or 1 for integers, `unit` as suffix); `Slider` with `widget: "slider"`; `Select` with `enum` |
| boolean | `Switch` |
| object | `Fieldset` with the title as legend, then its fields |
| array | One row per item with a remove button, and an **Add** button that appends the item schema's defaults |

Labels come from `title` (falling back to the key) and help text from `description`.

### Asset picker

- **`AssetField`:** shows the selected asset (an image thumbnail, or the file name with its kind), with **Choose…** and **Clear** buttons. An unknown ID shows "Missing asset".
- **Asset modal:**
  - lists the assets of the accepted kinds (a thumbnail grid for images)
  - an **Upload** button (`FileButton` with an `accept` list built from the allowed extensions)
  - a delete button per asset, with confirmation
  - clicking an asset selects it and closes the modal

## 6. Built-in plugins (`plugins/`)

Each plugin is a workspace (`@overly/plugin-<name>`) and a Vitest project:

```
plugins/alerts/
  package.json        exports { "./backend": "./src/backend.ts" }, depends on @overly/sdk
  tsconfig.json       backend: ES2024, no DOM
  overlay/tsconfig.json   overlay: DOM, allowJs + checkJs, types @overly/sdk/overlay-global
  overly.plugin.json
  icons/alerts.svg
  overlay/index.html, overlay/main.js, overlay/alerts.js, overlay/style.css
  src/backend.ts, src/backend.test.ts, src/overlay.test.ts (jsdom)
```

ESLint gives `plugins/*/overlay/**/*.js` browser globals and a read-only `overly` global.

### Text banner: `overly.text-banner:banner`

- **Settings:**
  - `position` (`top` | `center` | `bottom`, default `bottom`)
  - `fontFamily` (default `system-ui, sans-serif`)
  - `fontSize` (integer 12–200, default 48, `px`)
  - `textColor` (color, `#ffffff`)
  - `backgroundColor` (color, `#000000b3`)
  - `animation` (`slide` | `fade` | `none`, default `slide`)
- **Actions** (not queued):
  - `show` with params `{ text }` (required, 1–500 characters), sample `{ "text": "Welcome to the stream!" }`
  - `hide` with no params
- **Overlay:** 1920 × 1080.
- **Backend:**
  - its state is `{ visible, text }`
  - `show` and `hide` save the state and send it to the overlays (`banner` message)
  - `onOverlayConnect` sends the state to the new overlay, so the banner survives an OBS refresh and an app restart
- **Overlay code:** applies the settings as CSS variables, and animates the banner in and out.

### Alerts: `overly.alerts:alerts`

- **Settings:**
  - `image` (asset: image, default `""`), `sound` (asset: audio, default `""`)
  - `volume` (integer 0–100, slider, `%`, default 80)
  - `durationSeconds` (number 1–60, `s`, default 6)
  - `textTemplate` (default `{{title}}`; description "Headline. Use {{title}}, {{message}} and {{variant}}.")
  - `fontFamily`, `fontSize` (default 48), `textColor` (`#ffffff`)
  - `layout` (`image-above` | `image-left`, default `image-above`)
- **Action:** `show-alert`, queued, `timeoutMs` 90000.
  - Params: `title` (required, 1–200 characters), `message` (default `""`, at most 500), `variant` (default `"default"`, at most 64).
  - Sample: `{ "title": "Ada just followed!", "message": "Thanks for the follow!", "variant": "follow" }`.
- **Event:** `alert.finished`, payload `{ title, message, variant }`, emitted only when an overlay played the alert.
- **Overlay:** 1920 × 1080.
- **Backend:** `show-alert` calls `runOverlayAction('show-alert', params)` and emits `alert.finished` when `delivered`. The queue around it guarantees one alert at a time.
- **Overlay code:**
  - renders the template by replacing `{{ title }}`, `{{ message }}` and `{{ variant }}`; the text goes in with `textContent`, so there is no HTML injection
  - shows the image, plays the sound at the configured volume (a rejected `play()` is ignored)
  - waits `durationSeconds`, fades out, then resolves

## 7. Build, dev and docs

### Scripts

- `@overly/sdk` gets `build` (`bun build src/overlay/global.ts --target=browser --format=iife --outfile=dist/browser/overlay.js`) and `dev` (the same with `--watch`).
- The server's `build` adds `bun scripts/copy-runtime-files.ts`, which copies each built-in plugin's manifest and public files to `dist/sidecar/plugins/<folder>/`, and the SDK bundle to `dist/sidecar/sdk/overlay.js`.
- Root `build` becomes: dashboard, SDK, then server. Root `dev` also runs the SDK's `dev`.
- The server's `dev` script passes `--plugins-dir` and `--overlay-sdk`.
- The Vite proxy adds `/o` (with WebSocket), `/plugins`, `/sdk` and `/assets`.
- Root `generate:schemas` writes the manifest's JSON Schema.
- **CI:** no new jobs; the existing `bun run build` and `test:sidecar` steps cover the bundle.

### Docs

- `docs/plugins/README.md`: manifest reference, schema subset and UI hints, versioning rules, overlay SDK and backend SDK basics, isolation rules for overlays. Phase 8 grows it into the authoring guide.
- `docs/plugins/overly.plugin.schema.json`: generated.
- ADR 0013: settings and parameter schemas are a JSON Schema subset, converted to Zod and rendered by Overly.
- ADR 0014: overlay serving and isolation (opaque-origin sandbox, `Origin: null` on the overlay socket, public files with CORS, the widget ID as credential, the dashboard CSP).
- ADR 0015: the widget backend message protocol, and built-in backends bundled in-process.
- `AGENTS.md`: plugin folder layout, the plain-JS overlay convention, `generate:schemas`, the new server options.
- `ROADMAP.md`: Phase 2 boxes, and the SDK line reworded (`onAction` handlers complete by returning, replacing `actionDone(result)`).
- `README.md`: a short "Widgets" section on adding a widget to OBS.

## Error handling summary

| Situation | Behavior |
|---|---|
| Invalid or incompatible manifest | Plugin listed as broken with its errors; its widgets are broken (`plugin_broken`); the server keeps running |
| Plugin folder removed | Its widgets are broken (`plugin_missing`), settings kept |
| Unreadable widget file | Listed as broken (`unreadable`), file untouched, deletable |
| Widget file from a newer Overly | Broken (`unsupported_version`), file untouched |
| Settings invalid after an update | Broken (`settings_invalid`); the form shows the issues; Save fixes it |
| Plugin downgraded | Broken (`newer_plugin_version`), read-only |
| Invalid action params | `400 invalid_params` with issues |
| Action on a disabled or broken widget | `409 widget_disabled` / `409 widget_broken` |
| Queue full | `429 queue_full` |
| No overlay connected | Action done with the `no_overlay` warning |
| Overlay never answers | Action failed (`timeout`) after `timeoutMs`; the queue moves on |
| Every overlay disconnects mid-action | Action done with `delivered: false` |
| Backend handler throws | Action failed with the error message; logged with plugin and widget IDs |
| Backend doesn't send `ready` within 5 s | Plugin broken; its widgets are broken (`plugin_broken`) |
| Backend `onStart` throws | Logged with plugin and widget IDs; the widget stays ok |
| Invalid message from a backend or an overlay | Logged and dropped |
| Asset too large / unsupported | `413 asset_too_large` / `415 unsupported_asset_type`; temporary file removed |
| Corrupt `assets/index.json` | Backed up and replaced with an empty index (Phase 1 behavior); a warning is logged |
| Overlay socket for an unknown widget | Closed with 4404; the SDK stops reconnecting |
| SDK bundle missing | `/sdk/overlay.js` answers 404 with "run bun run build" |

## Testing

- **`@overly/shared`:**
  - manifest schema (valid manifests; each rule rejected with a useful path)
  - `schemaToZod` (every type and keyword, defaults with `prefault`, `required`, stripping, color and asset formats, depth limit)
  - `settingsDefaults` and `publicPaths`
  - protocol schemas
  - the JSON Schema export equals the committed file
- **`@overly/server`:**
  - **plugins and widgets:**
    - manifest loader and registry, against temp plugin folders written by a test helper: header-first `apiVersion` check, escaping paths and symlinks, missing files, invalid samples and defaults, duplicate IDs, missing backend
    - the real `plugins/` folder loads with no errors
    - `WidgetStore`: CRUD, coalesced writes, unreadable files untouched, ID and file name mismatch
    - `WidgetService`: status codes, migrations up and down, unique default names, duplicate
  - **actions:**
    - `ActionQueue`: priority, FIFO, max length, one at a time, timeout moves on, `cancelAll`
    - `OverlayHub`: first done wins, failure only when all fail, no overlay, all disconnect, timeout, late answers ignored
    - backend host over the in-process channel: JSON-only, `ready` validation, `setState` persisted, `emitEvent` validated, invalid messages dropped, `ready` timeout
  - **HTTP routes** (`fastify.inject()`):
    - widget CRUD, actions (`202`, error codes), plugins
    - assets: upload, dedupe, size limit, extension allowlist, range request, headers
    - overlay page: injection with and without `<head>`, CSP header, 404s
    - public plugin files only; SDK route
    - CSP on dashboard pages
  - **WebSocket tests** (real socket on port 0):
    - overlay socket: `init`, settings broadcast, actions end to end, 4404, `Origin: null` accepted on the overlay socket and rejected on `/ws`
    - `widget.runtime` and `widget.action` broadcasts
  - **sidecar process test:** `/api/plugins` lists both built-in plugins as ok and `/sdk/overlay.js` is served, against the source and against the bundle in CI.
- **`@overly/sdk`:**
  - overlay client with a fake window and WebSocket: settings, actions done and failed, no handler, reconnect backoff, 4404 stops, inactive hides, mute patch, draft settings only from the parent and only in preview
  - backend runtime with a fake channel: dispatch, context methods, errors become `actionResult ok: false`, `migrate`
- **Plugins:** backend tests with the runtime and a fake host; overlay logic tests in jsdom (template rendering and escaping, banner show and hide).
- **`@overly/dashboard`:**
  - generated fields (every input type, validation errors, dirty state, Discard, array add and remove)
  - widget list (search, switch, broken badge)
  - library modal (create and navigate, broken plugins)
  - widget page (copy URL, recommended size, test buttons call the API with the sample, preview iframe attributes, draft `postMessage`)
  - asset picker (upload, select, clear, missing asset)
- **Manual:**
  - the exit criteria, with the dev build in the in-app browser (an overlay tab standing in for OBS) on macOS
  - in OBS by the maintainer

## Out of scope

- Third-party plugins: install, child-process isolation, trust prompt, permission enforcement (Phase 8)
- Running nodes and pipelines (Phase 4); widget event triggers (Phase 5)
- Platform APIs in the backend context (Phase 3)
- LAN access and overlay URL tokens
- Editing test parameters before running an action; action history
- An in-app navigation guard for unsaved changes (only `beforeunload`)
- Tracking which widgets use an asset
- Export and import (Phase 7)
