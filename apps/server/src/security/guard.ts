import type { ApiErrorCode } from '@overly/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  type Allowlist,
  isOverlaySocketPath,
  requiresOrigin,
  requiresSession,
} from './allowlist.js';
import { isSessionValueFresh, SESSION_COOKIE } from './session.js';

function reject(reply: FastifyReply, status: number, error: ApiErrorCode): FastifyReply {
  return reply.code(status).send({ error });
}

/** The path without its query string, as the router sees it (percent-decoded). */
export function requestPath(request: FastifyRequest): string {
  const raw = request.url.split('?')[0] ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function hasValidSession(request: FastifyRequest, now: number): boolean {
  const raw = request.cookies[SESSION_COOKIE];
  if (raw === undefined) return false;
  const result = request.unsignCookie(raw);
  return result.valid && isSessionValueFresh(result.value, now);
}

/**
 * Global checks that run before every route, the 404 handler and WebSocket upgrades:
 * Host allowlist (DNS rebinding), Origin on state-changing requests (CSRF), and the session.
 */
export function registerGuard(
  app: FastifyInstance,
  options: { allowlist: Allowlist; now: () => number },
): void {
  const { allowlist, now } = options;

  app.addHook('onRequest', async (request, reply) => {
    if (!allowlist.isAllowedHost(request.headers.host)) {
      return reject(reply, 403, 'forbidden_host');
    }
    const isUpgrade = request.headers.upgrade?.toLowerCase() === 'websocket';
    // Sandboxed overlay pages have an opaque origin: their socket upgrade says `Origin: null`.
    const opaqueOverlay =
      isUpgrade && request.headers.origin === 'null' && isOverlaySocketPath(requestPath(request));
    if (
      requiresOrigin(request.method, isUpgrade) &&
      !opaqueOverlay &&
      !allowlist.isAllowedOrigin(request.headers.origin)
    ) {
      return reject(reply, 403, 'forbidden_origin');
    }
    // Check both the matched route and the decoded path, so an encoded path can't skip the check.
    const route = request.routeOptions.url;
    const needsSession =
      (route !== undefined && requiresSession(route)) || requiresSession(requestPath(request));
    if (needsSession && !hasValidSession(request, now())) {
      return reject(reply, 401, 'no_session');
    }
    return undefined;
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
  });
}
