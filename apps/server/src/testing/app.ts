import { randomBytes } from 'node:crypto';

import { OVERLY_VERSION } from '@overly/shared';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';

import { type AppDeps, buildApp } from '../http/app.js';
import { OneTimeTokens } from '../security/tokens.js';

export const TEST_PORT = 6859;
export const TEST_HOST = `127.0.0.1:${String(TEST_PORT)}`;
export const TEST_ORIGIN = `http://${TEST_HOST}`;

export interface TestApp {
  app: FastifyInstance;
  tokens: OneTimeTokens;
  deps: AppDeps;
}

/** An app on port 6859 with a random session key and a silent logger. */
export async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<TestApp> {
  const deps: AppDeps = {
    logger: pino({ level: 'silent' }),
    version: OVERLY_VERSION,
    getPort: () => TEST_PORT,
    devOrigins: [],
    sessionKey: randomBytes(32),
    tokens: new OneTimeTokens(),
    dashboardDir: undefined,
    ...overrides,
  };
  const app = await buildApp(deps);
  return { app, tokens: deps.tokens, deps };
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
