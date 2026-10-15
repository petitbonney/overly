/**
 * Content-Security-Policy of dashboard pages. Mantine needs inline styles; `ws://<host>` lets
 * the page reach its own WebSocket in browsers where 'self' doesn't cover ws:.
 */
export function dashboardCsp(host: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' ws://${host}`,
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Content-Security-Policy of overlay pages (ADR 0014): `sandbox allow-scripts` runs them in an
 * opaque origin everywhere, so overlay code never uses the dashboard session. Only the
 * dashboard may frame them, for its preview.
 */
export function overlayCsp(frameAncestors: readonly string[]): string {
  return `sandbox allow-scripts; frame-ancestors ${frameAncestors.join(' ')}`;
}
