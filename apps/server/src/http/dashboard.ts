import { stat } from 'node:fs/promises';

import fastifyStatic from '@fastify/static';
import type { ApiErrorCode } from '@overly/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { requestPath } from '../security/guard.js';
import { dashboardCsp } from './csp.js';

/** Paths that never fall back to the dashboard page: API, WebSocket, overlays and assets. */
export const RESERVED_PREFIXES = ['/api/', '/ws', '/o/', '/assets/', '/plugins/', '/sdk/'] as const;

export const DASHBOARD_NOT_BUILT =
  'The dashboard isn\'t built. Run "bun run build", or use the Vite dev server ("bun run dev").';

const notFound: { error: ApiErrorCode } = { error: 'not_found' };

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function wantsPage(request: FastifyRequest): boolean {
  const path = requestPath(request);
  return (
    request.method === 'GET' &&
    (request.headers.accept ?? '').includes('text/html') &&
    !RESERVED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))
  );
}

function pageHeaders(reply: FastifyReply): FastifyReply {
  return reply
    .header('X-Frame-Options', 'DENY')
    .header('Content-Security-Policy', dashboardCsp(reply.request.headers.host ?? ''));
}

function sendPage(reply: FastifyReply, dashboardDir: string): FastifyReply {
  return pageHeaders(reply).sendFile('index.html', dashboardDir);
}

/**
 * Serves the dashboard build. Client routes (`/widgets/abc`) get `index.html` when the browser
 * asks for a page; anything else that doesn't exist is a JSON 404.
 */
export async function registerDashboard(
  app: FastifyInstance,
  options: { dashboardDir: string | undefined },
): Promise<void> {
  const { dashboardDir } = options;

  if (dashboardDir === undefined || !(await isDirectory(dashboardDir))) {
    app.get('/', (_request, reply) =>
      reply.type('text/plain; charset=utf-8').send(DASHBOARD_NOT_BUILT),
    );
    app.setNotFoundHandler((_request, reply) => reply.code(404).send(notFound));
    return;
  }

  await app.register(fastifyStatic, {
    root: dashboardDir,
    wildcard: true,
    index: false,
    // registerStatic decorates reply.sendFile once for the whole app.
    decorateReply: false,
    setHeaders: (reply, path) => {
      if (path.endsWith('.html')) pageHeaders(reply);
    },
  });
  app.get('/', (_request, reply) => sendPage(reply, dashboardDir));
  app.setNotFoundHandler((request, reply) =>
    wantsPage(request) ? sendPage(reply, dashboardDir) : reply.code(404).send(notFound),
  );
}
