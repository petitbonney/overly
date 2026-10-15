# Overly plugins

A plugin adds **widget types** (and, from Phase 4, **node types**) to Overly. Built-in features use the same format: see [`plugins/`](../../plugins/README.md) for working examples. Third-party plugins (install from a folder or a git URL, the trust prompt, isolated backends) arrive in Phase 8; this page already describes the format they will use.

- [Folder layout](#folder-layout)
- [Manifest: `overly.plugin.json`](#manifest-overlypluginjson)
- [Schemas: settings, parameters, payloads](#schemas-settings-parameters-payloads)
- [Versioning](#versioning)
- [Overlays and the overlay SDK](#overlays-and-the-overlay-sdk)
- [Backends and the backend SDK](#backends-and-the-backend-sdk)

The manifest's JSON Schema is [`overly.plugin.schema.json`](overly.plugin.schema.json). Point `$schema` at it to get completion and checks in your editor. It is generated from the Zod schemas in `@overly/shared` (`bun run generate:schemas`).

## Folder layout

```
my-plugin/
  overly.plugin.json   the manifest
  icons/               icons (served publicly)
  overlay/             the overlay page and its files (served publicly)
    index.html
    main.js
  src/backend.ts       optional backend code
```

Only the folder of each overlay `entry` and the icon files are served over HTTP, at `/plugins/<plugin id>/<path>`. The manifest, the backend and anything else stay private. Keep tests and secrets out of the overlay folder.

## Manifest: `overly.plugin.json`

```json
{
  "$schema": "../../docs/plugins/overly.plugin.schema.json",
  "id": "example.counter",
  "name": "Counter",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "A number on screen that pipelines can change.",
  "author": "Ada",
  "icon": "icons/counter.svg",
  "permissions": [],
  "backend": "src/backend.ts",
  "widgets": [
    {
      "type": "counter",
      "name": "Counter",
      "settings": {
        "type": "object",
        "properties": {
          "label": { "type": "string", "title": "Label", "default": "Deaths" },
          "color": { "type": "string", "title": "Color", "default": "#ffffff", "x-overly": { "widget": "color" } }
        }
      },
      "overlay": { "entry": "overlay/index.html", "width": 600, "height": 200 },
      "actions": [
        {
          "name": "add",
          "title": "Add",
          "params": { "type": "object", "properties": { "by": { "type": "integer", "default": 1 } } },
          "sample": { "by": 1 }
        }
      ],
      "events": [
        {
          "name": "counter.changed",
          "title": "Counter changed",
          "payload": { "type": "object", "properties": { "value": { "type": "integer" } }, "required": ["value"] },
          "sample": { "value": 3 }
        }
      ]
    }
  ]
}
```

### Plugin fields

| Field | Rule |
|---|---|
| `$schema` | Optional, ignored by Overly. |
| `id` | Lowercase letters and digits, separated by dots or dashes (`^[a-z0-9]+(?:[.-][a-z0-9]+)*$`), at most 64 characters. `overly.` is reserved for built-in plugins. |
| `name` | 1–64 characters. |
| `version` | A semantic version: `1.0.0`, `1.1.0-beta.1`. |
| `apiVersion` | The plugin API the manifest is written for. This version of Overly supports `1`. |
| `description` | Optional, at most 500 characters. |
| `author` | Optional, at most 200 characters. |
| `icon` | Optional `.svg`, `.png` or `.webp` file. |
| `permissions` | Optional: `events:read`, `chat:write`, `rewards:manage`, `polls:manage`, `predictions:manage`, `input:keyboard`, `input:mouse`, `network`. The platform APIs a backend gets will be limited to these (Phases 3, 8 and 9). |
| `backend` | Optional path to the backend module. |
| `widgets` | Widget types (below). |
| `nodes` | Node types for pipelines. Validated now, used from Phase 4. |

A plugin declares at least one widget or node type. Unknown keys are errors, so typos are caught. Paths are relative to the plugin folder, use `/`, and can't contain `..`, a leading `/`, `\` or `:`. Overly also checks that every file exists and stays inside the folder (symlinks included).

### Widget type fields

| Field | Rule |
|---|---|
| `type` | Lowercase words separated by dashes, unique in the plugin. A widget's type is written `<plugin id>:<type>`, for example `overly.alerts:alerts`. |
| `name`, `description`, `icon` | As for the plugin. The icon falls back to the plugin's. |
| `settings` | An object schema; every setting has a default. |
| `overlay` | Optional: `entry` (an `.html` file inside a folder, like `overlay/index.html`), plus `width` and `height`, the Browser Source size the dashboard recommends. |
| `queue.maxLength` | How many queued actions may wait, 1–1000, default 100. |
| `actions` | What pipelines and the **Test** buttons can run (below). |
| `events` | What the widget can report to pipelines (below). |

### Actions

| Field | Rule |
|---|---|
| `name` | Lowercase words separated by dashes (`show-alert`), unique for the widget type. |
| `title`, `description` | Shown in the dashboard. |
| `params` | An object schema. Use `required` and defaults as needed. |
| `output` | Optional object schema the result must match. |
| `sample` | Parameters for the **Test** button. They must pass `params`. |
| `queued` | `true` for actions that take time (an alert). Queued actions of a widget run one at a time, by priority then in order. Other actions run at once. Default `false`. |
| `timeoutMs` | How long the action may take, 100–600000 ms, default 30000. |

Every action needs a handler: the backend handles it if it registers a handler for it, otherwise it goes to the overlay. A widget type without an overlay must have a backend that handles all of its actions.

### Events

| Field | Rule |
|---|---|
| `name` | Lowercase words separated by dots or dashes (`alert.finished`). |
| `title`, `description` | Shown in the dashboard. |
| `payload` | An object schema. The backend's events are checked against it. |
| `sample` | An example payload, used to test pipelines (Phase 4). It must pass `payload`. |

## Schemas: settings, parameters, payloads

Settings, action parameters and outputs, and event payloads use the same **subset of JSON Schema** (ADR 0013). Anything outside it is a manifest error, so every valid manifest can be validated and turned into a form.

| `type` | Keywords |
|---|---|
| `string` | `default`, `enum`, `minLength`, `maxLength` |
| `number`, `integer` | `default`, `enum`, `minimum`, `maximum`, `multipleOf` |
| `boolean` | `default` |
| `object` | `properties` (at most 100; keys start with a letter), `required` |
| `array` | `items`, `default`, `minItems`, `maxItems` |

Every schema may have a `title` (the form label; the key is used otherwise), a `description` (help text under the field), and UI hints under `x-overly`:

| Hint | For | Effect |
|---|---|---|
| `"widget": "textarea"` | string | A multi-line input. |
| `"widget": "color"` | string | A color picker. Values are `#rrggbb` or `#rrggbbaa`. |
| `"widget": "asset", "accept": ["image"]` | string | A file from the asset library (`image`, `audio`, `video`, `font`). The value is an asset ID, or `""` for none. |
| `"widget": "slider"` | number, integer | A slider; needs `minimum` and `maximum`. |
| `"unit": "px"` | number, integer | A suffix after the input. |
| `"placeholder": "…"` | string, number | The input's placeholder. |
| `"enumLabels": [ … ]` | any `enum` | Display labels, one per value. |

Nesting is limited to 5 levels. **Every setting must have a default** (arrays and the fields of array items included), so a new widget is always valid. Defaults and samples are checked when the plugin loads. Unknown keys in saved settings are dropped.

## Versioning

- **`apiVersion`** is checked first. A plugin made for another plugin API gets one clear error: "This plugin needs a newer version of Overly (plugin API 2)".
- Each widget stores the plugin **`version`** that last wrote its settings. When the plugin is updated, its backend's `migrateSettings` (if any) runs, then the settings are checked again, with new defaults filled in and removed settings dropped. If they still fail, the widget is marked broken until its settings are fixed in the dashboard.
- A widget saved by a **newer** version of the plugin is marked broken and never rewritten, so going back to that version keeps its settings.

## Overlays and the overlay SDK

An overlay is an HTML page that OBS loads at `http://127.0.0.1:<port>/o/<widget id>`. Overly serves the `entry` file with two tags added right after `<head>`:

```html
<base href="/plugins/<plugin id>/<entry folder>/">
<script src="/sdk/overlay.js"></script>
```

So relative URLs reach your public files, and the `overly` global exists before your scripts run. Built-in overlays are plain JavaScript modules with no build step; add `// @ts-check` and the `@overly/sdk/overlay-global` types to get type checking.

```js
// @ts-check
overly.onSettings((settings) => {
  document.body.style.color = String(settings['color']);
});

overly.onAction('add', async (params) => {
  await animate(params['by']);
  return { shown: true }; // the action is done when this resolves
});

overly.on('count', (payload) => {
  render(payload);
});
```

| API | |
|---|---|
| `overly.widgetId` | The widget ID from the URL. |
| `overly.isPreview` | `true` in the dashboard preview. |
| `overly.muted` | `true` in the preview until unmuted. Media elements are muted for you. |
| `overly.settings` | The settings, once they arrived. |
| `overly.onSettings(fn)` | Calls `fn(settings, widget)` now (if settings arrived) and on every change. |
| `overly.onAction(name, fn)` | Handles an action. It is done when `fn` returns or its promise resolves, and failed when `fn` throws or rejects. Register handlers while the page loads. |
| `overly.on(name, fn)` | Custom messages from the backend (`ctx.emitToOverlay`). |
| `overly.assetUrl(id)` | The URL of an asset chosen in the settings, or `""`. |

Rules of the overlay world (ADR 0014):

- **Overlays run in a sandbox with an opaque origin**, in OBS and in the preview alike. There are no cookies, no `localStorage` and no `IndexedDB`; keep state in the backend.
- Actions go to every overlay of the widget: OBS and any open previews. The first one to finish completes the action.
- While the widget is disabled the page is hidden, and after the widget is deleted the SDK stops reconnecting.
- In the preview, the dashboard sends unsaved settings to the page, so it follows the form. OBS only gets saved settings.

## Backends and the backend SDK

A backend owns a widget's logic and state: what the banner shows, the votes of a poll, the result of a spin. It talks to Overly only through messages (ADR 0015). Built-in backends run inside the server process; third-party backends will run in a separate process (Phase 8) with the same API.

```ts
import { definePluginBackend, defineWidgetBackend } from '@overly/sdk/backend';

interface CounterState {
  value: number;
}

const counter = defineWidgetBackend<{ label: string }, CounterState>({
  initialState: { value: 0 },
  onOverlayConnect(ctx, overlay) {
    overlay.emit('count', ctx.state);
  },
  actions: {
    add(params, ctx) {
      ctx.setState({ value: ctx.state.value + Number(params['by']) });
      ctx.emitToOverlay('count', ctx.state);
      ctx.emitEvent('counter.changed', { value: ctx.state.value });
      return ctx.state;
    },
  },
  migrateSettings(settings, { from }) {
    return from.startsWith('0.') ? { ...settings, label: settings['title'] } : settings;
  },
});

export default definePluginBackend({ widgets: { counter } });
```

| Context | |
|---|---|
| `ctx.widget` | `{ id, name, type }` |
| `ctx.settings` | The saved settings, already validated. |
| `ctx.state`, `ctx.setState(next)` | Persistent state, saved with the widget (JSON, at most 1 MB). It starts as `initialState`. |
| `ctx.emitToOverlay(name, payload)` | A custom message to every overlay (`overly.on`). |
| `ctx.runOverlayAction(name, params)` | Runs an overlay action and waits: `{ delivered: true, result }`, or `{ delivered: false }` when no overlay played it. |
| `ctx.emitEvent(name, payload)` | A widget event declared in the manifest. Invalid events are dropped. |
| `ctx.log.debug/info/warn/error(msg, data?)` | Goes to Overly's log with the plugin and widget IDs. |
| `ctx.platform` | Platform APIs allowed by `permissions`. Empty until Phase 3. |

Hooks: `onStart`, `onSettings(ctx, previous)`, `onOverlayConnect(ctx, overlay)` and `onStop` run as the widget starts, gets new settings, sees an overlay connect, and stops (when disabled or deleted). A hook that throws is logged; the widget keeps running.
