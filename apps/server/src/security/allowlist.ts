export interface Allowlist {
  isAllowedHost(host: string | undefined): boolean;
  isAllowedOrigin(origin: string | undefined): boolean;
  /** The origins the dashboard runs on, for `frame-ancestors` of overlay pages. */
  allowedOrigins(): string[];
}

/**
 * Hosts and origins the server answers to. Checking Host blocks DNS rebinding; checking Origin
 * blocks other websites open in the same browser. `getPort` is read on every call because the
 * port is only known once the server listens.
 */
export function createAllowlist(getPort: () => number, devOrigins: readonly string[]): Allowlist {
  const dev = devOrigins.map((origin) => origin.toLowerCase());
  return {
    isAllowedHost(host) {
      if (host === undefined) return false;
      const port = String(getPort());
      const normalized = host.toLowerCase();
      return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}`;
    },
    isAllowedOrigin(origin) {
      if (origin === undefined) return false;
      const port = String(getPort());
      const normalized = origin.toLowerCase();
      return (
        normalized === `http://127.0.0.1:${port}` ||
        normalized === `http://localhost:${port}` ||
        dev.includes(normalized)
      );
    },
    allowedOrigins() {
      const port = String(getPort());
      return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...devOrigins];
    },
  };
}

/** `/o/<widgetId>/ws`: the overlay socket, whose upgrade may come from `Origin: null`. */
export function isOverlaySocketPath(pathname: string): boolean {
  return /^\/o\/[a-z0-9]{12}\/ws$/.test(pathname);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Requests that need a dashboard session: the API (except health) and the WebSocket. */
export function requiresSession(pathname: string): boolean {
  if (pathname === '/ws') return true;
  return pathname.startsWith('/api/') && pathname !== '/api/health';
}

/** Requests that need an allowed Origin: anything that can change state, and WebSocket upgrades. */
export function requiresOrigin(method: string, isUpgrade: boolean): boolean {
  return isUpgrade || !SAFE_METHODS.has(method.toUpperCase());
}
