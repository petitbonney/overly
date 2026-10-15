import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type pino from 'pino';

import type { AssetStore } from '../assets/store.js';
import type { PluginRegistry } from '../plugins/registry.js';
import { createAllowlist } from '../security/allowlist.js';
import { registerGuard } from '../security/guard.js';
import type { OneTimeTokens } from '../security/tokens.js';
import type { OverlayHub } from '../widgets/overlay-hub.js';
import type { WidgetService } from '../widgets/service.js';
import { registerWebSocket, registerWebSocketPlugin, type WsHub } from '../ws/hub.js';
import { registerOverlaySocket } from '../ws/overlay-socket.js';
import { registerAssetRoutes } from './asset-routes.js';
import { registerDashboard } from './dashboard.js';
import { registerOverlayRoutes } from './overlay-routes.js';
import { registerApiRoutes, registerSessionExchange } from './routes.js';
import { registerStatic } from './static.js';
import { registerWidgetRoutes } from './widget-routes.js';

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
  widgets: WidgetService;
  registry: PluginRegistry;
  assets: AssetStore;
  overlays: OverlayHub;
  /** The built overlay SDK, served at /sdk/overlay.js. */
  overlaySdkPath: string | undefined;
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
  const allowlist = createAllowlist(deps.getPort, deps.devOrigins);
  registerGuard(app, { allowlist, now });
  registerSessionExchange(app, { tokens: deps.tokens, now });
  registerApiRoutes(app, { version: deps.version });
  await registerWidgetRoutes(app, { widgets: deps.widgets, registry: deps.registry });
  await registerStatic(app, deps.assets.dir);
  await registerAssetRoutes(app, { assets: deps.assets });
  registerOverlayRoutes(app, {
    widgets: deps.widgets,
    registry: deps.registry,
    overlaySdkPath: deps.overlaySdkPath,
    allowlist,
  });
  registerOverlaySocket(app, {
    widgets: deps.widgets,
    overlays: deps.overlays,
    ...(deps.wsPingIntervalMs === undefined ? {} : { pingIntervalMs: deps.wsPingIntervalMs }),
  });
  const hub = registerWebSocket(app, {
    version: deps.version,
    ...(deps.wsPingIntervalMs === undefined ? {} : { pingIntervalMs: deps.wsPingIntervalMs }),
  });
  await registerDashboard(app, { dashboardDir: deps.dashboardDir });

  return { app, hub };
}
