# 0014. Overlays run in an opaque-origin sandbox, served without a session

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

OBS loads overlays at `http://127.0.0.1:<port>/o/<widgetId>` and doesn't share the browser's cookies, so overlays can't use the dashboard session (ADR 0012). The dashboard also shows each overlay in a preview. Overlay code comes from plugins, and from Phase 8 from third parties. Served from the dashboard's origin, that code could call `/api/*` with the user's session cookie: in the preview, or whenever someone opens an overlay URL in their browser.

## Decision

- Overlay pages, plugin files (`/plugins/<pluginId>/…`, limited to overlay folders and icons), the overlay SDK (`/sdk/overlay.js`) and assets (`/assets/<id>`) need **no session**. The Host check still applies.
- Every overlay page is served with **`Content-Security-Policy: sandbox allow-scripts`** (and `frame-ancestors` limited to the dashboard's origins), so it runs in an **opaque origin** everywhere: OBS, the preview and any browser tab. The preview iframe is also sandboxed.
- The overlay WebSocket `/o/<widgetId>/ws` accepts `Origin: null` (the opaque origin) besides the usual origins. The dashboard socket `/ws` keeps its strict checks.
- Public plugin files, the SDK and assets send `Access-Control-Allow-Origin: *`, which module scripts, fonts and `fetch` from an opaque origin need. Assets also carry `Content-Security-Policy: sandbox`, so an uploaded SVG opened directly runs no script.
- The widget ID (12 random characters, about 62 bits) is the overlay's only credential until LAN mode adds tokens (ADR 0007).
- Dashboard pages get a Content-Security-Policy (`default-src 'self'`, styles inline for Mantine, `frame-ancestors 'none'`).

## Alternatives considered

- **Sandbox only the preview iframe:** OBS would run overlays on the real origin, with `localStorage`, so overlays would behave differently in OBS and in the preview, and an overlay URL opened in a browser would run with the session cookie.
- **Serve overlays from `localhost` and the dashboard from `127.0.0.1`:** two sites, so the cookie isn't sent, but fragile: `localhost` resolution varies, users mix the two, and generated URLs must use `127.0.0.1` (Phase 1).
- **A per-widget token in overlay URLs:** adds nothing on 127.0.0.1, where other websites are already stopped by the Host and Origin checks, and makes URLs longer. It comes with LAN mode.

## Consequences

- Overlay code can't use the dashboard API, cookies, `localStorage` or `IndexedDB`. Persistent state belongs to the plugin backend. The plugin docs say so.
- Anyone who knows a widget ID could connect to its overlay socket from a sandboxed page: they would receive its settings (which hold no secrets) and actions, and could answer them. IDs are random and appear only in OBS, the dashboard and logs.
- Some embedded browsers block requests from opaque origins. Overlays are tested in Chromium (OBS uses CEF).
