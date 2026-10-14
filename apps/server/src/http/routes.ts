import type { HealthResponse, SessionResponse } from '@overly/shared';
import type { FastifyInstance } from 'fastify';

import { requestPath } from '../security/guard.js';
import {
  createSessionValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '../security/session.js';
import type { OneTimeTokens } from '../security/tokens.js';

/**
 * `GET /?t=<token>`: trade a one-time token from the tray for a session cookie, then redirect to
 * `/` so the token leaves the address bar and the history. Runs as a hook (after the guard) so the
 * dashboard's static route doesn't need to know about tokens.
 */
export function registerSessionExchange(
  app: FastifyInstance,
  options: { tokens: OneTimeTokens; now: () => number },
): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'GET' || requestPath(request) !== '/') return undefined;
    const token = new URLSearchParams(request.url.split('?')[1] ?? '').get('t');
    if (token === null) return undefined;

    if (options.tokens.consume(token)) {
      reply.setCookie(SESSION_COOKIE, createSessionValue(options.now()), {
        signed: true,
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
    }
    return reply.header('Cache-Control', 'no-store').redirect('/', 303);
  });
}

export function registerApiRoutes(app: FastifyInstance, options: { version: string }): void {
  app.get('/api/health', (): HealthResponse => ({ status: 'ok', version: options.version }));
  // The guard already rejected requests without a valid session.
  app.get('/api/session', (): SessionResponse => ({ authenticated: true }));
}
