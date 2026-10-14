import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type pino from 'pino';

import { createAllowlist } from '../security/allowlist.js';
import { registerGuard } from '../security/guard.js';
import type { OneTimeTokens } from '../security/tokens.js';
import { registerWebSocket, registerWebSocketPlugin, type WsHub } from '../ws/hub.js';
import { registerDashboard } from './dashboard.js';
import { registerApiRoutes, registerSessionExchange } from './routes.js';

export interface AppDeps {
  logger: pino.Logger;
  version: string;
  /** The port the server listens on, read per request (it is only known after listen). */
  getPort: () => number;
  /** Extra allowed origins, only set by `bun run dev`. */
  devOrigins: readonly string[];
  sessionKey: Buffer;
  tokens: OneTimeTokens;
  dashboardDir: string | undefined;
  now?: () => number;
  /** WebSocket ping interval, shortened by tests. */
  wsPingIntervalMs?: number;
}

export interface BuiltApp {
  app: FastifyInstance;
  hub: WsHub;
}

export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
  const now = deps.now ?? Date.now;
  // Typed as the base logger so the instance keeps the default FastifyInstance type.
  const loggerInstance: FastifyBaseLogger = deps.logger;
  const app = Fastify({ loggerInstance });

  await app.register(fastifyCookie, { secret: deps.sessionKey });
  await registerWebSocketPlugin(app);
  registerGuard(app, { allowlist: createAllowlist(deps.getPort, deps.devOrigins), now });
  registerSessionExchange(app, { tokens: deps.tokens, now });
  registerApiRoutes(app, { version: deps.version });
  const hub = registerWebSocket(app, {
    version: deps.version,
    ...(deps.wsPingIntervalMs === undefined ? {} : { pingIntervalMs: deps.wsPingIntervalMs }),
  });
  await registerDashboard(app, { dashboardDir: deps.dashboardDir });

  return { app, hub };
}
