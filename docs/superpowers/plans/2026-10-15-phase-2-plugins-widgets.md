# Phase 2 Plugin Format & Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugins declare widget types in `overly.plugin.json`; the sidecar loads them, stores widgets, queues and runs their actions through in-process backends and sandboxed overlays; the dashboard creates, configures, previews and tests widgets; Text banner and Alerts ship as built-in plugins.

**Architecture:**
- **`@overly/shared`** gains the manifest schema, a JSON Schema subset with a Zod converter, and the widget, asset and protocol schemas.
- **`apps/server`** gains a plugin registry, a widget store, per-widget action queues, an overlay hub (overlay WebSockets), a backend host, a widget service, an asset store, and routes for `/api`, `/o`, `/plugins`, `/sdk` and `/assets`.
  - The backend host talks JSON messages over an in-process channel to the SDK's backend runtime.
  - The widget service ties all of these together.
- **`@overly/sdk`** has two halves:
  - an overlay client, bundled as an IIFE served at `/sdk/overlay.js`
  - the backend runtime and `definePluginBackend`
- **Built-in plugins** are workspaces in `plugins/`: plain-JS overlays and TypeScript backends, imported statically by the server.
- **`apps/dashboard`** gains:
  - a widget list and a widget library modal
  - a widget page with a schema-generated form, a sandboxed preview, Test buttons and an asset picker

**Tech Stack:** Node 24, Fastify 5 (+ @fastify/static, @fastify/websocket), Zod 4, semver 7, Bun (scripts, bundler); React 19, Mantine 9 (+ @mantine/form, @mantine/notifications), TanStack Query 5, React Router 8, Vitest 5 + jsdom.

**Spec:** [docs/superpowers/specs/2026-10-14-phase-2-plugins-widgets-design.md](../specs/2026-10-14-phase-2-plugins-widgets-design.md)

## Global Constraints

- Everything in AGENTS.md conventions applies:
  - Node LTS runtime, no `Bun.*` outside scripts
  - ESM, with `.js` relative imports and `import type`
  - no `any`, and no `!` without a comment
  - Zod at every boundary, through schemas from `@overly/shared`
  - exact dependency versions in the workspace that uses them
  - bind 127.0.0.1, and no `console` in `apps/server/src`
- New dependency versions: `@mantine/form` 9.7.2, `@mantine/notifications` 9.7.2 (dashboard); `semver` 7.8.5 and `@types/semver` 7.8.0 (server); `jsdom` 30.1.2 (devDependency of `@overly/sdk` and of each plugin).
- Widget and asset IDs match `^[a-z0-9]{12}$`. Widget type references are `<pluginId>:<type>`.
- Limits:
  - action `timeoutMs` 100–600000, default **30000**
  - queue `maxLength` 1–1000, default **100**; priority −100 to 100, default **0**
  - asset size **104857600** bytes (100 MB)
  - backend state **1048576** bytes serialized
  - `actionFailed.error` at most **500** characters
  - schema nesting at most **5** levels; at most **100** properties per object
- Timings:
  - backend `ready` timeout **5 s**; backend stop grace **1 s** (inside the 5 s server shutdown deadline)
  - overlay reconnect **0.5 s doubling to 10 s**
  - draft preview debounce **150 ms**
- WebSocket close codes: **4404** (widget unknown or deleted), **1001** (shutdown).
- Routes without a session: `/o/:widgetId`, `/o/:widgetId/ws`, `/plugins/:pluginId/*`, `/sdk/overlay.js`, `/assets/:id`. Reserved prefixes (no SPA fallback): `/api/`, `/ws`, `/o/`, `/assets/`, `/plugins/`, `/sdk/`.
- Overlay page CSP, exact: `sandbox allow-scripts; frame-ancestors <origins separated by spaces>`, where the origins are `http://127.0.0.1:<port>`, `http://localhost:<port>`, then the dev origins.
- Dashboard CSP, exact (one line, separated by `; `): `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `media-src 'self' blob:`, `font-src 'self' data:`, `connect-src 'self' ws://<host>`, `frame-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`.
- Asset response CSP, exact: `sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'`.
- Fixed copy:
  - widget page: **Copy URL**; `Recommended Browser Source size: <w> × <h>`; **Not in OBS yet**; **1 overlay connected** / **<n> overlays connected**; **Test: <action title>**; **<n> waiting**; **Save**; **Discard changes**; **Unsaved changes**; **Duplicate**; **Delete**; **Disabled**; **Mute** / **Unmute**; **Reload**; **This widget no longer exists.**
  - action notifications: **Done**; **Done, but no overlay is connected: add the URL to OBS or keep the preview open**; **Failed: <error>**
  - widget list and asset picker: **No widgets yet.**; **Missing asset**; **Choose…**; **Clear**; **Upload**
  - names: duplicate suffix ` (copy)`; unique names `<type name> <n>` starting at 2
- Shell commands need `export PATH="$HOME/homebrew/bin:$PATH"` first. Run tests with `bun run test --project <workspace>` (never `bun test`).
- Commit after every task with an imperative subject, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Path traversal into a plugin folder** through `/plugins/:pluginId/*`: `%2e%2e/`, `..%2f`, a backslash (`overlay\..\overly.plugin.json`), or a symlink that points out of the folder. Expected: `404`, and only public files are ever served. Tests: Task 6 `publicFile refuses paths outside the public set`, Task 16 `does not serve encoded traversal`.
2. **Asset file names a streamer actually has**: an uppercase extension (`ALERT.PNG`), spaces and accents (`Mon son É.mp3`), or a path-like name (`..\..\x.png`). Expected: the extension matches case-insensitively, the file is stored only as `assets/<id><ext>`, and the display name is the base name. Test: Task 15 `stores odd file names safely`.
3. **Copy URL in dev**: the dashboard runs on the Vite port (5173), but OBS must point to the server's port. Expected: the URL shown is the API's `overlayUrl` (`http://127.0.0.1:<server port>/o/<id>`), never built from `location`. Test: Task 25 `shows the overlay URL from the API`.
4. **A widget deleted in another tab** while this tab shows its page with unsaved edits. Expected: when the query or a mutation answers `404 widget_not_found`, the page shows **This widget no longer exists.** with a link home, instead of crashing or showing a spinner forever. Test: Task 25 `shows a message when the widget was deleted elsewhere`.
5. **OBS refreshes the Browser Source in the middle of an alert.**
   - Expected: the alert being played resolves as not delivered, the queue moves on, and the next alert reaches the reconnected overlay.
   - Expected: `alert.finished` is not emitted for the lost alert.
   - Tests: Task 9 `a reconnected overlay receives the next action`, Task 20 `does not emit alert.finished when no overlay played it`.

---

## File Structure

```
packages/shared/src/
  ids.ts                 ID and name patterns, Zod ID schemas
  json.ts                JsonValue type and schema
  backoff.ts             reconnectDelay (moved from the dashboard)
  schema/subset.ts       Field schemas (the subset), ASSET_KINDS, checkSchemaRules
  schema/to-zod.ts       schemaToZod, settingsDefaults, formatIssues, COLOR_PATTERN
  plugin/manifest.ts     manifest schemas, header, rules, widgetTypeRef, publicPaths, PERMISSIONS
  plugin/json-schema.ts  pluginManifestJsonSchema()
  widget.ts              widget document, problems, runtime, action statuses, limits
  assets.ts              extension table, AssetSchema, MAX_ASSET_BYTES
  overlay-protocol.ts    overlay WebSocket messages, close code
  backend-protocol.ts    host ↔ backend messages, ChannelEnd, MAX_STATE_BYTES
  api.ts, messages.ts    (extended)
packages/shared/scripts/generate-schemas.ts
packages/sdk/src/
  backend/{define,runtime,index}.ts
  overlay/{sdk,global,index}.ts, overlay/global.d.ts
apps/server/
  scripts/copy-runtime-files.ts            (replaces copy-dashboard.js)
  src/util/random-id.ts
  src/storage/serialized-writer.ts
  src/plugins/{loader,registry,builtin}.ts
  src/widgets/{store,queue,overlay-hub,in-process-channel,backend-host,service,action-runner}.ts
  src/events/bus.ts
  src/assets/store.ts
  src/http/{widget-routes,asset-routes,overlay-routes,csp,static}.ts
  src/ws/overlay-socket.ts
  src/testing/{plugins,services}.ts        fixture plugins, service wiring for tests
plugins/text-banner/, plugins/alerts/      built-in plugins
apps/dashboard/src/
  api/hooks.ts
  forms/{SchemaFields,ArrayField,validate}.tsx|ts
  assets/{AssetField,AssetModal}.tsx
  widgets/{WidgetList,WidgetLibraryModal,BrokenPlugins,WidgetPage,OverlayCard,
           OverlayPreview,TestActions,SettingsForm,useActionNotifications}.tsx|ts
docs/plugins/{README.md,overly.plugin.schema.json}
docs/adr/0013-*.md, 0014-*.md, 0015-*.md
```

---

### Task 1: Schema subset and Zod conversion

**Files:**
- Create: `packages/shared/src/{ids,json}.ts`, `packages/shared/src/schema/{subset,to-zod}.ts`, a `*.test.ts` next to each
- Modify: `packages/shared/src/index.ts` (re-export)

**Interfaces:**
- Produces:
  - `ids.ts`:
    - `RANDOM_ID_PATTERN = /^[a-z0-9]{12}$/`
    - `PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/` (also used for event names)
    - `KEBAB_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`
    - `PROPERTY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/`
    - `SEMVER_PATTERN` (semver 2.0.0 with prerelease and build)
    - `WidgetIdSchema`, `AssetIdSchema`, `PluginIdSchema` (max 64), `SemverSchema`
  - `json.ts`: `type JsonValue`; `JsonValueSchema: z.ZodType<JsonValue>`.
  - `schema/subset.ts`:
    - asset kinds: `ASSET_KINDS = ['image', 'audio', 'video', 'font'] as const`, `AssetKindSchema`, `type AssetKind`
    - Zod validators (strict objects, recursive through getters as in Zod 4 docs) and their inferred types: `FieldSchema`, `ObjectFieldSchema`; `type Field`, `ObjectField`, `StringField`, `NumberField`, `BooleanField`, `ArrayField`
    - the `x-overly` key holds `{ widget?, accept?, unit?, placeholder?, enumLabels? }`
  - `checkSchemaRules(root: ObjectField, options: { requireDefaults: boolean; path: string }): string[]`. It returns `"<path>: <problem>"` messages for:
    - depth > 5; a `required` key not in `properties`
    - `enumLabels` length ≠ `enum` length
    - `slider` without both `minimum` and `maximum`; `asset` without `accept`
    - a hint on the wrong type (`color`, `asset` or `textarea` on non-strings, `slider` on non-numbers)
    - with `requireDefaults`, a non-object field without `default`
  - `schema/to-zod.ts`:
    - `COLOR_PATTERN = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i`
    - `schemaToZod(root: ObjectField): z.ZodType<Record<string, unknown>>`: leaf defaults use `.prefault(default)`; an object field without a default uses `.prefault({})`; properties outside `required` without a default are `.optional()`; objects strip unknown keys; `integer` → `z.int()`; asset values match `''` or `RANDOM_ID_PATTERN`
    - `settingsDefaults(root: ObjectField): Record<string, unknown>` = `schemaToZod(root).parse({})`
    - `formatIssues(error: z.ZodError): { path: string; message: string }[]`, with paths joined by `.` (`items.0.name`)

- [ ] **Step 1: Write the failing tests**

```ts
// subset.test.ts
it('accepts every type and hint of the subset', ...);         // string+enum+enumLabels, color, textarea, asset(accept), number slider+unit, integer, boolean, nested object, array of objects
it.each([['pattern', { type: 'string', pattern: 'a' }], ['format', { type: 'string', format: 'uri' }], ['oneOf', { oneOf: [] }]])
  ('rejects the unsupported keyword %s', ...);
it('rejects bad property keys and more than 100 properties', ...);   // '1bad', 'a-b'
it('reports rule problems with their path', () => {
  expect(checkSchemaRules(deep6, { requireDefaults: false, path: 'settings' })).toContainEqual(expect.stringContaining('deeper than 5'));
  // required: ['nope'] → 'settings: required lists "nope", which is not a property'
  // slider without maximum, asset without accept, color on a number, enumLabels length mismatch
});
it('requires a default on every settings leaf', () => {
  expect(checkSchemaRules(obj({ volume: { type: 'integer' } }), { requireDefaults: true, path: 'settings' }))
    .toEqual(['settings.properties.volume: needs a default']);
});
// to-zod.test.ts
it('fills defaults, including nested objects', ...);         // parse({}) → { a: 'abc', n: 3, inner: { c: true } }
it('fails when a default breaks its own schema', ...);       // maxLength 2, default 'toolong' → parse({}) throws
it('strips unknown keys', ...);
it('keeps required params required and others optional', ...);
it.each([[1.5, false], [2, true]])('integer %s → %s', ...);
it('checks minimum, maximum, multipleOf, enum, minItems and maxItems', ...);
it('accepts #rrggbb and #rrggbbaa colors only', ...);       // '#fff' and 'red' rejected
it('accepts an empty asset or a 12-character ID', ...);      // '', 'abcdefghij12' ok; 'ABC', '../x' rejected
it('formats issue paths with dots', ...);                    // 'items.0.name'
```

- [ ] **Step 2: Run `bun run test --project @overly/shared`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the four files and the re-exports.**
- [ ] **Step 4: Run `bun run test --project @overly/shared && bun run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the plugin schema subset and its Zod conversion".

---

### Task 2: Plugin manifest and its JSON Schema

**Files:**
- Create: `packages/shared/src/plugin/{manifest,json-schema}.ts` with tests, `packages/shared/scripts/generate-schemas.ts`, `docs/plugins/overly.plugin.schema.json` (generated)
- Modify: root `package.json` (`"generate:schemas": "bun packages/shared/scripts/generate-schemas.ts"`), `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `SUPPORTED_API_VERSIONS = [1] as const`
  - `PERMISSIONS = ['events:read', 'chat:write', 'rewards:manage', 'polls:manage', 'predictions:manage', 'input:keyboard', 'input:mouse', 'network'] as const`, `PermissionSchema`
  - `RelativePathSchema`: 1–200 characters; `/` separators; no empty, `.` or `..` segments; no leading `/`; no `\` and no `:`
  - Declaration schemas (strict), with the spec's rules and defaults:
    - `OverlayDeclSchema`: `entry` ends with `.html` and has at least one `/`, so the manifest and backend are never public
    - `ActionDeclSchema`, `EventDeclSchema`, `WidgetTypeDeclSchema`, `NodeTypeDeclSchema`, `PortDeclSchema`
    - `PluginManifestSchema`: strict, with `$schema` allowed
  - Types: `PluginManifest`, `WidgetTypeDecl`, `ActionDecl`, `EventDecl`, `NodeTypeDecl`.
  - `ManifestHeaderSchema = z.looseObject({ id, name, version, apiVersion: z.int().positive() })`
  - `checkManifestRules(manifest: PluginManifest): string[]`:
    - at least one widget or node
    - unique widget types, action names and event names
    - `checkSchemaRules` on settings (`requireDefaults: true`) and on params, output and payload (`false`)
    - every `sample` passes its schema
    - `settingsDefaults` succeeds
    - message paths look like `widgets[0].actions[1].sample`
  - `widgetTypeRef(pluginId: string, type: string): string`, `parseWidgetTypeRef(ref: string): { pluginId: string; type: string } | undefined`, `WidgetTypeRefSchema`
  - `publicPaths(manifest): { dirs: string[]; files: string[] }`: `dirs` are the unique directories of overlay entries; `files` are the plugin and widget icons. `isPublicPath(paths, relPath): boolean`.
  - `pluginManifestJsonSchema(): Record<string, unknown>` = `z.toJSONSchema(PluginManifestSchema, { io: 'input' })`. The script writes it with `JSON.stringify(schema, null, 2) + '\n'`.

- [ ] **Step 1: Write the failing tests**

```ts
it('parses a minimal manifest and fills defaults', ...);   // permissions [], nodes [], widget settings {type:'object',properties:{}}, queue.maxLength 100, action queued false, timeoutMs 30000
it('parses the full example from the spec', ...);
it.each(['Overly.Alerts', 'a..b', '-a'])('rejects the plugin ID %s', ...);
it.each(['1.0', 'v1.0.0'])('rejects the version %s', ...);
it.each(['../x.svg', '/x.svg', 'a\\b.svg', 'C:x.svg', 'a//b.svg', './x.svg'])('rejects the path %s', ...);
it('rejects an overlay entry at the plugin root or not ending in .html', ...);
it('rejects unknown keys with their path', ...);           // widgets[0].setings → issue path 'widgets.0'
it('rejects unknown permissions', ...);
it('reports duplicate names, invalid samples and missing settings defaults', () => {
  expect(checkManifestRules(withBadSample)).toContain('widgets[0].actions[0].sample: title: Invalid input: expected string, received undefined');
});
it('reports a plugin without widgets or nodes', ...);
it('reads the header of a manifest for a future API', ...); // { apiVersion: 2, futureKey: 1 } → header parses
it('lists overlay directories and icons as public paths', ...); // dirs ['overlay'], files ['icons/a.svg']
// json-schema.test.ts
it('matches docs/plugins/overly.plugin.schema.json', async () => {
  const file = await readFile(new URL('../../../../docs/plugins/overly.plugin.schema.json', import.meta.url), 'utf8');
  expect(file).toBe(`${JSON.stringify(pluginManifestJsonSchema(), null, 2)}\n`);
});
```

- [ ] **Step 2: Run the shared tests.** Expected: FAIL.
- [ ] **Step 3: Implement, then run `bun run generate:schemas`** to create the JSON Schema file.
- [ ] **Step 4: Run `bun run test --project @overly/shared && bun run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the plugin manifest schema and its JSON Schema export".

---

### Task 3: Widget, asset and protocol schemas

**Files:**
- Create: `packages/shared/src/{widget,assets,overlay-protocol,backend-protocol,backoff}.ts` with tests
- Modify: `packages/shared/src/{api,messages,index}.ts` and their tests. Move `apps/dashboard/src/connection/backoff.ts` and its test to `packages/shared/src/backoff.ts`, and update `ServerConnection.tsx` to import `reconnectDelay` from `@overly/shared`.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `widget.ts`:
    - document: `WIDGET_SCHEMA_VERSION = 1`, `WidgetDocumentSchema` (spec fields; `name` trimmed 1–100; `state: JsonValueSchema`), `WidgetDocument`
    - problems: `WIDGET_PROBLEM_CODES` (spec order), `WidgetProblemSchema { code, message }`
    - runtime: `WidgetRuntimeSchema { overlays: { live, preview }, queue: { pending, running: string | null } }`
    - actions: `ACTION_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled']` (`type ActionStatus`), `ACTION_WARNINGS = ['no_overlay']` (`type ActionWarning`)
    - limits: `DEFAULT_ACTION_TIMEOUT_MS = 30_000`, `DEFAULT_QUEUE_MAX_LENGTH = 100`, `ACTION_PRIORITY = { min: -100, max: 100 }`
  - `assets.ts`:
    - `ASSET_EXTENSIONS: Readonly<Record<string, { kind: AssetKind; mime: string }>>`, keyed by lowercase extension with its dot, holding the spec's list. MIME types: `.jpg`/`.jpeg` image/jpeg, `.svg` image/svg+xml, `.mp3` audio/mpeg, `.ogg`/`.opus` audio/ogg, `.wav` audio/wav, `.m4a` audio/mp4, `.flac` audio/flac, `.mp4` video/mp4, `.webm` video/webm, `.woff2` font/woff2, `.woff` font/woff, `.ttf` font/ttf, `.otf` font/otf.
    - `MAX_ASSET_BYTES = 104_857_600`
    - `AssetSchema { id, name, kind, mime, size, sha256, createdAt }`, `Asset`
    - `assetTypeForName(name: string): { ext: string; kind: AssetKind; mime: string } | undefined`
    - `acceptForKinds(kinds: readonly AssetKind[]): string`: `.png,.jpg,…` for `<input accept>`
  - `overlay-protocol.ts`:
    - `OVERLAY_CLOSE_NOT_FOUND = 4404`
    - `OverlayServerMessageSchema`: `init`, `settings`, `widget`, `action`, `message`
    - `OverlayClientMessageSchema`: `actionDone`, `actionFailed`, with `error` at most 500
    - types `OverlayServerMessage`, `OverlayClientMessage`
  - `backend-protocol.ts`:
    - `HostToBackendMessageSchema` and `BackendToHostMessageSchema`: discriminated on `type`, with the spec's tables (including `overlayAction.callId`)
    - `MAX_STATE_BYTES = 1_048_576`
    - `interface ChannelEnd { send(message: unknown): void; onMessage(handler: (message: unknown) => void): void; close(): void }`
  - `api.ts`:
    - errors: `ApiErrorCode` gains the spec's codes; `ApiErrorBodySchema` gains `message?` and `issues?: { path, message }[]`
    - plugins: `ActionInfoSchema`, `EventInfoSchema`, `WidgetTypeInfoSchema`, `PluginInfoSchema`, `PluginsResponseSchema`
    - widgets: `WidgetSummarySchema`, `WidgetsResponseSchema`, `WidgetDetailSchema`
    - requests: `CreateWidgetBodySchema`, `UpdateWidgetBodySchema` (at least one key), `RunActionBodySchema` (`params` default `{}`, `priority` integer in range, default 0)
    - responses: `RunActionResponseSchema { actionId, status: 'queued' | 'running' }`, `AssetsResponseSchema`
  - `messages.ts`: `ServerMessageSchema` adds `widgets.changed`, `widget.runtime` and `widget.action` (spec fields; `warnings` defaults to `[]`).
  - `backoff.ts`: `reconnectDelay(attempt: number): number`, unchanged.
  - Every schema exports its inferred type under the same name without `Schema` (`WidgetDetail`, `WidgetTypeInfo`, `ActionInfo`, `PluginInfo`, `RunActionBody`, …).

- [ ] **Step 1: Write the failing tests** (one per schema file, plus the moved backoff test)

```ts
it('accepts a widget document and rejects a bad ID, an empty name, or a non-JSON state', ...);
it('finds asset types by extension, case-insensitively', ...);  // 'A.PNG' → image/png; 'x.exe' → undefined; 'noext' → undefined
it('builds an accept list for audio', ...);                       // contains '.mp3' and '.flac', not '.png'
it('parses every overlay message and rejects a 501-character error', ...);
it('parses every backend message both ways and rejects an unknown type', ...);
it('parses the new dashboard messages', ...);                     // widget.action without warnings → warnings []
it('rejects an empty update body and a priority of 101', ...);
```

- [ ] **Step 2: Run `bun run test --project @overly/shared --project @overly/dashboard`.** Expected: FAIL.
- [ ] **Step 3: Implement and move the backoff helper.**
- [ ] **Step 4: Run the shared and dashboard tests, then `bun run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add widget, asset, overlay and backend protocol schemas".

---

### Task 4: Serialized writer and random IDs

**Files:**
- Create: `apps/server/src/storage/serialized-writer.ts`, `apps/server/src/util/random-id.ts`, tests
- Modify: `apps/server/src/storage/json-document.ts` (delegate its writes to `SerializedWriter`)

**Interfaces:**
- Produces:
  - `class SerializedWriter { constructor(path: string, write?: (path: string, data: string) => Promise<void>); schedule(data: string): Promise<void>; flush(): Promise<void> }`. It keeps one write in flight and at most one pending value (the newest wins), exactly like `JsonDocument` today. The default write is `writeFileAtomic`.
  - `randomId(): string`: 12 characters from `[a-z0-9]`, drawn from `crypto.randomBytes` with rejection sampling (bytes ≥ 252 are discarded).

- [ ] **Step 1: Write the failing tests**

```ts
it('coalesces three schedules into at most two writes, keeping the last', ...);
it('flush resolves after the pending write is on disk', ...);
it('generates 12-character IDs from [a-z0-9]', ...);           // 1000 IDs match RANDOM_ID_PATTERN, all distinct
it('uses every character of the alphabet', ...);              // over 2000 IDs, 36 distinct characters
```

- [ ] **Step 2: Run `bun run test --project @overly/server`.** Expected: FAIL.
- [ ] **Step 3: Implement. Refactor `JsonDocument` onto the writer** without changing its behavior.
- [ ] **Step 4: Run the server tests.** Expected: PASS, including every existing `json-document` test.
- [ ] **Step 5: Commit** "Extract the serialized writer and add random IDs".

---

### Task 5: Plugin loader

**Files:**
- Create: `apps/server/src/plugins/loader.ts`, `apps/server/src/plugins/loader.test.ts`, `apps/server/src/testing/plugins.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `MANIFEST_FILE = 'overly.plugin.json'`
  - `type LoadedPlugin = { status: 'ok'; dir: string; manifest: PluginManifest } | { status: 'broken'; dir: string; id?: string; name?: string; version?: string; errors: string[] }`
  - `loadPlugin(dir: string): Promise<LoadedPlugin>`, in this order:
    1. read the file
    2. JSON parse: `overly.plugin.json is not valid JSON: <message>`
    3. `ManifestHeaderSchema` (its issues)
    4. `apiVersion` not in `SUPPORTED_API_VERSIONS`, as a single error: `This plugin needs a newer version of Overly (plugin API <n>).` when `n` is above the highest supported version, otherwise `This plugin was made for an older version of Overly (plugin API <n>).`
    5. `PluginManifestSchema`: issues as `<path>: <message>`
    6. `checkManifestRules`
    7. `resolvePluginFile` for every icon, overlay entry and `backend`: `<field>: file not found` or `<field>: points outside the plugin folder`
  - `resolvePluginFile(dir: string, relPath: string): Promise<string | undefined>`: `realpath` of both the plugin folder and the target; returns the path only when the target is a file inside the folder.
  - Testing helpers:
    - `writeTestPlugin(root: string, folder: string, manifest: unknown, files?: Record<string, string>): Promise<string>`: writes the manifest and the files (the defaults include `overlay/index.html` and `icons/icon.svg`)
    - `fixtureManifest(overrides?: Partial<PluginManifest>): PluginManifest`: plugin `fixture.widgets`, version `1.0.0`, widget type `counter` with settings `{ label: string = 'Count', step: integer 1–10 = 1 }`, an overlay `overlay/index.html` (800 × 600), actions `bump` (queued, params `{ by: integer, required }`, sample `{ by: 1 }`) and `ping` (not queued, no params), and event `counter.changed` (payload `{ value: integer }`).

- [ ] **Step 1: Write the failing tests**

```ts
it('loads a valid plugin', ...);
it('reports invalid JSON', ...);
it('reports an unsupported apiVersion as a single error', async () => {
  const plugin = await loadPlugin(await writeTestPlugin(root, 'p', { ...fixtureManifest(), apiVersion: 2, unknown: true }));
  expect(plugin).toMatchObject({ status: 'broken', id: 'fixture.widgets', errors: ['This plugin needs a newer version of Overly (plugin API 2).'] });
});
it('reports schema issues with their path', ...);
it('reports a missing overlay entry and a missing backend file', ...);
it.skipIf(process.platform === 'win32')('refuses an icon symlinked from outside the folder', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Load and validate plugin manifests".

---

### Task 6: Plugin registry

**Files:**
- Create: `apps/server/src/plugins/registry.ts`, `apps/server/src/plugins/registry.test.ts`

**Interfaces:**
- Consumes: Task 5; `schemaToZod`, `settingsDefaults`, `publicPaths`, `isPublicPath`, `widgetTypeRef`.
- Produces:
  - `interface CompiledAction { decl: ActionDecl; params: z.ZodType<Record<string, unknown>>; output: z.ZodType<Record<string, unknown>> | undefined }`
  - `interface WidgetTypeDef`:
    - `ref: string`; `pluginId: string`; `pluginDir: string`; `manifest: PluginManifest`; `decl: WidgetTypeDecl`
    - `settings: z.ZodType<Record<string, unknown>>`; `defaults(): Record<string, unknown>`
    - `actions: ReadonlyMap<string, CompiledAction>`; `events: ReadonlyMap<string, z.ZodType<Record<string, unknown>>>`
    - `iconPath: string | undefined`: the widget icon, else the plugin icon
  - `interface PluginEntry { dir: string; id: string | undefined; name: string; version: string | undefined; status: 'ok' | 'broken'; manifest: PluginManifest | undefined; errors: string[] }`
  - `class PluginRegistry`:
    - `static load(options: { pluginsDir: string; logger: pino.Logger }): Promise<PluginRegistry>`: folders are read in sorted order. A later folder with an ID already taken is broken with `Another plugin folder (<folder>) already uses the ID <id>.` A missing `pluginsDir` gives an empty registry and a warning.
    - `plugins(): readonly PluginEntry[]`, `plugin(id: string): PluginEntry | undefined`
    - `widgetTypes(): readonly WidgetTypeDef[]`, `widgetType(ref: string): WidgetTypeDef | undefined`: only types of ok plugins
    - `markBroken(pluginId: string, error: string): void`: the plugin becomes broken and its types disappear
    - `publicFile(pluginId: string, relPath: string): Promise<string | undefined>`: rejects anything `RelativePathSchema` rejects (backslashes included), anything outside `publicPaths`, and dot-files; then `resolvePluginFile`

- [ ] **Step 1: Write the failing tests**

```ts
it('loads ok and broken plugins side by side', ...);         // broken one listed with errors, its types absent
it('marks a duplicate plugin ID as broken', ...);
it('returns an empty registry when the folder is missing', ...);
it('compiles settings, defaults, params and event schemas', ...); // widgetType('fixture.widgets:counter').defaults() → { label: 'Count', step: 1 }
it('markBroken removes the plugin types', ...);
it('publicFile refuses paths outside the public set', async () => {   // Review Focus 1
  for (const path of ['overly.plugin.json', 'overlay/../overly.plugin.json', 'overlay\\..\\overly.plugin.json', 'overlay/.secret', 'src/backend.ts']) {
    expect(await registry.publicFile('fixture.widgets', path)).toBeUndefined();
  }
  expect(await registry.publicFile('fixture.widgets', 'overlay/index.html')).toMatch(/index\.html$/);
  expect(await registry.publicFile('fixture.widgets', 'icons/icon.svg')).toBeDefined();
});
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the plugin registry".

---

### Task 7: Widget store

**Files:**
- Create: `apps/server/src/widgets/store.ts`, `apps/server/src/widgets/store.test.ts`

**Interfaces:**
- Consumes: `SerializedWriter` (Task 4), `WidgetDocumentSchema` (Task 3).
- Produces:
  - `type StoredWidget = { kind: 'document'; doc: WidgetDocument } | { kind: 'unreadable'; id: string; code: 'unreadable' | 'unsupported_version'; reason: string }`
  - `class WidgetStore`:
    - `static open(options: { dir: string; logger: pino.Logger; now?: () => Date }): Promise<WidgetStore>`: creates the directory. It reads only files named `^[a-z0-9]{12}\.json$` and ignores the rest. Nothing is written at load.
    - `list(): readonly StoredWidget[]`, `get(id: string): StoredWidget | undefined`
    - `create(doc: WidgetDocument): Promise<void>`
    - `update(id: string, fn: (doc: WidgetDocument) => WidgetDocument): Promise<WidgetDocument>`: sets `updatedAt` from `now()`, validates, then writes
    - `delete(id: string): Promise<void>`: waits for that widget's pending write, then removes the file; works on unreadable entries too
    - `flush(): Promise<void>`
  - Unreadable cases: invalid JSON, a schema failure, or an `id` different from the file name (code `unreadable`); a `schemaVersion` above 1 (code `unsupported_version`).

- [ ] **Step 1: Write the failing tests**

```ts
it('creates a file with two-space JSON and a final newline, and reloads it', ...);
it('update sets updatedAt and coalesces writes', ...);
it('keeps an unreadable file as it is', ...);                 // bytes unchanged after open + flush; entry kind 'unreadable'
it('marks a newer schemaVersion as unsupported_version', ...);
it('treats an ID that differs from the file name as unreadable', ...);
it('ignores temp and backup files', ...);                     // abcdefghij12.json.x.tmp, notes.txt
it('deletes documents and unreadable files', ...);
it('leaves no file when deleting right after an update', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Store widgets as one JSON document each".

---

### Task 8: Action queue

**Files:**
- Create: `apps/server/src/widgets/queue.ts`, `apps/server/src/widgets/queue.test.ts`

**Interfaces:**
- Produces:
  - `class QueueFullError extends Error`
  - `type QueueOutcome<T> = { status: 'completed'; value: T } | { status: 'failed'; error: unknown } | { status: 'cancelled' }`
  - `class ActionQueue`:
    - `constructor(options: { maxLength: number; onChange?: (snapshot: { pending: number; running: string | null }) => void })`
    - `push<T>(item: { name: string; priority: number; run: () => Promise<T> }): Promise<QueueOutcome<T>>`: throws `QueueFullError` synchronously when `pending >= maxLength` (the running item doesn't count)
    - `cancelAll(): void`; `get pending(): number`; `get running(): string | null`
    - Items run one at a time, by priority (highest first), then by arrival. `run` rejecting gives `failed`, and the next item starts. Timeouts are the caller's job.

- [ ] **Step 1: Write the failing tests**

```ts
it('runs one item at a time', ...);
it('orders waiting items by priority, then arrival', ...);   // while A runs: push low(0), high(5), mid(1), high2(5) → high, high2, mid, low
it('rejects a push beyond maxLength pending items', ...);   // maxLength 2: running + 2 pending ok, third throws QueueFullError
it('moves on after a failure', ...);
it('cancels pending items but lets the running one finish', ...);
it('reports pending and running on every change', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the per-widget action queue".

---

### Task 9: Overlay hub

**Files:**
- Create: `apps/server/src/widgets/overlay-hub.ts`, `apps/server/src/widgets/overlay-hub.test.ts`

**Interfaces:**
- Consumes: overlay protocol schemas (Task 3), `randomId` (Task 4).
- Produces:
  - `interface OverlaySocket { send(data: string): void; close(code: number, reason: string): void }`
  - `interface OverlayConnection { readonly id: string; readonly widgetId: string; readonly preview: boolean }`
  - `type OverlayOutcome = { delivered: true; result: unknown } | { delivered: false }`
  - `class OverlayActionError extends Error`: the message is `timeout` or the overlay's error.
  - `class OverlayHub`:
    - `constructor(options: { logger: pino.Logger; onCountsChange?: (widgetId: string, counts: { live: number; preview: number }) => void })`
    - connections: `attach(widgetId: string, socket: OverlaySocket, preview: boolean): OverlayConnection`, `detach(connectionId: string): void`
    - messages: `handleMessage(connectionId: string, raw: string): void` (parsed with `OverlayClientMessageSchema`; invalid input is logged at debug level and ignored); `send(widgetId: string, message: OverlayServerMessage, connectionId?: string): void`
    - `runAction(widgetId: string, name: string, params: unknown, timeoutMs: number): Promise<OverlayOutcome>`: the spec's rules. One delivery ID goes to every target. A failure counts only when every target has failed or detached.
    - `counts(widgetId: string): { live: number; preview: number }`
    - closing: `closeWidget(widgetId: string, code: number, reason: string): void`, `closeAll(code: number, reason: string): void`

- [ ] **Step 1: Write the failing tests** (fake sockets record sent JSON)

```ts
it('resolves undelivered at once when no overlay is connected', ...);
it('sends the action to live and preview overlays with one delivery ID', ...);
it('resolves with the first actionDone and ignores later answers', ...);
it('succeeds when one overlay fails and another finishes', ...);
it('fails with the first error when every overlay fails', ...);
it('resolves undelivered when every overlay disconnects', ...);
it('fails with timeout', ...);                                   // vi.useFakeTimers, advance timeoutMs
it('ignores invalid and unknown client messages', ...);
it('a reconnected overlay receives the next action', async () => { // Review Focus 5
  // attach A; first = runAction(...); detach A → first resolves { delivered: false };
  // attach B; second = runAction(...) → B received it; B answers actionDone → second delivered
});
it('reports live and preview counts', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the overlay hub".

---

### Task 10: SDK backend side

**Files:**
- Create: `packages/sdk/src/backend/{define,runtime,index}.ts`, `packages/sdk/src/backend/runtime.test.ts`
- Modify: `packages/sdk/package.json` (exports `"./backend": "./src/backend/index.ts"`; keep `"."`), `packages/sdk/src/index.ts` (re-export the backend types)

**Interfaces:**
- Consumes: backend protocol schemas and `ChannelEnd` (Task 3).
- Produces:
  - `type OverlayActionOutcome = { delivered: true; result: unknown } | { delivered: false }`
  - `interface BackendLogger { debug|info|warn|error(msg: string, data?: Record<string, unknown>): void }`
  - `interface WidgetContext<S, St>`:
    - `readonly widget: { id: string; name: string; type: string }`; `readonly settings: S`; `readonly state: St`; `setState(next: St): void`
    - `emitToOverlay(name: string, payload?: unknown): void`
    - `runOverlayAction(name: string, params?: unknown, options?: { timeoutMs?: number }): Promise<OverlayActionOutcome>`
    - `emitEvent(name: string, payload?: unknown): void`
    - `readonly log: BackendLogger`; `readonly platform: Readonly<Record<string, never>>`
  - `interface OverlayHandle { readonly id: string; readonly preview: boolean; emit(name: string, payload?: unknown): void }`
  - `interface WidgetBackend<S, St>`:
    - `initialState?: St`
    - lifecycle: `onStart?(ctx)`, `onSettings?(ctx, previous: S)`, `onOverlayConnect?(ctx, overlay: OverlayHandle)`, `onStop?(ctx)`
    - `actions?: Record<string, (params: Record<string, unknown>, ctx: WidgetContext<S, St>, info: { actionId: string }) => unknown>`
    - `migrateSettings?(settings: Record<string, unknown>, info: { from: string; to: string }): Record<string, unknown>`
  - Definitions:
    - `defineWidgetBackend<S = Record<string, unknown>, St = null>(backend: WidgetBackend<S, St>): AnyWidgetBackend`, where `AnyWidgetBackend` is the type-erased form; cast once inside, with a comment explaining why
    - `definePluginBackend(definition: { widgets: Record<string, AnyWidgetBackend> }): PluginBackendDefinition`
  - `runPluginBackend(definition: PluginBackendDefinition, channel: ChannelEnd): { close(): void }`:
    - sends `ready` first
    - parses incoming messages with `HostToBackendMessageSchema` (invalid ones are dropped and logged through the `log` message)
    - keeps one context per started widget
    - action handlers get a per-call context whose `runOverlayAction` sends the `callId`
    - a throw or rejection becomes `actionResult { ok: false, error: message }`
    - an action for a widget that isn't started fails with `widget <id> is not started`

- [ ] **Step 1: Write the failing tests** (a fake `ChannelEnd` records `send` and exposes `deliver(message)`)

```ts
it('announces the handled actions of each widget type', ...);       // ready { widgets: { banner: { actions: ['show','hide'], migrates: false } } }
it('runs an action with params, settings and the initial state', ...);
it('reports a thrown error as a failed actionResult', ...);
it('updates state and tells the host', ...);
it('sends emitToOverlay and emitEvent', ...);
it('resolves runOverlayAction from overlayActionResult and tags the callId', ...);
it('lets onOverlayConnect emit to that overlay only', ...);         // emitToOverlay with overlayId
it('applies new settings and calls onSettings with the previous ones', ...);
it('answers migrate with migrateResult', ...);
it('calls onStop and forgets the widget on stop', ...);
it('fails actions for a widget that is not started', ...);
```

- [ ] **Step 2: Run `bun run test --project @overly/sdk`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the SDK tests and `bun run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the SDK backend runtime".

---

### Task 11: In-process channel and backend host

**Files:**
- Create: `apps/server/src/widgets/{in-process-channel,backend-host}.ts` with tests
- Modify: `apps/server/package.json` (add `@overly/sdk: workspace:*`), `apps/server/tsconfig.json` (reference `../../packages/sdk`)

**Interfaces:**
- Consumes: Tasks 3, 6 and 10.
- Produces:
  - `createInProcessChannel(): [host: ChannelEnd, backend: ChannelEnd]`: `send` does `JSON.parse(JSON.stringify(message))` on the sending side (so non-JSON throws there) and delivers in a microtask, in order. Sends after `close()` are dropped.
  - `interface BackendDelegate`, the server's handlers for what backends send:
    - `setState(widgetId: string, state: JsonValue): void`
    - `emitToOverlay(widgetId: string, name: string, payload: unknown, overlayId?: string): void`
    - `overlayAction(widgetId: string, request: { name: string; params: unknown; timeoutMs: number | undefined; actionId: string | undefined }): Promise<OverlayOutcome>`
    - `emitEvent(widgetId: string, name: string, payload: unknown): void`
  - `class PluginBackendConnection`, one per plugin:
    - `handles(widgetType: string, action: string): boolean`, `migrates(widgetType: string): boolean`
    - widget lifecycle: `startWidget(start: { widgetId; widgetType; widget: { id; name }; settings; state }): void`, `updateSettings(widgetId, settings): void`, `overlayConnected(widgetId, overlayId, preview): void`, `stopWidget(widgetId): void`
    - `runAction(widgetId: string, call: { actionId: string; name: string; params: unknown; timeoutMs: number }): Promise<unknown>`: rejects with the backend's error, or with `timeout`. `callId` maps back to `actionId` for `overlayAction`, and the time left becomes its default `timeoutMs`.
    - `migrate(widgetType: string, settings: Record<string, unknown>, from: string, to: string): Promise<Record<string, unknown>>`
    - `close(): Promise<void>`: `stop` for each widget, a 1 s grace period, then the channel closes
  - `class BackendHost`:
    - `static start(options: { registry: PluginRegistry; builtins: Readonly<Record<string, PluginBackendDefinition>>; delegate: BackendDelegate; logger: pino.Logger; readyTimeoutMs?: number }): Promise<BackendHost>`
    - Every ok plugin with a `backend` gets a connection: `createInProcessChannel` + `runPluginBackend(builtins[id], backendEnd)`, then a wait for `ready`, which is validated against the manifest.
    - Any of these marks the plugin broken through `registry.markBroken`: no builtin (`backend not available`), a ready timeout (`backend did not start within 5 s`), an unknown type or action in `ready`, or an action with no handler on a type without an overlay.
    - `connection(pluginId: string): PluginBackendConnection | undefined`, `close(): Promise<void>`
    - Backend messages are parsed with `BackendToHostMessageSchema`. Invalid ones are warned and dropped, and so is a `setState` over `MAX_STATE_BYTES`. `log` messages go to pino with `{ pluginId, widgetId }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('channel delivers JSON copies in order and throws on non-JSON', ...);   // Date → ISO string; BigInt → throws on send
it('starts a builtin backend and learns what it handles', ...);
it('runs an action and returns its result', ...);
it('rejects with the backend error', ...);
it('rejects with timeout when a handler never settles', ...);
it('forwards setState, emitToOverlay, overlayAction and emitEvent to the delegate', ...);
it('passes the actionId with overlayAction sent while handling an action', ...);
it('drops invalid messages and oversized state', ...);           // raw backend end sends { type: 'nope' }; state of 1.1 MB
it('marks a plugin without a builtin backend as broken', ...);
it('marks a plugin broken when ready times out', ...);
it('marks a plugin broken when ready lists an unknown action', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Install and implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Host plugin backends behind the message protocol".

---

### Task 12: Event bus and widget service

**Files:**
- Create: `apps/server/src/events/bus.ts`, `apps/server/src/widgets/service.ts`, `apps/server/src/testing/services.ts`, tests
- Modify: `apps/server/package.json` (add `semver` 7.8.5, `@types/semver` 7.8.0)

**Interfaces:**
- Consumes: Tasks 6, 7, 9 and 11.
- Produces:
  - `interface WidgetEvent { source: 'widget'; widgetId: string; widgetType: string; name: string; payload: Record<string, unknown>; at: string }`
  - `class EventBus { publish(event: WidgetEvent): void; subscribe(listener: (event: WidgetEvent) => void): () => void }`
  - `class WidgetServiceError extends Error { constructor(readonly status: number, readonly code: ApiErrorCode, message?: string, readonly issues?: { path: string; message: string }[]) }`
  - `class WidgetService`:
    - Opening:
      - `static open(options: { store; registry; overlays: OverlayHub; events: EventBus; builtins: Readonly<Record<string, PluginBackendDefinition>>; notify: (message: ServerMessage) => void; overlayBaseUrl: () => string; logger; now?: () => Date }): Promise<WidgetService>`
      - It starts the `BackendHost` with itself as the `BackendDelegate`, runs the settings migrations and computes each widget's status, then starts the backends of active widgets.
    - Reading:
      - `list(): WidgetSummary[]`, sorted by name, case-insensitively
      - `detail(id: string): WidgetDetail`; `overlayUrl` is `${overlayBaseUrl()}/o/${id}`, or `null` when the type has no overlay
      - `typeOf(id): WidgetTypeDef | undefined`, `isActive(id): boolean`
    - Changing: `create(body: CreateWidgetBody)`, `update(id, body: UpdateWidgetBody)` and `duplicate(id)` all return `Promise<WidgetDetail>`; `delete(id): Promise<void>`.
    - Overlays: `overlayAttached(connection: OverlayConnection): void` sends `init`, then tells the backend `overlayConnected`.
    - `runtime(id): WidgetRuntime`; `shutdown(): Promise<void>`.
    - Errors are `WidgetServiceError`s with the spec's codes and statuses: 404 `widget_not_found` and `widget_type_not_found`, 400 `invalid_settings`, 409 `widget_broken`.
  - Behaviors to pin:
    - the unique default name
    - `update` with settings re-validates, clears `settings_invalid`, sends `settings` to the overlays and `updateSettings` to the backend; a name change or an active change sends a `widget` message
    - disabling stops the backend and makes overlays inactive; enabling starts the backend
    - `duplicate` follows the spec
    - `delete` calls `closeWidget(id, 4404, 'widget deleted')`
    - migrations follow the spec, with `semver.lt` / `semver.gt`
    - every change sends `widgets.changed`
    - `emitEvent` from a backend is parsed with the event schema and published on the bus; unknown or invalid events are logged and dropped
    - `setState` is saved to the document
  - `testing/services.ts`: `createTestServices(options?: { manifest?; builtins?; files? }): Promise<{ service; registry; store; overlays; events; messages: ServerMessage[]; dataDir: string; pluginsDir: string }>`, built from a temp folder with the fixture plugin.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates a widget with defaults and a unique name', ...);     // 'Counter', then 'Counter 2'
it('rejects an unknown widget type', ...);                        // 404 widget_type_not_found
it('rejects invalid settings with issues and keeps the file', ...);
it('sends new settings to overlays and the backend', ...);
it('stops the backend and deactivates overlays when disabled', ...);
it('duplicates without state', ...);                              // name 'X (copy)', state null
it('deletes the file and closes overlays with 4404', ...);
it.each([['plugin_missing'], ['plugin_broken'], ['type_missing'], ['settings_invalid'], ['unreadable'], ['unsupported_version']])
  ('reports %s', ...);
it('migrates settings from an older plugin version and saves the new version', ...);   // fixture builtin migrateSettings renames 'title' → 'label'
it('leaves widgets from a newer plugin version broken and untouched', ...);           // update → 409 widget_broken, bytes unchanged
it('publishes valid widget events and drops invalid ones', ...);
it('saves backend state', ...);
it('logs a failing onStart and keeps the widget ok', ...);
it('broadcasts widgets.changed', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Install and implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the widget service and event bus".

---

### Task 13: Running actions

**Files:**
- Create: `apps/server/src/widgets/action-runner.ts`, `apps/server/src/widgets/action-runner.test.ts`
- Modify: `apps/server/src/widgets/service.ts` (adds `runAction`, keeps one `ActionQueue` per widget, cancels on disable, delete and shutdown)

**Interfaces:**
- Consumes: Tasks 8, 9, 11 and 12.
- Produces:
  - `WidgetService.runAction(id: string, action: string, body: RunActionBody): Promise<RunActionResponse>`:
    1. checks, in order: `widget_not_found` 404, `widget_broken` 409, `widget_disabled` 409, `action_not_found` 404, then `invalid_params` 400 with issues
    2. `actionId = randomId()`
    3. a queued action is pushed onto the queue (`QueueFullError` → 429 `queue_full`); any other action starts at once
    4. answers `{ actionId, status }` without waiting for the action to finish
  - `executeAction(input: { typeDef: WidgetTypeDef; widgetId: string; action: CompiledAction; params: Record<string, unknown>; actionId: string; connection: PluginBackendConnection | undefined; overlays: OverlayHub; warn: (warning: ActionWarning) => void }): Promise<unknown>`:
    - routes to the backend when `connection?.handles(type, name)`, otherwise to `overlays.runAction`, and adds `no_overlay` when the result isn't delivered
    - bounds everything by `decl.timeoutMs`
    - validates the result with `output` when it is declared (`invalid_output`)
  - Backend `overlayAction` requests that carry an `actionId` add `no_overlay` to that action's warnings.
  - `widget.action` messages go out at `queued` (queued actions only), `running`, then `done` (with warnings), `failed` (with an error) or `cancelled`. `widget.runtime` goes out on every queue change and every overlay count change.

- [ ] **Step 1: Write the failing tests** (using `createTestServices` and fake overlay sockets)

```ts
it('runs queued actions one after another', async () => {
  // three bump actions; the socket sees the second action only after it answers actionDone for the first
});
it('runs non-queued actions at once', ...);
it('fills param defaults and rejects invalid params with issues', ...);
it.each([['widget_disabled', 409], ['widget_broken', 409], ['action_not_found', 404]])('answers %s', ...);
it('answers 429 queue_full', ...);                                  // fixture queue.maxLength 1
it('finishes with the no_overlay warning when nothing is connected', ...);
it('routes to the backend when it handles the action', ...);
it('attaches no_overlay to a backend action whose overlay action was not delivered', ...);
it('fails an action whose result breaks the output schema', ...);
it('fails with timeout and starts the next action', ...);
it('cancels pending actions when the widget is disabled', ...);
it('broadcasts queued, running, done and runtime messages in order', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Queue and run widget actions".

---

### Task 14: Plugin and widget HTTP routes

**Files:**
- Create: `apps/server/src/http/widget-routes.ts`, `apps/server/src/http/widget-routes.test.ts`
- Modify: `apps/server/src/ws/hub.ts` (`broadcast(message: ServerMessage): void`), `apps/server/src/http/app.ts` (`AppDeps` gains `widgets: WidgetService`, `registry: PluginRegistry`), `apps/server/src/testing/app.ts` (`buildTestApp` uses `createTestServices` unless overridden)

**Interfaces:**
- Consumes: Task 12–13 service; API schemas (Task 3).
- Produces:
  - `registerWidgetRoutes(app, { widgets: WidgetService; registry: PluginRegistry }): void`. It serves the spec's `/api/plugins` and `/api/widgets…` routes:
    - bodies are parsed with the shared schemas; a failure is `400 { error: 'invalid_body', issues }`
    - a `WidgetServiceError` becomes `{ error: code, message?, issues? }` with its status
  - `iconUrl` is `/plugins/<pluginId>/<iconPath>`, or `null`.
  - `PluginInfo.widgetTypes` comes from the manifest (`settings`, `actions` with `params`, `sample` and `queued`, `events`). `overlay` is `{ width, height }` or `null`.

- [ ] **Step 1: Write the failing tests** (`inject()` with the session cookie and `origin: TEST_ORIGIN` on writes)

```ts
it('lists ok and broken plugins with errors and widget types', ...);
it('creates, reads, updates, duplicates and deletes a widget', ...);   // 201, 200, 200, 201, 204, then 404
it('answers 400 invalid_body with issues', ...);
it('runs an action with 202 and an actionId', ...);
it('requires the session and an allowed Origin', ...);                 // 401 without cookie, 403 without origin on POST/PATCH/DELETE
it('builds overlayUrl from the server port', ...);                     // host 'localhost:6859' → 'http://127.0.0.1:6859/o/<id>'
it('broadcasts widget messages to dashboard sockets', ...);            // real socket on port 0: create → widgets.changed
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS (Phase 1 tests too).
- [ ] **Step 5: Commit** "Add plugin and widget API routes".

---

### Task 15: Asset store and routes

**Files:**
- Create: `apps/server/src/assets/store.ts`, `apps/server/src/http/asset-routes.ts`, `apps/server/src/http/static.ts`, tests
- Modify: `apps/server/src/http/dashboard.ts` (use the shared static setup), `apps/server/src/http/app.ts` (`AppDeps.assets`)

**Interfaces:**
- Consumes: asset schemas (Task 3), `JsonDocument`, `randomId`.
- Produces:
  - `registerStatic(app: FastifyInstance, root: string): Promise<void>`: registers `@fastify/static` once with `serve: false`, for `reply.sendFile(file, root)`. Every `sendFile` call passes its root. The dashboard's own instance uses `decorateReply: false`.
  - `class AssetError extends Error { constructor(readonly status: 413 | 415 | 400, readonly code: 'asset_too_large' | 'unsupported_asset_type' | 'invalid_body') }`
  - `class AssetStore`:
    - `static open(options: { dir: string; logger; maxBytes?: number; now?: () => Date }): Promise<AssetStore>`: `maxBytes` defaults to `MAX_ASSET_BYTES`
    - reading: `list(kinds?: readonly AssetKind[]): Asset[]` (newest first), `get(id): Asset | undefined`, `fileName(asset): string` (`<id><ext>`)
    - `add(name: string, body: Readable): Promise<{ asset: Asset; created: boolean }>`: the display name is the last segment after `/` or `\`, trimmed, 1–200 characters. The type comes from `assetTypeForName`. The body streams to `<dir>/<random>.upload.tmp` while it is counted and hashed; the temp file is removed on any error.
    - `delete(id): Promise<boolean>`, `flush(): Promise<void>`
  - `registerAssetRoutes(app, { assets: AssetStore }): void`:
    - `POST /api/assets` runs in an encapsulated scope whose content-type parser passes the raw stream through, for any content type
    - `GET /api/assets` with an optional `kind`, repeatable or comma-separated
    - `DELETE /api/assets/:id`
    - `GET /assets/:id`: the spec's headers, served with `sendFile`, so range requests work

- [ ] **Step 1: Write the failing tests**

```ts
it('uploads a PNG and serves it without a session', ...);    // 201; GET /assets/<id> 200 image/png, Cache-Control 'public, max-age=31536000, immutable', ACAO '*', CSP exact
it('returns the existing asset for identical bytes', ...);   // 200, same id, one file on disk
it('rejects unsupported types with 415 and leaves no file', ...);
it('rejects files over the limit with 413 and leaves no temp file', ...);   // maxBytes 1024
it('stores odd file names safely', async () => {             // Review Focus 2
  // name '..\\..\\Mon son É.MP3' → 201, kind 'audio', mime 'audio/mpeg', name 'Mon son É.MP3',
  // readdir(assetsDir) contains exactly `${id}.mp3` and index.json
});
it('lists assets by kind, newest first', ...);
it('deletes an asset and its file', ...);
it('answers a range request with 206', ...);                 // Range: bytes=0-3
it('requires the session and Origin for uploads', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the asset library".

---

### Task 16: Overlay serving, overlay socket and Content-Security-Policy

**Files:**
- Create: `apps/server/src/http/{overlay-routes,csp}.ts`, `apps/server/src/ws/overlay-socket.ts`, tests
- Modify: `apps/server/src/security/{allowlist,guard}.ts`, `apps/server/src/http/dashboard.ts` (CSP header on HTML; `RESERVED_PREFIXES` adds `/plugins/` and `/sdk/`), `apps/server/src/http/app.ts` (`AppDeps.overlaySdkPath: string | undefined`, `overlays: OverlayHub`)

**Interfaces:**
- Consumes: Tasks 6, 9, 12 and 15.
- Produces:
  - `injectOverlayHead(html: string, baseHref: string): string`: inserts `<base href="…"><script src="/sdk/overlay.js"></script>` after the first `<head(\s[^>]*)?>` (case-insensitive), or at the start when there is none
  - `dashboardCsp(host: string): string`, `overlayCsp(frameAncestors: readonly string[]): string`: exact strings from the Global Constraints
  - `Allowlist.allowedOrigins(): string[]` (for `frame-ancestors`)
  - `isOverlaySocketPath(path: string): boolean` (`/^\/o\/[a-z0-9]{12}\/ws$/`)
  - The guard accepts `Origin: null` only when `isUpgrade && isOverlaySocketPath(path)`.
  - `registerOverlayRoutes(app, { widgets: WidgetService; registry: PluginRegistry; overlaySdkPath: string | undefined; allowlist: Allowlist }): void`: `/o/:widgetId`, `/plugins/:pluginId/*` (`registry.publicFile`; `Access-Control-Allow-Origin: *`, `Cache-Control: no-cache`) and `/sdk/overlay.js`.
  - `registerOverlaySocket(app, { widgets: WidgetService; overlays: OverlayHub }): void`:
    - `/o/:widgetId/ws` closes with 4404 for an unknown widget
    - otherwise it calls `attach` with the preview flag from `?preview=1`, then `widgets.overlayAttached`
    - messages go to `handleMessage`; a close detaches

- [ ] **Step 1: Write the failing tests**

```ts
it.each([['<head>', ...], ['<HEAD lang="en">', ...], ['no head at all', ...]])('injects the base and SDK into %s', ...);
it('does not mistake <header> for <head>', ...);
it('serves the overlay page with the sandbox CSP and no-store', ...);   // exact CSP string with 127.0.0.1:6859 and localhost:6859
it('answers 404 for an unknown widget, a type without overlay, and a broken plugin', ...);
it('serves public plugin files with CORS and refuses the manifest', ...);
it('does not serve encoded traversal', async () => {                     // Review Focus 1
  for (const url of ['/plugins/fixture.widgets/overlay/%2e%2e/overly.plugin.json', '/plugins/fixture.widgets/overlay/..%2foverly.plugin.json', '/plugins/fixture.widgets/overlay/%5c..%5coverly.plugin.json'])
    expect((await get(url)).statusCode).toBe(404);
});
it('serves the SDK, or 404 with a hint when it is missing', ...);
it('adds the CSP to dashboard pages', ...);                              // dashboardDir fixture with index.html; connect-src contains ws://127.0.0.1:6859
it('does not fall back to the dashboard for /plugins and /sdk', ...);
// real sockets on port 0:
it('sends init to an overlay socket from Origin null', ...);
it('still rejects Origin null on /ws', ...);
it('closes the socket with 4404 for an unknown widget', ...);
it('runs an action end to end through an overlay socket', ...);         // POST action → socket gets action → actionDone → dashboard socket gets done
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Serve sandboxed overlays, plugin files and the SDK".

---

### Task 17: SDK overlay side

**Files:**
- Create: `packages/sdk/src/overlay/{sdk,global,index}.ts`, `packages/sdk/src/overlay/global.d.ts`, `packages/sdk/src/overlay/sdk.test.ts` (with `// @vitest-environment jsdom`)
- Modify: `packages/sdk/package.json`:
  - exports `"./overlay": "./src/overlay/index.ts"` and `"./overlay-global": { "types": "./src/overlay/global.d.ts" }`
  - scripts `build` (`bun build src/overlay/global.ts --target=browser --format=iife --outfile=dist/browser/overlay.js`) and `dev` (the same with `--watch`)
  - devDependency `jsdom` 30.1.2

**Interfaces:**
- Consumes: overlay protocol (Task 3), `reconnectDelay`.
- Produces:
  - `interface OverlayEnv { window: Window; WebSocket: new (url: string) => WebSocket; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }`
  - `interface OverlaySdk`: exactly as in the spec, section 4.
  - `createOverlaySdk(env: OverlayEnv): OverlaySdk`:
    - derives the widget ID from `/o/<id>`, `isPreview` from `preview=1`, and `muted` from `isPreview && muted !== '0'`
    - connects at `DOMContentLoaded`, or at once when the document is already loaded, to `ws(s)://<host>/o/<id>/ws` plus `?preview=1`
    - implements the spec's behaviors: settings, actions, no handler, active hiding, 4404, reconnect, mute patch, draft settings
  - `global.ts`: `window.overly = createOverlaySdk({ window, WebSocket, setTimeout, clearTimeout })`.
  - `global.d.ts`: `declare global { var overly: OverlaySdk }` (it imports the type).

- [ ] **Step 1: Write the failing tests** (a fake WebSocket class records instances; `history.replaceState` sets the URL)

```ts
it('reads the widget ID and preview flags from the URL', ...);       // /o/abcdefghij12?preview=1 → isPreview true, muted true; &muted=0 → muted false
it('connects to the overlay socket after DOMContentLoaded', ...);
it('delivers settings from init and from later settings messages', ...);
it('calls onSettings at once when settings already arrived', ...);
it('answers actionDone with the handler result', ...);
it('answers actionFailed when the handler throws', ...);
it('fails an action without a handler', ...);
it('hides the page while inactive', ...);                            // documentElement.style.visibility 'hidden' / ''
it('reconnects with backoff and stops after 4404', ...);             // fake timers: 500, 1000 ms; after 4404 no new socket
it('mutes media in preview', ...);                                   // HTMLMediaElement.prototype.play patched: element.muted true after play()
it('applies draft settings from the parent in preview only', ...);   // MessageEvent with source window.parent; ignored when not preview or another source; null restores server settings
it('builds asset URLs', ...);                                        // '' → '', 'abcdefghij12' → '/assets/abcdefghij12'
```

- [ ] **Step 2: Run the SDK tests.** Expected: FAIL.
- [ ] **Step 3: Implement, then run `bun run --filter @overly/sdk build`** and check that `dist/browser/overlay.js` exists.
- [ ] **Step 4: Run the SDK tests and `bun run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the overlay SDK".

---

### Task 18: Server composition, options, build and dev workflow

**Files:**
- Create: `apps/server/scripts/copy-runtime-files.ts`, `apps/server/src/plugins/builtin.ts` (empty map: `export const BUILTIN_BACKENDS: Readonly<Record<string, PluginBackendDefinition>> = {}`)
- Delete: `apps/server/scripts/copy-dashboard.js`
- Modify:
  - `apps/server/src/{cli,main,server}.ts` and `cli.test.ts`
  - `apps/server/src/main.process.test.ts`
  - `apps/server/package.json` (scripts)
  - root `package.json` (`build`, `dev`)
  - `apps/dashboard/vite.config.ts` (proxy)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `CliOptions` gains `pluginsDir: string | undefined` and `overlaySdk: string | undefined`, from `--plugins-dir` and `--overlay-sdk`.
  - `main.ts` resolves the defaults next to the bundle: `plugins/` and `sdk/overlay.js`.
  - `ServerOptions` gains `pluginsDir: string` and `overlaySdkPath: string`.
  - `startServer` builds, in order: logger, settings, session key, `PluginRegistry`, `WidgetStore`, `AssetStore`, `EventBus`, `OverlayHub`, `WidgetService` (with `BUILTIN_BACKENDS`), app, listen.
  - Shutdown steps, in order: `websockets` (dashboard and overlays, 1001), `widgets` (`service.shutdown()`: cancel the queues, close the backends), `http`, `documents` (settings, widgets, assets), `logger`.
  - Server scripts:
    - `build`: `bun build … && bun scripts/copy-runtime-files.ts`
    - `dev`: add `--plugins-dir ../../plugins --overlay-sdk ../../packages/sdk/dist/browser/overlay.js`
  - `copy-runtime-files.ts` copies three things:
    - the dashboard build, as before
    - for each `plugins/*` folder with a manifest: the manifest, plus every file under `publicPaths` (uses `@overly/shared`), into `dist/sidecar/plugins/<folder>/`
    - `packages/sdk/dist/browser/overlay.js` → `dist/sidecar/sdk/overlay.js`

    It fails with a clear message when the dashboard or SDK build is missing.
  - Root scripts:
    - `build`: dashboard, then `@overly/sdk`, then server
    - `dev`: adds `--filter @overly/sdk`
  - Vite proxy adds `/o` (`ws: true`), `/plugins`, `/sdk` and `/assets`, all with `changeOrigin`.

- [ ] **Step 1: Write the failing tests**

```ts
// cli.test.ts
it('parses --plugins-dir and --overlay-sdk', ...);
// main.process.test.ts (source mode passes --plugins-dir <repo>/plugins and --overlay-sdk <temp file>; bundle mode uses the defaults)
it('serves the overlay SDK and lists plugins', async () => {
  // after ready: GET /sdk/overlay.js → 200; GET /api/plugins with a session cookie → 200 and a plugins array
});
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.**
  - Run `bun run test --project @overly/server`, then `bun run build && bun run test:sidecar`. Expected: PASS.
  - `ls apps/server/dist/sidecar` shows `dashboard plugins sdk server.mjs`.
- [ ] **Step 5: Commit** "Wire plugins, widgets and assets into the sidecar".

---

### Task 19: Text banner plugin

**Files:**
- Create in `plugins/text-banner/`:
  - `package.json` (`@overly/plugin-text-banner`; exports `"./backend": "./src/backend.ts"`; depends on `@overly/sdk`; devDependency `jsdom`)
  - `tsconfig.json`: one per plugin, covering the backend, the overlay and the tests. It sets `rootDir: "."`, `include: ["src", "overlay"]`, lib ES2024 + DOM, `allowJs`, `checkJs` and `types: ["@overly/sdk/overlay-global"]`. If the `types` entry doesn't resolve the subpath export, use `/// <reference types="@overly/sdk/overlay-global" />` at the top of each overlay file instead. Overlay tests live in `src/` (with `// @vitest-environment jsdom`), so nothing but overlay files sits in the public `overlay/` folder.
  - `overly.plugin.json`, `icons/banner.svg`
  - `overlay/index.html`, `overlay/main.js`, `overlay/banner.js`, `overlay/style.css`
  - `src/backend.ts`, `src/backend.test.ts`, `src/overlay.test.ts` (jsdom)
- Modify:
  - root `tsconfig.json` (reference `plugins/text-banner`)
  - `eslint.config.js` (`plugins/*/overlay/**/*.js`: browser globals + `overly: 'readonly'`)
  - `apps/server/package.json`, `apps/server/tsconfig.json` and `apps/server/src/plugins/builtin.ts` (register `overly.text-banner`)
  - `apps/server/src/plugins/registry.test.ts` (`it('loads the built-in plugins without errors')` against the repository's `plugins/`)
  - `main.process.test.ts`: `/api/plugins` includes `overly.text-banner` with status `ok`
  - `plugins/README.md` (folder layout)

**Interfaces:**
- Consumes: SDK backend (Task 10) and overlay types (Task 17).
- Produces:
  - Manifest: exactly as in the spec, section 6.
  - `src/backend.ts`: `export default definePluginBackend({ widgets: { banner: defineWidgetBackend<BannerSettings, BannerState>({...}) } })`, with `BannerState = { visible: boolean; text: string }`.
  - `overlay/banner.js`:
    - `applySettings(root: HTMLElement, settings): void`: CSS custom properties `--banner-font`, `--banner-size`, `--banner-color`, `--banner-bg`, plus `data-position` and `data-animation` attributes
    - `renderBanner(root: HTMLElement, state: { visible: boolean; text: string }): void`: sets the text with `textContent` and toggles a `visible` class
  - `overlay/main.js` wires `overly.onSettings` and `overly.on('banner', …)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('show saves the state and sends it to the overlays', ...);    // runPluginBackend + fake channel: setState { visible: true, text } and emitToOverlay 'banner'
it('hide keeps the text and hides', ...);
it('sends the current state to an overlay that connects', ...);
it('applies settings as CSS variables and attributes', ...);
it('renders text literally', ...);                               // '<b>x</b>' appears as text, no <b> element
it('loads the built-in plugins without errors', ...);            // server registry test
```

- [ ] **Step 2: Run `bun run test --project @overly/plugin-text-banner --project @overly/server`.** Expected: FAIL.
- [ ] **Step 3: Implement, then run `bun install`** (new workspace).
- [ ] **Step 4: Run those tests, `bun run typecheck` and `bun run lint`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the Text banner plugin".

---

### Task 20: Alerts plugin

**Files:**
- Create in `plugins/alerts/`, with the same layout as Task 19:
  - `overly.plugin.json`, `icons/alerts.svg`
  - `overlay/index.html`, `overlay/main.js`, `overlay/alerts.js`, `overlay/style.css`
  - `src/backend.ts` and tests
- Modify: root `tsconfig.json`, `apps/server/{package.json,tsconfig.json,src/plugins/builtin.ts}`, `main.process.test.ts` (`overly.alerts` ok)

**Interfaces:**
- Produces:
  - Manifest: exactly as in the spec, section 6.
  - `src/backend.ts`: the `show-alert` handler calls `ctx.runOverlayAction('show-alert', params)`. When the result is `delivered`, it emits `alert.finished` with `{ title, message, variant }` and returns the overlay result; otherwise it returns `{ delivered: false }`.
  - `overlay/alerts.js`:
    - `renderTemplate(template: string, values: { title: string; message: string; variant: string }): string`: replaces `{{ name }}` (spaces allowed) for these three names only and leaves other placeholders as they are
    - `playAlert(root: HTMLElement, alert, settings, deps: { assetUrl(id: string): string; wait(ms: number): Promise<void> }): Promise<void>`:
      - sets the headline and message with `textContent`, and the image `src` (hidden when empty)
      - plays the sound at `volume / 100`, ignoring a rejected `play()`
      - shows the alert, waits `durationSeconds * 1000`, hides it, then waits 400 ms for the fade-out
  - `overlay/main.js` registers `overly.onAction('show-alert', …)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('renders the known placeholders with or without spaces', ...);   // '{{title}} / {{ message }} / {{variant}} / {{other}}'
it('plays image, text and sound, then hides', ...);                 // fake wait records [6000, 400]; audio.volume 0.8
it('ignores a rejected play()', ...);
it('emits alert.finished after the overlay played it', ...);
it('does not emit alert.finished when no overlay played it', ...);  // Review Focus 5
```

- [ ] **Step 2: Run the plugin and server tests.** Expected: FAIL.
- [ ] **Step 3: Implement, then run `bun install`.**
- [ ] **Step 4: Run the tests, `bun run typecheck` and `bun run lint`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the Alerts plugin".

---

### Task 21: Dashboard data layer and live updates

**Files:**
- Create: `apps/dashboard/src/api/hooks.ts`, `apps/dashboard/src/api/hooks.test.tsx`
- Modify:
  - `apps/dashboard/src/api/client.ts` and its test
  - `apps/dashboard/src/connection/ServerConnection.tsx` and its test
  - `apps/dashboard/src/App.tsx` (`Notifications` provider) and `src/main.tsx` (`@mantine/notifications/styles.css`)
  - `apps/dashboard/package.json` (add `@mantine/form` and `@mantine/notifications` 9.7.2)

**Interfaces:**
- Produces:
  - Client:
    - `ApiError` gains `message?` and `issues?`
    - `apiSend<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown, schema: z.ZodType<T> | undefined): Promise<T | undefined>`: JSON body; a `204` answer is `undefined`
    - `apiUpload(file: File): Promise<Asset>`: `POST /api/assets?name=<encodeURIComponent(file.name)>` with `body: file`
  - Query hooks:
    - `usePlugins()`, `useWidgets()`, `useWidget(id)`, `useAssets(kinds: readonly AssetKind[])`
    - keys `['plugins']`, `['widgets']`, `['widget', id]`, `['assets', kinds.join(',')]`
  - Mutation hooks: `useCreateWidget()`, `useUpdateWidget(id)`, `useDeleteWidget()`, `useDuplicateWidget()`, `useRunAction(id)`, `useUploadAsset()`, `useDeleteAsset()`. Each invalidates the matching keys.
  - `ServerConnectionProvider` uses `useQueryClient()`:
    - `widgets.changed` invalidates `['widgets']` and `['widget', id]`
    - `widget.runtime` patches the `runtime` of the cached `['widget', id]`
    - `widget.action` goes to `useActionUpdates(listener: (message) => void)` subscribers

- [ ] **Step 1: Write the failing tests**

```ts
it('apiSend sends JSON with the method and parses error issues', ...);
it('apiUpload sends the raw file with its encoded name', ...);      // 'Mon son.mp3' → ?name=Mon%20son.mp3
it('invalidates widget queries on widgets.changed', ...);
it('patches the cached runtime on widget.runtime', ...);
it('passes widget.action messages to subscribers', ...);
```

- [ ] **Step 2: Run `bun run test --project @overly/dashboard`.** Expected: FAIL.
- [ ] **Step 3: Install and implement.**
- [ ] **Step 4: Run the dashboard tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the dashboard data layer for plugins, widgets and assets".

---

### Task 22: Asset picker

**Files:**
- Create: `apps/dashboard/src/assets/{AssetField,AssetModal}.tsx`, `apps/dashboard/src/assets/AssetField.test.tsx`

**Interfaces:**
- Consumes: Task 21 hooks; `acceptForKinds`.
- Produces:
  - `AssetField(props: { label: string; description?: string; error?: ReactNode; value: string; onChange: (value: string) => void; accept: readonly AssetKind[]; disabled?: boolean })`
  - `AssetModal(props: { opened: boolean; onClose: () => void; accept: readonly AssetKind[]; onSelect: (asset: Asset) => void })`: assets of the accepted kinds (image thumbnails from `/assets/<id>`), an **Upload** `FileButton` with `accept={acceptForKinds(accept)}` (a successful upload selects the asset), and a delete button per asset with a confirm modal.

- [ ] **Step 1: Write the failing tests** (fetch mocked)

```ts
it('shows the selected asset, or Missing asset for an unknown ID', ...);
it('selects an asset from the modal', ...);
it('uploads a file and selects it', ...);
it('clears the value', ...);                                   // onChange('')
it('deletes an asset after confirmation', ...);
```

- [ ] **Step 2: Run the dashboard tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the dashboard tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the asset picker".

---

### Task 23: Generated settings fields

**Files:**
- Create: `apps/dashboard/src/forms/{SchemaFields.tsx,ArrayField.tsx,validate.ts}`, `apps/dashboard/src/forms/SchemaFields.test.tsx`

**Interfaces:**
- Consumes: `Field`, `ObjectField`, `schemaToZod`, `settingsDefaults`, `formatIssues` (Task 1); `AssetField` (Task 22).
- Produces:
  - `SchemaFields(props: { schema: ObjectField; form: UseFormReturnType<Record<string, unknown>>; path: string; disabled?: boolean })`: renders the spec's field table, with labels from `title ?? key`
  - `validateWithSchema(schema: ObjectField, values: unknown, path: string): Record<string, string>`: Mantine form errors keyed `<path>.<issue path>`
  - `itemDefaults(items: Field): unknown`: the item schema's default, or, for an object, `settingsDefaults` of it

- [ ] **Step 1: Write the failing tests** (a test harness renders `useForm` with `SchemaFields` and a Save button)

```ts
it('renders each field type with its label and description', ...);   // TextInput, Select (enumLabels), Textarea, ColorInput, NumberInput with unit, Slider, Switch, Fieldset, AssetField
it('shows validation errors at the field', ...);                      // integer 0 with minimum 1 → error under the field
it('adds and removes array items with their defaults', ...);
it('disables every input when disabled', ...);
```

- [ ] **Step 2: Run the dashboard tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the dashboard tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Generate settings forms from widget schemas".

---

### Task 24: Widget list, library modal and broken plugins

**Files:**
- Create: `apps/dashboard/src/widgets/{WidgetList,WidgetLibraryModal,BrokenPlugins}.tsx`, tests
- Modify: `apps/dashboard/src/layout/Sidebar.tsx` (Widgets section uses `WidgetList`; Pipelines unchanged), `apps/dashboard/src/pages/HomePage.tsx` (`BrokenPlugins` alert; text "Add a widget with the + button next to Widgets."), `apps/dashboard/src/App.test.tsx` (Add widget is enabled)

**Interfaces:**
- Produces:
  - `WidgetList()`: search, rows, switch (`PATCH { enabled }`), broken badge with tooltip, and the empty state
  - `WidgetLibraryModal(props: { opened: boolean; onClose: () => void })`: cards from `usePlugins()`. Creating a widget navigates to `/widgets/<id>`. Broken plugins are shown through `BrokenPlugins`.
  - `BrokenPlugins()`: an `Alert` listing each broken plugin's name (or folder) and its errors; renders nothing when every plugin is ok

- [ ] **Step 1: Write the failing tests**

```ts
it('lists widgets with icons and filters them by search', ...);
it('toggles a widget from the list', ...);                   // PATCH body { enabled: false }
it('shows a Broken badge with the first problem', ...);
it('shows the empty state', ...);
it('creates a widget from the library and opens its page', ...);
it('filters the library by search', ...);
it('lists broken plugins with their errors', ...);
```

- [ ] **Step 2: Run the dashboard tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the dashboard tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the widget list and the widget library".

---

### Task 25: Widget page

**Files:**
- Create: `apps/dashboard/src/widgets/{WidgetPage,OverlayCard,OverlayPreview,TestActions,SettingsForm}.tsx`, `apps/dashboard/src/widgets/useActionNotifications.ts`, `apps/dashboard/src/widgets/WidgetPage.test.tsx`
- Modify: `apps/dashboard/src/App.tsx` (route `widgets/:widgetId` inside the layout)

**Interfaces:**
- Consumes: Tasks 21–24.
- Produces:
  - `WidgetPage()`: the spec's widget page layout.
    - Query or mutation `404 widget_not_found` → **This widget no longer exists.** with a link to `/`.
    - Delete confirms, then navigates to `/`. Duplicate navigates to the copy.
  - `OverlayCard(props: { widget: WidgetDetail })`: shows `widget.overlayUrl` as is, with `CopyButton`, the size text and the connection status
  - `OverlayPreview(props: { widget: WidgetDetail; draft: Record<string, unknown> | null })`:
    - sandboxed iframe: `src` `/o/<id>?preview=1` (`&muted=0` when unmuted), `sandbox="allow-scripts"`, `allow="autoplay"`, title `Overlay preview`
    - scaled with Mantine `useElementSize`
    - posts `{ source: 'overly-dashboard', type: 'draft-settings', settings: draft }` to `contentWindow` with target `'*'`, debounced 150 ms, and again on the iframe's `load`
    - **Disabled** note when the widget isn't active
  - `TestActions(props: { widget: WidgetDetail; actions: ActionInfo[] })`: one button per action sends `{ params: sample }`; shows the pending count
  - `useActionNotifications()`: tracks the action IDs started in this tab and updates one notification per action with the fixed copy
  - `SettingsForm(props: { widget: WidgetDetail; type: WidgetTypeInfo; readOnly: boolean; onDraft: (draft: Record<string, unknown> | null) => void })`:
    - `useForm({ initialValues: { name, settings }, validate })`
    - **Save** sends `PATCH { name, settings }`, then resets the form to the saved values
    - **Discard changes** calls `form.reset()`
    - the **Unsaved changes** text shows while the form is dirty
    - `beforeunload` while dirty
    - `onDraft(valid && dirty ? settings : null)`

- [ ] **Step 1: Write the failing tests**

```ts
it('shows the overlay URL from the API', async () => {          // Review Focus 3
  // API overlayUrl 'http://127.0.0.1:6860/o/abcdefghij12' while jsdom location is http://localhost:3000
  expect(await screen.findByDisplayValue('http://127.0.0.1:6860/o/abcdefghij12')).toBeInTheDocument();
  expect(screen.getByText('Recommended Browser Source size: 1920 × 1080')).toBeInTheDocument();
});
it('shows the connection status', ...);                         // runtime live 0 → 'Not in OBS yet'; live 2 → '2 overlays connected'
it('renders a sandboxed, muted preview', ...);                  // iframe sandbox 'allow-scripts', src '/o/<id>?preview=1'; Unmute → '&muted=0'
it('posts valid draft settings to the preview', ...);           // spy contentWindow.postMessage after typing, with fake timers 150 ms
it('runs an action with its sample and shows the result', ...); // POST body { params: sample }; widget.action done with no_overlay → the fixed warning text
it('saves and discards settings', ...);                         // Save disabled until dirty; Unsaved changes shown; Discard restores
it('shows problems and makes settings read-only for newer_plugin_version', ...);
it('shows a message when the widget was deleted elsewhere', ...); // Review Focus 4: GET answers 404 widget_not_found
it('deletes after confirmation and returns home', ...);
```

- [ ] **Step 2: Run the dashboard tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the dashboard tests and `bun run lint`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the widget page with preview, tests and settings".

---

### Task 26: Documentation

**Files:**
- Create:
  - `docs/plugins/README.md`
  - `docs/adr/0013-plugin-schema-subset.md`, `docs/adr/0014-overlay-serving-and-isolation.md`, `docs/adr/0015-widget-backend-protocol.md`
- Modify: `docs/adr/README.md` (table), `AGENTS.md`, `README.md`, `ROADMAP.md`

**Content:**
- `docs/plugins/README.md`:
  - folder layout and manifest reference: the field tables from spec section 1
  - schema subset, UI hints and versioning rules
  - overlay SDK: the API table, the opaque-origin rules (no storage, relative URLs, register handlers at load), and how preview and muting work
  - backend SDK: `definePluginBackend`, the context, actions, state, events, `migrateSettings`
  - a link to the JSON Schema
- ADRs, using `docs/adr/template.md` (each with context, decision, alternatives and consequences):
  - 0013: Ajv and RJSF were considered and rejected
  - 0014: the preview-only sandbox and a separate origin on `localhost` were considered and rejected
  - 0015: per-plugin builds loaded with dynamic `import()` were considered and rejected
- `AGENTS.md`:
  - `plugins/<name>` layout
  - "built-in overlays are plain JS with `// @ts-check`, no build step"
  - `bun run generate:schemas` (run it after changing the manifest schema)
  - `--plugins-dir` and `--overlay-sdk`
- `README.md`: a "Widgets" section: add a widget, copy its URL into an OBS Browser Source at the recommended size, press Test.
- `ROADMAP.md`: tick every Phase 2 item. Reword the SDK line to "`overly.onSettings()`, `overly.onAction(name, fn)` (the action is done when `fn` returns or resolves), `overly.on(msg, fn)`, reconnect with backoff, `isPreview`".

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run `bun run lint`.** Expected: PASS (Markdown isn't formatted by Prettier).
- [ ] **Step 3: Commit** "Document the plugin format, overlays and widget backends".

---

### Task 27: Verification and pull request

- [ ] **Step 1: Run `bun install --frozen-lockfile && bun run lint && bun run typecheck && bun run test && bun run build && bun run test:sidecar`.** Expected: all pass.
- [ ] **Step 2: Manual exit criteria with `bun run dev`.** In the in-app browser, open the dashboard URL the server prints, then:
  1. Create an Alerts widget, choose an uploaded image and sound, and save.
  2. Open the copied overlay URL in a second tab, which stands in for OBS. The page shows "1 overlay connected".
  3. Press **Test** three times quickly. The alerts play one after another in the overlay tab and the preview, never on top of each other.
  4. Create a Text banner, **Test: Show**, reload the overlay tab, and check that the banner comes back.
  5. Stop and restart `bun run dev`. The widgets, settings, assets and banner state are still there.

  Check the console for CSP errors in both tabs.
- [ ] **Step 3: Push the branch and open the PR.** The description covers the change summary, how it was verified (the commands and the manual steps above), and a note that the OBS check needs a maintainer with OBS. Then bind the PR and check CI.
