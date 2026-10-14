# Phase 1 Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Tauri tray app starts the Node sidecar, the sidecar serves a secured local dashboard, and Quit stops everything without orphans.

**Architecture:** `apps/server` is a Fastify app composed from small units (storage, config, logging, security, HTTP, WebSocket, JSON-RPC, shutdown) wired in `main.ts`, bundled to `server.mjs` with `bun build`. `apps/desktop` is a Rust lib crate: pure units (protocol, backoff, status, locate) plus a tokio supervisor that owns the sidecar process, and Tauri glue for the tray. `apps/dashboard` is a Vite + React + Mantine SPA gated by the session cookie.

**Tech Stack:** Node 24, Fastify 5, @fastify/{websocket,static,cookie}, pino + pino-roll, Zod 4, tsx, Bun (scripts and bundler); React 19, React Router 8, TanStack Query 5, Mantine 9, Vitest 5 + jsdom + Testing Library; Rust 2024, Tauri 2, tokio.

**Spec:** [docs/superpowers/specs/2026-10-14-phase-1-walking-skeleton-design.md](../specs/2026-10-14-phase-1-walking-skeleton-design.md)

## Global Constraints

- Server code runs on Node.js LTS (`engines.node >=24`). No `Bun.*` or `bun:*` outside build and dev scripts.
- ESM only; relative imports end in `.js`; `import type` for types; no `any`; no `!` without a comment.
- Boundary data (HTTP, WebSocket, files, IPC) is parsed with Zod schemas exported by `@overly/shared`.
- npm dependencies: exact versions, in the workspace that uses them, MIT-compatible. Versions checked on 2026-10-14: fastify 5.12.7, @fastify/websocket 11.3.4, @fastify/static 10.1.6, @fastify/cookie 11.1.3, pino 10.4.0, pino-roll 4.0.0, pino-pretty 13.2.0, tsx 4.23.15, zod 4.6.7, ws 8.22.0, react/react-dom 19.3.0, react-router 8.4.0, @tanstack/react-query 5.104.2, @mantine/core and @mantine/hooks 9.7.2, postcss-preset-mantine 1.18.0, @vitejs/plugin-react 6.1.2, @testing-library/react 16.3.3, jsdom 30.1.2, eslint-plugin-react-hooks 7.1.1. Add the matching `@types/*` packages at their latest versions.
- Rust crates follow the existing pattern: major-version requirements (`"2"`) with the committed `Cargo.lock`.
- The server binds `127.0.0.1` only. Generated URLs use `http://127.0.0.1:<port>`.
- Ports: default **6859**; `bun run dev` server **6860**; Vite **5173** with `--strictPort`.
- In `--rpc` mode, stdout carries only JSON-RPC. Server code never uses `console.*` (ESLint `no-console: error` in `apps/server/src`, tests exempt).
- Timings: token TTL **120 s**; cookie `Max-Age` **2592000**; server shutdown deadline **5 s**; shell shutdown wait **8 s**; ready timeout **20 s**; backoff **0.5 s doubling to 30 s**, reset after **60 s** running; WebSocket ping **30 s**; dashboard reconnect **0.5 s doubling to 10 s**; logs **10 MB × 5 files**.
- Fixed copy: tray items **Dashboard** and **Quit**; status labels `Starting…`, `Running on port <n>`, `Restarting (attempt <n>)…`, `Error: <message>`, `Stopping…`, `Stopped`; no-session screen title **No active session**, body **Open the dashboard from the Overly tray icon.**
- Run tests with `bun run test` (never `bun test`). One workspace: `bun run test --project @overly/server`.
- Commit after every task with an imperative subject, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Shell commands in this environment need `export PATH="$HOME/homebrew/bin:$PATH"` first (bun, node and cargo live there).

## Review Focus

1. **The one-time token leaking into the log file** through Fastify's request logging of `GET /?t=…`. Expected: the token never appears in any log line. Test: Task 6, `does not log the one-time token`.
2. **The port is already taken when the app starts.** Expected: a `fatal` notification with `port_in_use` naming the port, exit code 1, and the shell shows the error without restarting. Tests: Task 11 `reports port_in_use when the port is taken`, Task 16 `does_not_restart_after_fatal`.
3. **A sidecar restart (crash recovery or dev reload) must not sign the browser out.** Expected: a cookie issued before the restart is still accepted. Test: Task 6, `accepts a cookie issued by a previous server with the same key`.
4. **First run, when the data directory doesn't exist yet** (nested path). Expected: the server creates it, writes `settings.json`, `session.key` and a log file, and becomes ready. Test: Task 11, `creates a data directory that does not exist yet`.
5. **Clicking Dashboard while the sidecar is restarting, or after a fatal error.** Expected: during a restart, the URL arrives once the sidecar is running; after a fatal error, the call fails at once instead of hanging for 20 s. Tests: Task 16 `dashboard_url_waits_for_restart` and `dashboard_url_fails_fast_when_fatal`.

---

## File Structure

```
packages/shared/src/
  version.ts            OVERLY_VERSION
  settings.ts           Settings schema, defaults, DEFAULT_PORT
  sidecar.ts            JSON-RPC 2.0 schemas, sidecar methods and params
  messages.ts           WebSocket server messages
  api.ts                HTTP response bodies
apps/server/
  scripts/copy-dashboard.js   copies the dashboard build next to server.mjs
  src/
    main.ts               composition root (process I/O, RPC, signals)
    cli.ts                argument parsing
    server.ts             startServer(): config → logger → app → listen
    errors.ts             StartupError, listenError()
    storage/atomic-write.ts, storage/json-document.ts
    config/data-dir.ts, config/settings.ts
    logging/logger.ts
    security/tokens.ts, security/session-key.ts, security/session.ts,
    security/allowlist.ts, security/guard.ts
    http/app.ts, http/routes.ts, http/dashboard.ts
    ws/hub.ts
    rpc/peer.ts
    lifecycle/shutdown.ts
    testing/app.ts        test helpers (buildTestApp, sessionCookie)
    main.process.test.ts  spawns the sidecar
apps/dashboard/
  index.html, vite.config.ts, vitest.config.ts, postcss.config.js
  src/
    main.tsx, App.tsx, theme.ts
    api/client.ts
    session/SessionGate.tsx, session/NoSessionPage.tsx
    connection/backoff.ts, connection/ServerConnection.tsx
    layout/AppLayout.tsx, layout/Header.tsx, layout/Sidebar.tsx,
    layout/ThemeToggle.tsx, layout/ConnectionBadge.tsx
    pages/HomePage.tsx, pages/NotFoundPage.tsx
    test/setup.ts, test/render.tsx
apps/desktop/src-tauri/
  src/main.rs (calls lib), lib.rs (Tauri app), protocol.rs, backoff.rs,
  status.rs, locate.rs, supervisor.rs, job.rs, tray.rs
  tests/supervisor.rs, tests/fixtures/fake-sidecar.mjs
docs/sidecar-protocol.md, docs/adr/0011-*.md, docs/adr/0012-*.md
```

---

### Task 1: Shared schemas and constants

**Files:**
- Create: `packages/shared/src/{version,settings,sidecar,messages,api}.ts` and a `*.test.ts` next to each schema file
- Modify: `packages/shared/src/index.ts` (re-export everything), `packages/shared/package.json` (add `zod` 4.6.7)

**Interfaces:**
- Produces:
  - `OVERLY_VERSION = '0.0.0'`
  - `DEFAULT_PORT = 6859`, `SETTINGS_SCHEMA_VERSION = 1`, `PortSchema` (integer 1–65535), `SettingsSchema` = `{ schemaVersion: literal(1), server: { port: PortSchema } }`, `type Settings`, `defaultSettings(): Settings`
  - `FATAL_CODES = ['port_in_use', 'port_unavailable', 'config_unsupported', 'startup_failed'] as const`, `FatalCodeSchema`, `type FatalCode`
  - `SidecarMethod = { ready: 'ready', fatal: 'fatal', getDashboardUrl: 'getDashboardUrl', shutdown: 'shutdown' } as const`
  - `ReadyParamsSchema { port: PortSchema, version: string }`, `FatalParamsSchema { code: FatalCodeSchema, message: string }`, `DashboardUrlResultSchema { url: z.url() }`
  - `JsonRpcMessageSchema` (union, checked in this order: request `{ jsonrpc: '2.0', id: number | string, method, params? }`, notification `{ jsonrpc: '2.0', method, params? }`, success `{ jsonrpc, id, result }`, error `{ jsonrpc, id: number | string | null, error: { code: int, message, data? } }`), with types `JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcSuccess`, `JsonRpcFailure`, `JsonRpcMessage`
  - `JSON_RPC_ERRORS = { parseError: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internalError: -32603 }`
  - `ServerMessageSchema` (discriminated on `type`; Phase 1: `{ type: 'hello', version: string }`), `type ServerMessage`, `WS_CLOSE_SHUTDOWN = 1001`
  - `HealthResponseSchema { status: literal('ok'), version }`, `SessionResponseSchema { authenticated: literal(true) }`, `ApiErrorBodySchema { error: string }`, `type ApiErrorCode = 'forbidden_host' | 'forbidden_origin' | 'no_session' | 'not_found'`

- [ ] **Step 1: Write the failing tests**

```ts
// settings.test.ts
it('has defaults that pass the schema', () => {
  expect(SettingsSchema.parse(defaultSettings())).toEqual({ schemaVersion: 1, server: { port: 6859 } });
});
it.each([0, 70000, 1.5, '6859'])('rejects port %s', (port) => {
  expect(SettingsSchema.safeParse({ schemaVersion: 1, server: { port } }).success).toBe(false);
});
// sidecar.test.ts
it('keeps the id of a request and has none on a notification', () => {
  expect(JsonRpcMessageSchema.parse({ jsonrpc: '2.0', id: 1, method: 'shutdown' })).toHaveProperty('id', 1);
  expect(JsonRpcMessageSchema.parse({ jsonrpc: '2.0', method: 'ready', params: {} })).not.toHaveProperty('id');
});
it('accepts every fatal code and rejects others', () => { /* FATAL_CODES each parse; 'oops' fails */ });
it('rejects a message without jsonrpc 2.0', () => { /* { id: 1, method: 'x' } fails */ });
// messages.test.ts
it('parses hello', () => {
  expect(ServerMessageSchema.parse({ type: 'hello', version: '0.0.0' })).toEqual({ type: 'hello', version: '0.0.0' });
});
```

- [ ] **Step 2: Run `bun run test --project @overly/shared`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Add `zod` to `packages/shared`, run `bun install`, implement the five files and the re-exports.**
- [ ] **Step 4: Run `bun run test --project @overly/shared && bun run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add shared settings, sidecar protocol and message schemas".

---

### Task 2: Atomic writes and JSON documents

**Files:**
- Create: `apps/server/src/storage/atomic-write.ts`, `apps/server/src/storage/json-document.ts`, tests next to them
- Modify: `apps/server/package.json` (add `zod`), delete the placeholder `apps/server/src/index.ts` and its test (also drop the `exports` entry, or point it at `src/server.ts` once Task 11 exists)

**Interfaces:**
- Produces:
  - `writeFileAtomic(path: string, data: string, options?: { retries?: number; retryDelayMs?: number; rename?: (from: string, to: string) => Promise<void> }): Promise<void>`. Defaults: 5 retries, 20 ms delay doubling. Temp file `${path}.${randomHex}.tmp` in the same directory, fsync before rename, retries only on `EPERM`, `EBUSY` and `EACCES`, removes the temp file if it finally fails.
  - `interface DocumentLogger { warn(obj: object, msg: string): void }` (pino-compatible)
  - `type Migrations = Readonly<Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>>`: key `n` upgrades version `n` to `n + 1`.
  - `class DocumentVersionError extends Error { readonly found: number; readonly supported: number }`
  - `class JsonDocument<T extends { schemaVersion: number }>` with `static open<T>(options: { path: string; schema: z.ZodType<T>; version: number; defaults: () => T; migrations?: Migrations; logger: DocumentLogger; write?: (path: string, data: string) => Promise<void>; now?: () => Date }): Promise<JsonDocument<T>>`, `get(): T`, `set(next: T): Promise<void>` (validates, then schedules a write), `update(fn: (current: T) => T): Promise<void>`, `flush(): Promise<void>`.
  - File format: `JSON.stringify(value, null, 2) + '\n'`. A corrupt file is renamed to `${path}.corrupt-${now().toISOString().replaceAll(':', '-')}` (no colons, because of Windows).

- [ ] **Step 1: Write the failing tests**

```ts
// atomic-write.test.ts
it('replaces the file content and leaves no temp files', ...);           // readdir has only the target
it('retries the rename on EPERM, then succeeds', ...);                     // injected rename fails twice with code 'EPERM'
it('removes the temp file when the rename keeps failing', ...);           // rejects; readdir has no *.tmp
// json-document.test.ts
it('writes the defaults when the file is missing', ...);                   // file content parses to defaults
it('loads and validates an existing file', ...);
it('runs migrations from older versions and saves the result', ...);      // v1 file, version 2, migrations {1: ...}
it('backs up invalid JSON and falls back to the defaults', ...);          // a *.corrupt-* file holds the original bytes; logger.warn called
it('backs up a file that fails the schema (port 70000)', ...);
it('refuses a file from a newer version and leaves it untouched', async () => {
  await expect(open({ fileContent: { schemaVersion: 9 } })).rejects.toBeInstanceOf(DocumentVersionError);
  // file bytes unchanged, no backup created
});
it('rejects invalid values passed to set and keeps the file', ...);
it('coalesces rapid writes and keeps the last value', async () => {
  // write spy: 3 set() calls without awaiting, then flush()
  expect(write.mock.calls.length).toBeLessThanOrEqual(2);
  expect(JSON.parse(await readFile(path, 'utf8')).server.port).toBe(lastPort);
});
it('flush resolves only after pending writes are on disk', ...);
```

- [ ] **Step 2: Run `bun run test --project @overly/server`.** Expected: FAIL.
- [ ] **Step 3: Implement both files.** `JsonDocument` keeps one in-flight write plus at most one pending value; `flush()` waits until both are done.
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add atomic writes and versioned JSON documents".

---

### Task 3: Data directory and settings

**Files:**
- Create: `apps/server/src/config/data-dir.ts`, `apps/server/src/config/settings.ts`, tests

**Interfaces:**
- Consumes: `JsonDocument`, `DocumentLogger` (Task 2); `SettingsSchema`, `SETTINGS_SCHEMA_VERSION`, `defaultSettings` (Task 1)
- Produces:
  - `resolveDataDir(input: { platform: NodeJS.Platform; env: Readonly<Record<string, string | undefined>>; homedir: string; cwd: string; override?: string | undefined }): string`. Precedence: `override` (from `--data-dir`), then `env.OVERLY_DATA_DIR`, then the OS default. Relative paths resolve against `cwd`. Use `path.win32` on `win32` and `path.posix` otherwise, so every OS is testable anywhere.
  - `SETTINGS_FILE = 'settings.json'`, `openSettings(dataDir: string, logger: DocumentLogger): Promise<JsonDocument<Settings>>` (creates `dataDir` recursively first)

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ['win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a', 'C:\\Users\\a\\AppData\\Roaming\\Overly'],
  ['win32', {}, 'C:\\Users\\a', 'C:\\Users\\a\\AppData\\Roaming\\Overly'],
  ['darwin', {}, '/Users/a', '/Users/a/Library/Application Support/Overly'],
  ['linux', { XDG_DATA_HOME: '/x' }, '/home/a', '/x/overly'],
  ['linux', {}, '/home/a', '/home/a/.local/share/overly'],
])('uses the %s default', ...);
it('prefers --data-dir over OVERLY_DATA_DIR over the default', ...);
it('resolves a relative override against cwd', ...);       // '../.dev-data' with cwd '/repo/apps/server' → '/repo/apps/.dev-data'
it('openSettings creates the directory and default settings.json', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Resolve the data directory and load settings".

---

### Task 4: Logging

**Files:**
- Create: `apps/server/src/logging/logger.ts`, `apps/server/src/logging/logger.test.ts`
- Modify: `apps/server/package.json` (add `pino`, `pino-roll`; devDependency `pino-pretty`)

**Interfaces:**
- Produces:
  - `redactUrl(url: string): string`: replaces the value of a `t` query parameter with `[redacted]` and leaves everything else alone
  - `loggerOptions: pino.LoggerOptions`: `redact: ['req.headers.cookie', 'res.headers["set-cookie"]']` and `serializers: { req: (req) => ({ method, url: redactUrl(url), host }), res: (res) => ({ statusCode }), err: pino.stdSerializers.err }`
  - `createLogger(options: { logDir: string; pretty: boolean; level?: string }): Promise<AppLogger>`, `interface AppLogger { logger: pino.Logger; flush(): Promise<void> }`. Uses `await pinoRoll({ file: join(logDir, 'overly'), extension: '.log', size: '10m', limit: { count: 4 }, mkdir: true })` as the destination (4 old files plus the current one = 5), combined with `pino.multistream` and a pino-pretty stream on stderr (fd 2) when `pretty` is true. pino-pretty is loaded with a dynamic `import()` so the bundle can mark it external.

- [ ] **Step 1: Write the failing tests**

```ts
it('redacts the one-time token and keeps other parameters', () => {
  expect(redactUrl('/?t=abc&x=1')).toBe('/?t=%5Bredacted%5D&x=1');
  expect(redactUrl('/api/health')).toBe('/api/health');
});
it('writes JSON lines to a numbered file in the log directory', async () => {
  // log.info({ hello: 1 }, 'x'); await flush(); readdir(logDir) matches /^overly\.\d+\.log$/, and the line parses as JSON with msg 'x'
});
it('never writes to stdout', async () => { /* spy on process.stdout.write, log with pretty: true, expect no calls */ });
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Install the dependencies and implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Log to a rotating file with token redaction".

---

### Task 5: Security primitives

**Files:**
- Create: `apps/server/src/security/{tokens,session-key,session,allowlist}.ts` and tests

**Interfaces:**
- Produces:
  - `TOKEN_TTL_MS = 120_000`; `class OneTimeTokens { constructor(options?: { ttlMs?: number; now?: () => number }); issue(): string; consume(token: string): boolean }`. A token is 32 random bytes in base64url (43 characters). Expired tokens are pruned on `issue()`.
  - `SESSION_KEY_FILE = 'session.key'`; `loadOrCreateSessionKey(dataDir: string): Promise<Buffer>`. The file holds a 32-byte key in base64, written with `mode: 0o600, flag: 'wx'` (on `EEXIST`, read it again). Content that doesn't decode to 32 bytes is replaced.
  - `SESSION_COOKIE = 'overly_session'`, `SESSION_MAX_AGE_SECONDS = 2_592_000`; `createSessionValue(now: number): string` returns `${randomId}.${now}`; `isSessionValueFresh(value: string, now: number): boolean` is true when the issue time parses and `0 <= now - issuedAt <= SESSION_MAX_AGE_SECONDS * 1000`.
  - `interface Allowlist { isAllowedHost(host: string | undefined): boolean; isAllowedOrigin(origin: string | undefined): boolean }`; `createAllowlist(getPort: () => number, devOrigins: readonly string[]): Allowlist`. Hosts `127.0.0.1:<port>` and `localhost:<port>`, compared case-insensitively. Origins `http://127.0.0.1:<port>`, `http://localhost:<port>` and each dev origin, compared exactly after lowercasing. `undefined` and `'null'` are rejected.
  - `requiresSession(pathname: string): boolean`: true for `/ws` and `/api/*`, except `/api/health`. `requiresOrigin(method: string, isUpgrade: boolean): boolean`: true when the method isn't GET, HEAD or OPTIONS, or when the request is an upgrade.

- [ ] **Step 1: Write the failing tests**

```ts
it('consumes a token only once', ...);                      // consume(t) true, then false
it('expires tokens after 120 s', ...);                      // now = 0 → issue; now = 120_001 → consume false
it('rejects unknown tokens', ...);
it('issues 43-character base64url tokens', ...);            // /^[A-Za-z0-9_-]{43}$/
it('creates a 32-byte session key and returns the same key next time', ...);
it.skipIf(process.platform === 'win32')('creates session.key with mode 0600', ...);
it('replaces a session key file with invalid content', ...);
it('treats a session older than 30 days as stale', ...);    // isSessionValueFresh(v, issued + 2_592_000_001) false
it('rejects session values without a valid timestamp', ...); // 'abc', 'abc.', 'abc.-5', future timestamp
it('allows the loopback hosts on the current port, in any case', ...); // '127.0.0.1:6859', 'LOCALHOST:6859' true
it('rejects other hosts and ports', ...);                   // 'evil.com:6859', '127.0.0.1:80', '[::1]:6859', undefined
it('allows only the loopback origins and dev origins', ...); // 'null', 'http://evil.com', 'https://127.0.0.1:6859' false
it('requires a session for /api and /ws but not /api/health', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add one-time tokens, session values and the host and origin allowlist".

---

### Task 6: HTTP app with the security guard and session exchange

**Files:**
- Create: `apps/server/src/security/guard.ts`, `apps/server/src/http/app.ts`, `apps/server/src/http/routes.ts`, `apps/server/src/testing/app.ts`, `apps/server/src/http/app.test.ts`
- Modify: `apps/server/package.json` (add `fastify`, `@fastify/cookie`)

**Interfaces:**
- Consumes: Task 5 primitives; `loggerOptions` (Task 4); `HealthResponseSchema`-shaped bodies (Task 1)
- Produces:
  - `interface AppDeps { logger: pino.Logger; version: string; getPort: () => number; devOrigins: readonly string[]; sessionKey: Buffer; tokens: OneTimeTokens; dashboardDir: string | undefined; now?: () => number }`
  - `buildApp(deps: AppDeps): Promise<FastifyInstance>`: `Fastify({ loggerInstance: deps.logger })`. Registers `@fastify/cookie` with `secret: sessionKey`, then the guard, the session exchange and the routes. Task 7 adds the dashboard and Task 8 the WebSocket.
  - `registerGuard(app, { allowlist: Allowlist; now: () => number })`, as global hooks in this order:
    - `onRequest`: Host fails → `403 {error:'forbidden_host'}`; `requiresOrigin` and Origin fails → `403 {error:'forbidden_origin'}`; `requiresSession(path)` without a valid signed and fresh cookie → `401 {error:'no_session'}`.
    - `onSend`: sets `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
    - Exports `hasValidSession(request, now): boolean`.
  - Session exchange, as an `onRequest` hook after the guard: on `GET /` with a `t` query parameter, `tokens.consume(t)` → `reply.setCookie(SESSION_COOKIE, createSessionValue(now), { signed: true, httpOnly: true, sameSite: 'strict', path: '/', maxAge: SESSION_MAX_AGE_SECONDS })`. Valid or not, the reply is `303` to `/` with `Cache-Control: no-store`.
  - Routes: `GET /api/health` → `{ status: 'ok', version }`; `GET /api/session` → `{ authenticated: true }` (the guard already rejected requests without a session).
  - `testing/app.ts`: `buildTestApp(overrides?: Partial<AppDeps>): Promise<{ app: FastifyInstance; tokens: OneTimeTokens; deps: AppDeps }>` (port 6859, a random key, a silent logger) and `sessionCookie(app, tokens): Promise<string>` (runs the exchange and returns a `name=value` cookie header)

- [ ] **Step 1: Write the failing tests** (all `inject()` calls use `host: '127.0.0.1:6859'` unless the test is about Host)

```ts
it('serves health without a session', ...);                          // 200 { status: 'ok', version: OVERLY_VERSION }
it('rejects a foreign Host with 403 forbidden_host', ...);           // host 'evil.com:6859'
it('rejects the default inject host (wrong port)', ...);             // no host override → 'localhost:80' → 403
it('accepts LOCALHOST:6859 as a host', ...);
it('rejects a cross-origin POST with 403 forbidden_origin', ...);    // POST /api/session, origin 'http://evil.com', valid cookie
it('rejects a POST without Origin', ...);
it('rejects Origin null', ...);
it('lets a POST from an allowed origin through the guard', ...);     // valid cookie, origin http://127.0.0.1:6859 → 404, not 403
it('accepts the dev origin only when configured', ...);              // devOrigins ['http://localhost:5173']
it('answers /api/session with 401 no_session without a cookie', ...);
it('exchanges a token for a session cookie and redirects to /', async () => {
  const res = await app.inject({ url: `/?t=${tokens.issue()}`, headers: { host } });
  expect(res.statusCode).toBe(303);
  expect(res.headers.location).toBe('/');
  expect(res.headers['cache-control']).toBe('no-store');
  const cookie = String(res.headers['set-cookie']);
  for (const part of ['overly_session=', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=2592000']) expect(cookie).toContain(part);
});
it('does not set a cookie for a reused or expired token', ...);
it('rejects a tampered cookie', ...);
it('rejects a cookie older than 30 days', ...);                     // now dep advanced past max age
it('accepts a cookie issued by a previous server with the same key', ...); // Review Focus 3: two buildTestApp with the same sessionKey
it('does not log the one-time token', async () => {                  // Review Focus 1
  // logger = pino({ ...loggerOptions, level: 'info' }, captureStream); inject GET /?t=SECRET-TOKEN
  expect(captured.join('')).not.toContain('SECRET-TOKEN');
});
it('sets nosniff and no-referrer on every response', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Install the dependencies and implement.** `getPort` and `now` let tests pin the port and time.
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the HTTP app with host, origin and session checks".

---

### Task 7: Serving the dashboard

**Files:**
- Create: `apps/server/src/http/dashboard.ts`, `apps/server/src/http/dashboard.test.ts`
- Modify: `apps/server/src/http/app.ts` (register it), `apps/server/package.json` (add `@fastify/static`)

**Interfaces:**
- Consumes: `buildTestApp`, `sessionCookie` (Task 6)
- Produces: `registerDashboard(app: FastifyInstance, options: { dashboardDir: string | undefined }): Promise<void>`
  - `RESERVED_PREFIXES = ['/api/', '/ws', '/o/', '/assets/']`
  - The folder exists: static files are served; a `GET` with `Accept` containing `text/html` outside the reserved prefixes gets `index.html`; everything else is `404 {error:'not_found'}`. HTML responses get `X-Frame-Options: DENY`.
  - The folder is missing: `GET /` answers `200 text/plain` with `The dashboard isn't built. Run "bun run build", or use the Vite dev server ("bun run dev").`

- [ ] **Step 1: Write the failing tests** (temp folder with `index.html` and `static/app.js`)

```ts
it('serves index.html at / with X-Frame-Options DENY', ...);
it('serves built files', ...);                                      // GET /static/app.js → 200, JS content
it('falls back to index.html for client routes', ...);              // GET /widgets/abc, accept text/html
it('does not fall back for missing files or reserved paths', ...);  // /static/missing.js (accept */*), /api/nope, /o/x, /assets/x → 404
it('still exchanges tokens at /?t=', ...);                          // 303, not index.html
it('explains a missing dashboard build', ...);                      // dashboardDir: join(tmp, 'nope')
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement** with `@fastify/static` (`wildcard: true`, `index: false`) plus `setNotFoundHandler` for the fallback.
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Serve the dashboard build with a client-route fallback".

---

### Task 8: WebSocket hub

**Files:**
- Create: `apps/server/src/ws/hub.ts`, `apps/server/src/ws/hub.test.ts`
- Modify: `apps/server/src/http/app.ts` (register it and expose the hub), `apps/server/package.json` (add `@fastify/websocket`; devDependencies `ws`, `@types/ws`)

**Interfaces:**
- Consumes: `ServerMessage`, `WS_CLOSE_SHUTDOWN` (Task 1); the guard (Task 6) already checks Host, Origin and session on the upgrade
- Produces:
  - `interface WsHub { readonly size: number; closeAll(code: number, reason: string): void }`
  - `registerWebSocket(app: FastifyInstance, options: { version: string; pingIntervalMs?: number }): Promise<WsHub>`. Route `/ws`. Sends `hello` on connect. Pings every `pingIntervalMs` (default 30_000) and terminates a peer that didn't answer the previous ping. Ignores client messages.
  - `buildApp` now returns `Promise<{ app: FastifyInstance; hub: WsHub }>`. Update Task 6's callers and `buildTestApp` (which also returns `hub`).

- [ ] **Step 1: Write the failing tests** (`app.listen({ host: '127.0.0.1', port: 0 })`, `getPort` reads the bound port, the `ws` client sends a cookie from `sessionCookie`)

```ts
it('sends hello with the server version', ...);                   // first message { type: 'hello', version: OVERLY_VERSION }
it('rejects a forged Origin with 403', ...);                      // origin 'http://evil.com' → 'unexpected-response' with 403
it('rejects a forged Host with 403', ...);                        // headers: { host: 'evil.com' }
it('rejects a client without a session with 401', ...);
it('closes every client with 1001 on closeAll', ...);
it('terminates a client that stops answering pings', ...);        // pingIntervalMs 50, client { autoPong: false } → close event
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Install the dependencies and implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add the dashboard WebSocket endpoint".

---

### Task 9: JSON-RPC peer

**Files:**
- Create: `apps/server/src/rpc/peer.ts`, `apps/server/src/rpc/peer.test.ts`

**Interfaces:**
- Consumes: `JsonRpcMessageSchema`, `JSON_RPC_ERRORS` (Task 1)
- Produces:
  - `class RpcError extends Error { constructor(readonly code: number, message: string) }`
  - `class RpcPeer` with:
    - `constructor(input: Readable, output: Writable, options: { logger: Pick<pino.Logger, 'warn' | 'error'>; requestTimeoutMs?: number })`, timeout default 10_000
    - `handle(method: string, handler: (params: unknown) => unknown): void`, where the handler may return a promise
    - `notify(method: string, params?: unknown): Promise<void>`, which resolves once the line is written
    - `request(method: string, params?: unknown): Promise<unknown>`
    - `drain(): Promise<void>`, which resolves once every message written so far has been flushed to the output (`main.ts` awaits it before `process.exit`)
    - `readonly closed: Promise<void>`, which resolves when the input ends or the output errors (for example `EPIPE`); after that, writes are dropped
  - Wire format: one `JSON.stringify(message)` plus `\n` per message. Input is split on `\n` across chunk boundaries, and `\r` is trimmed.

- [ ] **Step 1: Write the failing tests** (`PassThrough` for both directions)

```ts
it('answers a request with the handler result', ...);              // → {"jsonrpc":"2.0","id":1,"result":{"ok":true}}
it('answers unknown methods with -32601', ...);
it('answers -32603 when a handler throws', ...);
it('uses the code of a thrown RpcError', ...);
it('skips and logs malformed lines, then keeps working', ...);
it('handles messages split across chunks and several per chunk', ...);
it('sends notifications without an id', ...);
it('resolves request() with the matching response', ...);
it('rejects request() after the timeout', ...);                    // requestTimeoutMs 20
it('drain resolves after pending writes are flushed', ...);
it('resolves closed when the input ends', ...);
it('resolves closed and stops writing when the output errors', ...); // output.destroy(Object.assign(new Error('EPIPE'), { code: 'EPIPE' }))
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add a newline-delimited JSON-RPC peer".

---

### Task 10: Shutdown coordinator and startup errors

**Files:**
- Create: `apps/server/src/lifecycle/shutdown.ts`, `apps/server/src/errors.ts`, tests

**Interfaces:**
- Consumes: `FatalCode` (Task 1)
- Produces:
  - `class ShutdownCoordinator` with:
    - `constructor(options: { logger: Pick<pino.Logger, 'info' | 'error'>; deadlineMs?: number })`, deadline default 5_000
    - `add(name: string, step: () => Promise<void> | void): void`
    - `run(reason: string): Promise<{ exitCode: 0 | 1 }>`, which is idempotent: later calls return the same promise
    - Steps run one at a time, in the order they were added. A failing step is logged, the remaining steps still run, and the exit code becomes 1. Passing the deadline gives exit code 1 without waiting further.
  - `class StartupError extends Error { constructor(readonly code: FatalCode, message: string, options?: ErrorOptions) }`
  - `listenError(error: unknown, port: number, settingsPath: string): StartupError`:
    - `EADDRINUSE` → `port_in_use`, `Port ${port} is already in use by another program. Close it, or change server.port in ${settingsPath}.`
    - `EACCES` → `port_unavailable`, `Port ${port} can't be used (Windows may reserve it for Hyper-V or WSL). Change server.port in ${settingsPath}.`
    - anything else → `startup_failed` with the error's message

- [ ] **Step 1: Write the failing tests**

```ts
it('runs steps in the order they were added', ...);
it('runs steps once even when run() is called twice', ...);
it('continues after a failing step and exits with 1', ...);
it('gives up after the deadline and exits with 1', ...);           // deadlineMs 20, step never resolves
it.each([['EADDRINUSE', 'port_in_use'], ['EACCES', 'port_unavailable'], ['EOTHER', 'startup_failed']])('maps %s to %s', ...);
it('names the port and the settings path in the message', ...);
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the server tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add ordered shutdown with a deadline and startup error mapping".

---

### Task 11: Server composition, CLI, bundle and process test

**Files:**
- Create: `apps/server/src/cli.ts`, `apps/server/src/cli.test.ts`, `apps/server/src/server.ts`, `apps/server/src/main.ts`, `apps/server/src/main.process.test.ts`, `apps/server/scripts/copy-dashboard.js`
- Modify: `apps/server/package.json` (scripts, `tsx` devDependency, `exports` → `./src/server.ts`), root `package.json` (`build`, `test:sidecar`), `.github/workflows/ci.yml` (js job: `bun run build`, `bun run test:sidecar`), `eslint.config.js` (`no-console: error` for `apps/server/src/**/*.ts`, except `**/*.test.ts`)

**Interfaces:**
- Consumes: everything from Tasks 2–10
- Produces:
  - `parseCliArgs(argv: readonly string[]): CliOptions`, `interface CliOptions { rpc: boolean; dataDir: string | undefined; port: number | undefined; devOrigins: string[]; dashboardDir: string | undefined; prettyLogs: boolean }`. `--dev-origin` can repeat; `--port` accepts 0–65535; anything else throws `UsageError`.
  - `startServer(options: { dataDir: string; port: number | undefined; devOrigins: readonly string[]; dashboardDir: string | undefined; prettyLogs: boolean }): Promise<RunningServer>`:
    - order: create the logger (`<dataDir>/logs`) → open settings → load the session key → build the app → listen on `127.0.0.1` at `options.port ?? settings.server.port` → register the shutdown steps `websockets` (`hub.closeAll(WS_CLOSE_SHUTDOWN, 'server shutting down')`), `http` (`app.close()`), `documents` (`settings.flush()`), `logger` (`flush()`)
    - throws `StartupError`: `DocumentVersionError` becomes `config_unsupported`, listen errors go through `listenError`, and the app and logger are closed before it throws
  - `interface RunningServer { readonly port: number; readonly logger: pino.Logger; dashboardUrl(origin?: string): string; shutdown(reason: string): Promise<{ exitCode: 0 | 1 }> }`. `dashboardUrl` issues a fresh token; the origin defaults to `http://127.0.0.1:<port>`.
  - `main.ts` behavior:
    - with `--rpc`: an `RpcPeer` on stdin and stdout. `getDashboardUrl` → `{ url: server.dashboardUrl() }`. `shutdown` → resolves `{}`, then (after the response is written) `server.shutdown('rpc')`. `peer.closed` → `shutdown('stdin closed')`. Then `await peer.notify('ready', { port, version: OVERLY_VERSION })`.
    - without `--rpc`: writes `Overly is running. Open the dashboard: <url>` to stderr, using the first `--dev-origin` when one is given.
    - SIGINT and SIGTERM → shutdown.
    - after shutdown: `process.exit(exitCode)`.
    - `StartupError`: in `--rpc` mode, `await peer.notify('fatal', { code, message })`; always write the message to stderr; exit 1.
    - default dashboard folder: `fileURLToPath(new URL('./dashboard/', import.meta.url))`.
  - Server scripts:
    - `"dev": "tsx watch src/main.ts --port 6860 --data-dir ../../.dev-data --dev-origin http://localhost:5173 --pretty-logs"`
    - `"build": "bun build src/main.ts --target=node --format=esm --outfile=dist/sidecar/server.mjs --external bufferutil --external utf-8-validate --external pino-pretty && node scripts/copy-dashboard.js"`
  - `copy-dashboard.js`: copies `../dashboard/dist/web` to `dist/sidecar/dashboard` (`fs.cp`, recursive, replacing the old copy), and exits 1 with a message if the source is missing.
  - Root scripts:
    - `"build": "bun run --filter @overly/dashboard build && bun run --filter @overly/server build"`
    - `"test:sidecar": "OVERLY_SIDECAR_ENTRY=apps/server/dist/sidecar/server.mjs vitest run --project @overly/server main.process"`
  - Process test launcher: `process.execPath` with `[resolve(OVERLY_SIDECAR_ENTRY)]` when the variable is set, otherwise `['--import', 'tsx', 'src/main.ts']` with `cwd: apps/server`. Args `--rpc --port 0 --data-dir <tmp>`.

- [ ] **Step 1: Write the failing tests**

```ts
// cli.test.ts
it('parses every option', ...);                   // --rpc --data-dir x --port 0 --dev-origin a --dev-origin b --dashboard-dir d --pretty-logs
it('rejects an invalid port', ...);               // '--port', '70000' and '--port', 'abc' throw UsageError
// main.process.test.ts (timeout 20 s each)
it('starts in RPC mode, opens a session, and exits 0 on shutdown', async () => {
  // ready.params.port > 0; GET /api/health → 200
  // request getDashboardUrl id 1 → url matches ^http://127\.0\.0\.1:<port>/\?t=[A-Za-z0-9_-]{43}$
  // fetch(url, { redirect: 'manual' }) → 303 with set-cookie overly_session
  // request shutdown id 2 → result {}; exit code 0
});
it('creates a data directory that does not exist yet', ...);  // Review Focus 4: <tmp>/a/b/c has settings.json, session.key, logs/overly.*.log
it('shuts down when stdin closes', ...);                      // child.stdin.end() → exit 0
it('reports port_in_use when the port is taken', ...);        // Review Focus 2: net server on 127.0.0.1:0; first stdout message is fatal { code: 'port_in_use' } and its message contains the port; exit 1
```

- [ ] **Step 2: Run the server tests.** Expected: FAIL.
- [ ] **Step 3: Implement `cli.ts`, `server.ts` and `main.ts`, add the scripts and the ESLint rule, and update CI.**
- [ ] **Step 4: Run `bun run test --project @overly/server`.** Expected: PASS.
- [ ] **Step 5: Run `bun run lint && bun run typecheck`.** Expected: PASS. (Running the bundle needs the dashboard build, so `bun run build` and `bun run test:sidecar` wait for Task 13.)
- [ ] **Step 6: Commit** "Compose the sidecar server with its CLI and RPC channel".

---

### Task 12: Dashboard scaffold, layout and theme

**Files:**
- Create: `apps/dashboard/{index.html,vite.config.ts,vitest.config.ts,postcss.config.js}`, `apps/dashboard/src/{main.tsx,App.tsx,theme.ts}`, `src/layout/{AppLayout,Header,Sidebar,ThemeToggle}.tsx`, `src/pages/{HomePage,NotFoundPage}.tsx`, `src/test/{setup.ts,render.tsx}`, `src/App.test.tsx`
- Delete: `apps/dashboard/src/index.ts` and `index.test.ts`
- Modify: `apps/dashboard/package.json` (dependencies, plus scripts `dev: vite --port 5173 --strictPort` and `build: vite build`; remove `exports`), `apps/dashboard/tsconfig.json` (`"jsx": "react-jsx"`, `"types": ["vite/client"]`), `eslint.config.js` (react-hooks recommended config for `apps/dashboard/**/*.{ts,tsx}`; add `apps/dashboard/vite.config.ts` and `apps/dashboard/vitest.config.ts` to `allowDefaultProject`)

**Interfaces:**
- Produces:
  - `vite.config.ts`: `plugins: [react()]`, `build: { outDir: 'dist/web', assetsDir: 'static', emptyOutDir: true }`
  - `vitest.config.ts`: `environment: 'jsdom'`, `setupFiles: ['src/test/setup.ts']`. The setup file adds `@testing-library/jest-dom/vitest` and stubs for `matchMedia` and `ResizeObserver`.
  - `AppProviders({ children })` in `App.tsx`: `MantineProvider` (with `theme`, `defaultColorScheme="auto"`, `localStorageColorSchemeManager({ key: 'overly-color-scheme' })`) and `QueryClientProvider`
  - `AppRoutes()`: route `/` → `AppLayout` with `HomePage` as the index; `*` → `NotFoundPage`
  - `renderWithProviders(ui, { route?: string })` in `test/render.tsx` (uses `MemoryRouter`)
  - Copy:
    - header: **Overly**, a badge **Twitch: not connected**, and a `ThemeToggle` menu button labeled **Theme** with items **Light**, **Dark**, **Auto**
    - sidebar: **Widgets** and **Pipelines** headings; disabled buttons labeled **Add widget** and **Add pipeline** with the tooltip **Coming in a later version**; texts **No widgets yet.** and **No pipelines yet.**
    - home: heading **Welcome to Overly**, text **Widgets and pipelines arrive in the next versions. For now, this page shows that the server is running.**
    - not found: heading **Page not found**, with a link **Back to the dashboard**

- [ ] **Step 1: Install the dependencies:** react, react-dom, react-router, @tanstack/react-query, @mantine/core, @mantine/hooks; devDependencies @vitejs/plugin-react, vite 8.3.4, postcss-preset-mantine, @types/react, @types/react-dom, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom; root devDependency eslint-plugin-react-hooks. Read the installed type definitions of Mantine 9 (`AppShell`, `MantineProvider`, `localStorageColorSchemeManager`, `useMantineColorScheme`) and React Router 8 (`BrowserRouter`, `Routes`, `MemoryRouter`) before writing code.
- [ ] **Step 2: Write the failing tests**

```tsx
it('shows the Widgets and Pipelines sections with disabled add buttons', () => {
  renderWithProviders(<AppRoutes />);
  expect(screen.getByRole('button', { name: 'Add widget' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add pipeline' })).toBeDisabled();
  expect(screen.getByText('No widgets yet.')).toBeInTheDocument();
});
it('shows the empty state in the main pane', ...);       // heading 'Welcome to Overly'
it('shows the Twitch placeholder', ...);
it('switches to the dark theme', async () => {
  // click 'Theme', click 'Dark' → document.documentElement data-mantine-color-scheme === 'dark'
});
it('shows a not-found page for unknown routes', ...);    // route '/nope' → heading 'Page not found'
```

- [ ] **Step 3: Run `bun run test --project @overly/dashboard`.** Expected: FAIL.
- [ ] **Step 4: Implement.** `main.tsx` imports `@mantine/core/styles.css` and renders `AppProviders` > `BrowserRouter` > `AppRoutes`.
- [ ] **Step 5: Run `bun run test --project @overly/dashboard && bun run lint && bun run typecheck && bun run --filter @overly/dashboard build`.** Expected: PASS, and `apps/dashboard/dist/web/static/` contains the bundle.
- [ ] **Step 6: Commit** "Scaffold the dashboard with Mantine layout and theme".

---

### Task 13: Dashboard session gate and server connection

**Files:**
- Create: `apps/dashboard/src/api/client.ts`, `src/session/{SessionGate,NoSessionPage}.tsx`, `src/connection/{backoff.ts,ServerConnection.tsx}`, `src/layout/ConnectionBadge.tsx`, and tests next to each
- Modify: `src/App.tsx` (`SessionGate` wraps the routes, `ServerConnectionProvider` sits inside the gate), `src/layout/Header.tsx` (adds `ConnectionBadge`), `apps/dashboard/package.json` (add `zod`)

**Interfaces:**
- Consumes: `SessionResponseSchema`, `ApiErrorBodySchema`, `ServerMessageSchema` (Task 1)
- Produces:
  - `class ApiError extends Error { readonly status: number; readonly code: string | undefined }`; `apiGet<T>(path: string, schema: z.ZodType<T>, fetchImpl?: typeof fetch): Promise<T>`, same-origin with `credentials: 'same-origin'`
  - `SessionGate({ children })`:
    - loading → a centered `Loader`
    - `ApiError` with status 401 → `NoSessionPage`
    - any other error → **Can't reach the Overly server.** and a **Retry** button that refetches
    - success → `children`
    - React Query's `retry` is off for 401 and at most 2 for other errors
  - `reconnectDelay(attempt: number): number` = `Math.min(500 * 2 ** attempt, 10_000)`
  - `type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting'`; `ServerConnectionProvider({ children, url?, createSocket? }: { children: ReactNode; url?: string; createSocket?: (url: string) => WebSocket })`, where `url` defaults to `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`; `useConnectionStatus(): ConnectionStatus`. Messages that fail `ServerMessageSchema` are ignored.
  - `ConnectionBadge`: **Connecting…**, **Connected**, **Reconnecting…**

- [ ] **Step 1: Write the failing tests**

```ts
it('throws ApiError with status and code', ...);         // fetch → 401 {error:'no_session'} → status 401, code 'no_session'
it('parses the body with the schema', ...);
it('shows the no-session screen on 401', ...);           // 'No active session' and 'Open the dashboard from the Overly tray icon.'
it('renders the dashboard when the session is valid', ...);
it('offers a retry when the server is unreachable', ...); // fetch rejects → "Can't reach the Overly server." and a Retry button
it('grows the reconnect delay up to 10 s', () => {
  expect([0, 1, 2, 3, 4, 5, 6].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
});
it('connects to ws://<host>/ws by default', ...);         // FakeWebSocket records its url
it('reports connected after open, then reconnecting after close', ...);
it('reconnects after the backoff delay', ...);            // vi.useFakeTimers; advance 500 ms → a second socket is created
```

- [ ] **Step 2: Run the dashboard tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `bun run test --project @overly/dashboard && bun run lint && bun run typecheck`.** Expected: PASS.
- [ ] **Step 5: Run `bun run build && bun run test:sidecar`.** Expected: PASS. This is the first run of the bundled `server.mjs` under Node. If it fails, fix the bundling (externals, `createRequire`) before going on.
- [ ] **Step 6: Commit** "Gate the dashboard on the session and show the server connection".

---

### Task 14: The `bun run dev` workflow

**Files:**
- Modify: `apps/dashboard/vite.config.ts` (`server.proxy`), root `package.json` (`dev` script), `.gitignore` (`.dev-data/`)

**Interfaces:**
- Consumes: the server `dev` script (Task 11) and the dashboard `dev` script (Task 12)
- Produces:
  - proxy, all targeting `http://127.0.0.1:6860` with `changeOrigin: true`: `'/api'`, `'/ws'` with `ws: true`, and `'^/\\?t='`
  - root `"dev": "bun run --filter @overly/server --filter @overly/dashboard dev"`. If Bun doesn't accept a repeated `--filter`, use the single pattern `--filter './apps/{server,dashboard}'` and record that in the commit message.

- [ ] **Step 1: Add the proxy and the scripts.**
- [ ] **Step 2: Run `bun run dev` in the background.** Expected: the stderr output includes `Open the dashboard: http://localhost:5173/?t=…`.
- [ ] **Step 3: Open that URL in the built-in browser.** Expected: redirected to `/`, the layout renders, the header shows **Connected**. Run `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: http://evil.com' http://127.0.0.1:6860/api/session`, expected `403`.
- [ ] **Step 4: Edit a dashboard component.** Expected: hot reload, the session survives. Restart the server by touching `src/main.ts`. Expected: the dashboard shows **Reconnecting…** and then **Connected** again, with no new token.
- [ ] **Step 5: Stop the dev processes and commit** "Add the bun run dev workflow with a Vite proxy".

---

### Task 15: Shell building blocks (protocol, backoff, status, locate)

**Files:**
- Create: `apps/desktop/src-tauri/src/{lib.rs,protocol.rs,backoff.rs,status.rs,locate.rs}`
- Modify: `apps/desktop/src-tauri/src/main.rs` (only calls `overly_desktop_lib::run()`; the existing `product_name_is_overly` test moves to `lib.rs`), `Cargo.toml` (`[lib] name = "overly_desktop_lib"`; add `serde` with `derive`, `serde_json`)

**Interfaces:**
- Produces:
  - `protocol`:
    - constants `READY`, `FATAL`, `GET_DASHBOARD_URL`, `SHUTDOWN`
    - `enum Incoming { Notification { method: String, params: Value }, Request { id: Value, method: String, params: Value }, Response { id: u64, outcome: Result<Value, RpcError> } }`
    - `struct RpcError { code: i64, message: String }`
    - `struct ReadyParams { port: u16, version: String }`
    - `struct FatalParams { code: String, message: String }`
    - `struct DashboardUrlResult { url: String }`
    - `fn parse_line(line: &str) -> Result<Incoming, ProtocolError>`
    - `fn encode_request(id: u64, method: &str, params: Option<&Value>) -> String`, ending in `\n`, with no `params` key when `None`
    - `fn encode_error(id: &Value, code: i64, message: &str) -> String`
    - `ProtocolError` implements `Display` and `Error`
  - `backoff`:
    - `struct Backoff`
    - `Backoff::new(initial: Duration, max: Duration)`
    - `fn next_delay(&mut self) -> Duration`
    - `fn attempt(&self) -> u32`
    - `fn reset(&mut self)`
    - constants `DEFAULT_INITIAL = 500 ms`, `DEFAULT_MAX = 30 s`
  - `status`:
    - `#[derive(Clone, Debug, PartialEq, Eq)] enum Status { Starting, Running { port: u16 }, Restarting { attempt: u32 }, Fatal { message: String }, Stopping, Stopped }`
    - `fn label(&self) -> String`, using the fixed copy in Global Constraints
    - `fn tooltip(&self) -> String`, which returns `Overly — <label>`
  - `locate`:
    - `struct Environment<'a> { node_override: Option<PathBuf>, script_override: Option<PathBuf>, exe_dir: Option<PathBuf>, resource_dir: Option<PathBuf>, dev_fallbacks: bool, exists: &'a dyn Fn(&Path) -> bool }`
    - `fn node_binary(env: &Environment) -> Result<PathBuf, LocateError>`: tries the override, then `exe_dir/NODE_BINARY`, then `PathBuf::from("node")` when `dev_fallbacks`
    - `fn server_script(env: &Environment) -> Result<PathBuf, LocateError>`: tries the override, then `resource_dir/server/server.mjs`, then `repo_server_script()` when `dev_fallbacks`
    - `NODE_BINARY` is `node.exe` on Windows and `node` elsewhere
    - `fn repo_server_script() -> PathBuf`, built from `CARGO_MANIFEST_DIR` + `../../server/dist/sidecar/server.mjs`
    - `struct LocateError { what: &'static str, searched: Vec<PathBuf> }`, displayed as `Can't find the <what> (looked in: <paths, comma-separated>)`
    - an override that doesn't exist is an error, not a fallback

- [ ] **Step 1: Write the failing unit tests** (in each module's `#[cfg(test)] mod tests`)

```rust
#[test] fn parses_ready_notification()          // {"jsonrpc":"2.0","method":"ready","params":{"port":6859,"version":"0.0.0"}}
#[test] fn parses_success_and_error_responses()
#[test] fn parses_server_requests()
#[test] fn rejects_invalid_json_and_wrong_version()
#[test] fn encodes_requests_without_params()    // == "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"shutdown\"}\n"
#[test] fn backoff_doubles_up_to_the_cap()      // 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000 ms
#[test] fn backoff_reset_starts_over()
#[test] fn labels_match_the_tray_copy()         // "Running on port 6859", "Restarting (attempt 3)…", "Error: Port 6859 is in use"
#[test] fn node_prefers_override_then_exe_dir_then_path()
#[test] fn node_without_dev_fallbacks_is_an_error_listing_searched_paths()
#[test] fn script_prefers_override_then_resources_then_repo()
#[test] fn missing_override_is_an_error()
```

- [ ] **Step 2: Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.** Expected: FAIL (compile errors).
- [ ] **Step 3: Implement.** `lib.rs` declares the modules and keeps the current empty `run()` builder for now.
- [ ] **Step 4: Run `cargo test`, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`.** Expected: PASS.
- [ ] **Step 5: Commit** "Add shell protocol, backoff, status and sidecar lookup".

---

### Task 16: Sidecar supervisor

**Files:**
- Create: `apps/desktop/src-tauri/src/supervisor.rs`, `src/job.rs`, `tests/supervisor.rs`, `tests/fixtures/fake-sidecar.mjs`
- Modify: `Cargo.toml` (add `tokio` with `process`, `io-util`, `time`, `sync`, `macros`, `rt-multi-thread`; `log`; `windows-sys` with `Win32_Foundation`, `Win32_System_JobObjects`, `Win32_System_Threading` under `[target.'cfg(windows)'.dependencies]`), `.github/workflows/ci.yml` (desktop job: `actions/setup-node@v7` with `node-version-file: .node-version`)

**Interfaces:**
- Consumes: `protocol`, `backoff`, `status` (Task 15)
- Produces:
  - `struct SupervisorConfig { node: PathBuf, script: PathBuf, args: Vec<String>, ready_timeout: Duration, request_timeout: Duration, shutdown_timeout: Duration, backoff_initial: Duration, backoff_max: Duration, stable_after: Duration }`, with `SupervisorConfig::new(node, script)` defaults: args `["--rpc"]`, 20 s, 5 s, 8 s, 500 ms, 30 s, 60 s
  - `#[derive(Clone)] struct SupervisorHandle` with:
    - `fn spawn(config: SupervisorConfig) -> Self`, which must be called inside a tokio runtime
    - `fn failed(message: String) -> Self`, which starts in `Fatal`
    - `fn status(&self) -> watch::Receiver<Status>`
    - `async fn dashboard_url(&self) -> Result<String, SupervisorError>`: waits up to `ready_timeout` for `Running`, and returns `Err(NotRunning)` at once in `Fatal`, `Stopping` or `Stopped`
    - `async fn shutdown(&self)`: idempotent, and resolves only when the child has exited
  - `enum SupervisorError { NotRunning(String), Timeout, Rpc(String) }`, which implements `Display`
  - Supervisor loop behavior:
    - spawn: `kill_on_drop(true)`, and on Windows `CREATE_NO_WINDOW` (`0x0800_0000`)
    - stdout: one task parses each line with `parse_line`. `ready` → `Running`. `fatal` → `Fatal`, with no restart. Responses complete the matching pending request. Server requests are answered with `-32601`.
    - stderr: each line is logged with `log::info!(target: "sidecar", ...)`
    - an exit without `fatal` while not stopping → `Restarting { attempt }`, sleep for `next_delay()`, then spawn again
    - a spawn that fails (for example `node` isn't on PATH) → `Fatal { message: "Can't start Node.js (<path>): <error>" }`, with no restart
    - after `stable_after` in `Running`, `reset()` the backoff
  - `job::ChildJob` with `fn new() -> io::Result<Self>` and `fn assign(&self, child: &tokio::process::Child) -> io::Result<()>`. On Windows: a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, created once and kept for the whole life of the supervisor. Elsewhere: a no-op.
  - The fixture `fake-sidecar.mjs` reads `--mode=<ready|crash|crash-once|fatal|hang|silent>` and `--marker=<path>`:
    - `ready`: sends `ready {port:1234, version:'test'}`, answers `getDashboardUrl` with `http://127.0.0.1:1234/?t=fake`, answers `shutdown` with `{}` and then exits 0, and also exits 0 on stdin EOF
    - `crash`: exits 1 at once
    - `crash-once`: exits 1 if the marker file doesn't exist (and creates it), otherwise behaves like `ready`
    - `fatal`: sends `fatal {code:'port_in_use', message:'Port 1234 is in use'}` and exits 1
    - `hang`: behaves like `ready` but ignores `shutdown` and stdin EOF
    - `silent`: never writes anything

- [ ] **Step 1: Write the failing integration tests** (`#[tokio::test(flavor = "multi_thread")]`, short timings: ready 500 ms, shutdown 300 ms, backoff 10–50 ms; `node` from PATH; marker files under `std::env::temp_dir()` with unique names)

```rust
async fn opens_dashboard_url_when_running()      // == "http://127.0.0.1:1234/?t=fake"
async fn restarts_after_a_crash_with_backoff()   // sees Restarting{attempt:1} then Restarting{attempt:2}
async fn does_not_restart_after_fatal()          // Fatal{message:"Port 1234 is in use"}; still Fatal 300 ms later
async fn restarts_when_ready_never_arrives()     // silent → Restarting{attempt:1}
async fn missing_node_is_fatal()                 // node path "does-not-exist" → Fatal, message starts with "Can't start Node.js"
async fn dashboard_url_waits_for_restart()       // Review Focus 5: crash-once; dashboard_url() called right away → Ok
async fn dashboard_url_fails_fast_when_fatal()   // Review Focus 5: Err(NotRunning) in < 1 s
async fn shuts_down_cleanly()                    // ready → shutdown() → Stopped
async fn kills_a_sidecar_that_ignores_shutdown() // hang → shutdown() returns within 1.5 s → Stopped
```

- [ ] **Step 2: Run `cargo test`.** Expected: FAIL.
- [ ] **Step 3: Implement `job.rs` and `supervisor.rs`.**
- [ ] **Step 4: Run `cargo test`, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`.** Expected: PASS.
- [ ] **Step 5: Commit** "Supervise the Node sidecar with restart, backoff and kill on timeout".

---

### Task 17: Tray app

**Files:**
- Create: `apps/desktop/src-tauri/src/tray.rs`
- Modify: `src/lib.rs` (`run()`), `Cargo.toml` (`tauri` features `tray-icon` and `image-png`; `tauri-plugin-single-instance`, `tauri-plugin-opener`, `tauri-plugin-log`), root `package.json` (`"dev:desktop": "bun run build && cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml"`)

**Interfaces:**
- Consumes: `SupervisorHandle`, `SupervisorConfig`, `Status` (Task 16); `locate` (Task 15)
- Produces:
  - `pub fn run()`, in this order:
    - plugins: single-instance first (its callback calls `open_dashboard`), then opener, then log (targets: stdout and the log directory)
    - `setup`: on macOS `set_activation_policy(ActivationPolicy::Accessory)`
    - locate node and the script with `dev_fallbacks = cfg!(debug_assertions)`, `exe_dir` from `std::env::current_exe()`, and `resource_dir` from `app.path().resource_dir()`
    - `SupervisorHandle::spawn`, which runs inside `tauri::async_runtime` (or `SupervisorHandle::failed(locate_error.to_string())`)
    - `app.manage(handle)`, then `tray::create`
  - `tray::create(app: &AppHandle, supervisor: &SupervisorHandle) -> tauri::Result<()>`:
    - menu ids `status` (disabled), a separator, `dashboard` (**Dashboard**), `quit` (**Quit**)
    - the icon is `app.default_window_icon()`
    - a task follows `supervisor.status()` and updates the status item text with `label()` and the tooltip with `tooltip()`
  - `fn open_dashboard(app: &AppHandle)`: spawns a task that runs `dashboard_url().await`, then `app.opener().open_url(url, None::<&str>)`. Errors are logged.
  - `fn quit(app: &AppHandle)`: spawns a task that runs `shutdown().await`, then `app.exit(0)`

- [ ] **Step 1: Implement `tray.rs` and `run()`.** There is no automated test beyond `cargo test`; the existing `product_name_is_overly` test must still pass.
- [ ] **Step 2: Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`.** Expected: PASS.
- [ ] **Step 3: Run `bun run dev:desktop` in the background on macOS.** Expected: a tray icon appears, with the status item reading "Starting…" and then "Running on port 6859".
- [ ] **Step 4: Click Dashboard.** Expected: the default browser opens `http://127.0.0.1:6859/?t=…`, lands on `/`, and the dashboard shows **Connected**. Launch the binary a second time. Expected: no second tray icon, and the dashboard opens again.
- [ ] **Step 5: Kill the node process (`pkill -f server.mjs`).** Expected: the status shows "Restarting (attempt 1)…" and then "Running on port 6859"; the dashboard reconnects without a new sign-in.
- [ ] **Step 6: Click Quit.** Expected: the app exits, and `pgrep -fl server.mjs` prints nothing.
- [ ] **Step 7: Start a listener on 6859 (`node -e "require('net').createServer().listen(6859,'127.0.0.1')"`), then run `bun run dev:desktop`.** Expected: the status reads `Error: Port 6859 is already in use…`, with no restarts.
- [ ] **Step 8: Commit** "Add the tray with Dashboard and Quit, and single-instance launch".

---

### Task 18: Documentation

**Files:**
- Create: `docs/sidecar-protocol.md`, `docs/adr/0011-dashboard-stack.md`, `docs/adr/0012-local-server-port-and-sessions.md`
- Modify: `docs/adr/README.md` (index rows), `AGENTS.md` (commands `bun run dev`, `bun run build`, `bun run dev:desktop` and `bun run test:sidecar`; a convention line: "In the server, stdout belongs to JSON-RPC: use the logger, never `console`"; the data folder for development, `.dev-data/`), `README.md` (replace the "Coming in Phase 1" note with run instructions), `ROADMAP.md` (tick the Phase 1 boxes; under Phase 10, add "Bundle the Node binary as a Tauri `externalBin` and `server.mjs` plus the dashboard as resources")

- [ ] **Step 1: Write `docs/sidecar-protocol.md`** from spec section 3: the framing, a message table with JSON examples, the lifecycle (spawn → ready → requests → shutdown → exit), the fatal codes, and the stdin-EOF rule.
- [ ] **Step 2: Write ADR 0011 and ADR 0012** from `docs/adr/template.md`, using the decision table in the spec. ADR 0012 lists the port numbers it avoids, and explains signed stateless sessions and deleting `session.key` to sign every browser out.
- [ ] **Step 3: Update AGENTS.md, README.md, ROADMAP.md and the ADR index.**
- [ ] **Step 4: Run `bun run lint`.** Expected: PASS (Markdown is ignored by Prettier, but JSON and YAML aren't).
- [ ] **Step 5: Commit** "Document the sidecar protocol, dashboard stack and session model".

---

### Task 19: Final verification and pull request

- [ ] **Step 1: Run** `bun install --frozen-lockfile && bun run lint && bun run typecheck && bun run test && bun run build && bun run test:sidecar`. Expected: everything passes.
- [ ] **Step 2: Run** `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings` and `cargo test --locked` in `apps/desktop/src-tauri`. Expected: everything passes.
- [ ] **Step 3: Walk through the exit criteria on macOS once more** (Task 17 steps 3–6), and also check the theme toggle and the no-session screen: open `http://127.0.0.1:6859/` in a private window and expect **No active session**.
- [ ] **Step 4: Ask the user before pushing.** Then push the branch, open the PR (template sections; the macOS verification; the note that the Windows exit criteria need a check on a Windows machine), and check CI on Linux and Windows.
