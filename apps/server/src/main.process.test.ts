import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { OVERLY_VERSION } from '@overly/shared';
import { afterEach, describe, expect, it } from 'vitest';

// Runs the sidecar as the shell does. By default from source through tsx; set
// OVERLY_SIDECAR_ENTRY to a built server.mjs (relative to the working directory) to test the bundle.
const serverDir = join(import.meta.dirname, '..');
const entry = process.env['OVERLY_SIDECAR_ENTRY'];
const TIMEOUT = 20_000;

interface Sidecar {
  child: ChildProcessWithoutNullStreams;
  next(): Promise<Record<string, unknown>>;
  send(message: unknown): void;
  exited: Promise<number | null>;
}

const running: Sidecar[] = [];

afterEach(() => {
  for (const sidecar of running.splice(0)) sidecar.child.kill();
});

function launch(args: string[]): Sidecar {
  const command =
    entry === undefined ? ['--import', 'tsx', 'src/main.ts'] : [resolve(process.cwd(), entry)];
  const child = spawn(process.execPath, [...command, ...args], { cwd: serverDir });
  const messages: Record<string, unknown>[] = [];
  const waiters: ((message: Record<string, unknown>) => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    // Every stdout line must be JSON-RPC: a stray log line would break the shell.
    const message = JSON.parse(line) as Record<string, unknown>;
    expect(message['jsonrpc']).toBe('2.0');
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else messages.push(message);
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exited = once(child, 'close').then(([code]) => code as number | null);
  // A child that exits before answering fails the test now, with its stderr, instead of timing out.
  const died = exited.then((code) => {
    throw new Error(`sidecar exited with ${String(code)} before answering:\n${stderr}`);
  });
  died.catch(() => undefined);
  const sidecar: Sidecar = {
    child,
    next: () => {
      const queued = messages.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return Promise.race([
        new Promise<Record<string, unknown>>((resolveMessage) => {
          waiters.push(resolveMessage);
        }),
        died,
      ]);
    },
    send: (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    exited,
  };
  running.push(sidecar);
  return sidecar;
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'overly-sidecar-'));
}

/** From source, the plugins and SDK come from the repository; the bundle finds its own. */
async function resourceArgs(): Promise<string[]> {
  if (entry !== undefined) return [];
  const sdk = join(await tempDir(), 'overlay.js');
  await writeFile(sdk, 'window.overly = {};');
  return ['--plugins-dir', join(serverDir, '..', '..', 'plugins'), '--overlay-sdk', sdk];
}

async function sessionCookie(sidecar: Sidecar, id: number): Promise<string> {
  sidecar.send({ jsonrpc: '2.0', id, method: 'getDashboardUrl' });
  const { url } = (await sidecar.next())['result'] as { url: string };
  const exchange = await fetch(url, { redirect: 'manual' });
  return (exchange.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

describe('sidecar process', () => {
  it(
    'starts in RPC mode, opens a session, and exits 0 on shutdown',
    async () => {
      const sidecar = launch(['--rpc', '--port', '0', '--data-dir', await tempDir()]);
      const ready = await sidecar.next();
      expect(ready).toMatchObject({ method: 'ready', params: { version: OVERLY_VERSION } });
      const port = (ready['params'] as { port: number }).port;
      expect(port).toBeGreaterThan(0);

      const health = await fetch(`http://127.0.0.1:${String(port)}/api/health`);
      expect(health.status).toBe(200);

      sidecar.send({ jsonrpc: '2.0', id: 1, method: 'getDashboardUrl' });
      const response = await sidecar.next();
      expect(response).toMatchObject({ id: 1 });
      const url = (response['result'] as { url: string }).url;
      expect(url).toMatch(
        new RegExp(`^http://127\\.0\\.0\\.1:${String(port)}/\\?t=[A-Za-z0-9_-]{43}$`),
      );

      const exchange = await fetch(url, { redirect: 'manual' });
      expect(exchange.status).toBe(303);
      expect(exchange.headers.get('set-cookie')).toContain('overly_session=');

      sidecar.send({ jsonrpc: '2.0', id: 2, method: 'shutdown' });
      expect(await sidecar.next()).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
      expect(await sidecar.exited).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'serves the overlay SDK and lists plugins',
    async () => {
      const sidecar = launch([
        '--rpc',
        '--port',
        '0',
        '--data-dir',
        await tempDir(),
        ...(await resourceArgs()),
      ]);
      const ready = await sidecar.next();
      const port = (ready['params'] as { port: number }).port;
      const base = `http://127.0.0.1:${String(port)}`;

      const sdk = await fetch(`${base}/sdk/overlay.js`);
      expect(sdk.status).toBe(200);
      expect(await sdk.text()).toContain('overly');

      const cookie = await sessionCookie(sidecar, 1);
      const plugins = await fetch(`${base}/api/plugins`, { headers: { cookie } });
      expect(plugins.status).toBe(200);
      const body = (await plugins.json()) as { plugins: { id: string; status: string }[] };
      expect(Array.isArray(body.plugins)).toBe(true);

      sidecar.child.stdin.end();
      expect(await sidecar.exited).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'creates a data directory that does not exist yet',
    async () => {
      const dataDir = join(await tempDir(), 'a', 'b', 'c');
      const sidecar = launch(['--rpc', '--port', '0', '--data-dir', dataDir]);
      expect(await sidecar.next()).toMatchObject({ method: 'ready' });
      await access(join(dataDir, 'settings.json'));
      await access(join(dataDir, 'session.key'));
      expect(
        (await readdir(join(dataDir, 'logs'))).some((file) => /^overly\.\d+\.log$/.test(file)),
      ).toBe(true);
      sidecar.child.stdin.end();
      expect(await sidecar.exited).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'shuts down when stdin closes',
    async () => {
      const sidecar = launch(['--rpc', '--port', '0', '--data-dir', await tempDir()]);
      expect(await sidecar.next()).toMatchObject({ method: 'ready' });
      sidecar.child.stdin.end();
      expect(await sidecar.exited).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'reports port_in_use when the port is taken',
    async () => {
      const blocker = createServer();
      blocker.listen(0, '127.0.0.1');
      await once(blocker, 'listening');
      const port = (blocker.address() as { port: number }).port;
      try {
        const sidecar = launch(['--rpc', '--port', String(port), '--data-dir', await tempDir()]);
        const fatal = await sidecar.next();
        expect(fatal).toMatchObject({ method: 'fatal', params: { code: 'port_in_use' } });
        expect((fatal['params'] as { message: string }).message).toContain(String(port));
        expect(await sidecar.exited).toBe(1);
      } finally {
        blocker.close();
      }
    },
    TIMEOUT,
  );
});
