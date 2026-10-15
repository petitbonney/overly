import { randomBytes } from 'node:crypto';

import { OVERLY_VERSION } from '@overly/shared';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';

import { type AppDeps, buildApp } from '../http/app.js';
import { OneTimeTokens } from '../security/tokens.js';
import type { WsHub } from '../ws/hub.js';
import { createTestServices, type TestServices } from './services.js';

export const TEST_PORT = 6859;
export const TEST_HOST = `127.0.0.1:${String(TEST_PORT)}`;
export const TEST_ORIGIN = `http://${TEST_HOST}`;

export interface TestApp {
  app: FastifyInstance;
  hub: WsHub;
  tokens: OneTimeTokens;
  deps: AppDeps;
  services: TestServices;
}

/**
 * An app on port 6859 (or `overrides.getPort`) with a random session key, a silent logger, and
 * real widget services built from the fixture plugin (see `createTestServices`).
 */
export async function buildTestApp(
  overrides: Partial<AppDeps> = {},
  servicesOptions: Parameters<typeof createTestServices>[0] = {},
): Promise<TestApp> {
  const getPort = overrides.getPort ?? (() => TEST_PORT);
  // The services broadcast through the hub, which buildApp creates afterwards.
  const ref: { hub?: WsHub } = {};
  const services = await createTestServices({
    ...servicesOptions,
    notify: (message) => {
      ref.hub?.broadcast(message);
    },
    overlayBaseUrl: () => `http://127.0.0.1:${String(getPort())}`,
  });
  const deps: AppDeps = {
    logger: pino({ level: 'silent' }),
    version: OVERLY_VERSION,
    getPort,
    devOrigins: [],
    sessionKey: randomBytes(32),
    tokens: new OneTimeTokens(),
    dashboardDir: undefined,
    widgets: services.service,
    registry: services.registry,
    assets: services.assets,
    overlays: services.overlays,
    overlaySdkPath: undefined,
    ...overrides,
  };
  const { app, hub } = await buildApp(deps);
  ref.hub = hub;
  return { app, hub, tokens: deps.tokens, deps, services };
}

/** Runs the token exchange and returns a `name=value` header for later requests. */
export async function sessionCookie(
  app: FastifyInstance,
  tokens: OneTimeTokens,
  host = TEST_HOST,
): Promise<string> {
  const res = await app.inject({ url: `/?t=${tokens.issue()}`, headers: { host } });
  const header = res.headers['set-cookie'];
  const first = Array.isArray(header) ? header[0] : header;
  if (first === undefined) throw new Error(`no session cookie (status ${String(res.statusCode)})`);
  return first.split(';')[0] ?? '';
}
