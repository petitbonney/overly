import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { AssetSchema } from '@overly/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  sessionCookie,
  TEST_HOST,
  TEST_ORIGIN,
  type TestApp,
} from '../testing/app.js';

const host = TEST_HOST;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const ASSET_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
let running: TestApp | undefined;

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

async function setup(options: Parameters<typeof buildTestApp>[1] = {}) {
  let tick = 0;
  const test = await buildTestApp(
    {},
    { now: () => new Date(Date.UTC(2026, 9, 15, 9, 0, tick++)), ...options },
  );
  running = test;
  const cookie = await sessionCookie(test.app, test.tokens);
  const assetsDir = join(test.services.dataDir, 'assets');
  const upload = (
    name: string,
    body: Buffer,
    contentType: string | null = 'application/octet-stream',
  ) =>
    test.app.inject({
      method: 'POST',
      url: `/api/assets?name=${encodeURIComponent(name)}`,
      headers: {
        host,
        cookie,
        origin: TEST_ORIGIN,
        ...(contentType === null ? {} : { 'content-type': contentType }),
      },
      payload: body,
    });
  return { ...test, cookie, upload, assetsDir };
}

describe('asset routes', () => {
  it('uploads a PNG and serves it without a session', async () => {
    const { app, upload } = await setup();
    const res = await upload('logo.png', PNG, 'image/png');
    expect(res.statusCode).toBe(201);
    const asset = AssetSchema.parse(res.json());
    expect(asset).toMatchObject({ name: 'logo.png', kind: 'image', mime: 'image/png', size: 16 });

    const served = await app.inject({ url: `/assets/${asset.id}`, headers: { host } });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['access-control-allow-origin']).toBe('*');
    expect(served.headers['content-security-policy']).toBe(ASSET_CSP);
    expect(served.rawPayload.equals(PNG)).toBe(true);
  });

  it('accepts an upload without a content type', async () => {
    const { upload } = await setup();
    expect((await upload('voice.opus', Buffer.from('OggS'), null)).statusCode).toBe(201);
  });

  it('returns the existing asset for identical bytes', async () => {
    const { upload, assetsDir } = await setup();
    const first = (await upload('a.png', PNG)).json<{ id: string }>();
    const second = await upload('b.png', PNG);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ id: string }>().id).toBe(first.id);
    expect((await readdir(assetsDir)).sort()).toEqual([`${first.id}.png`, 'index.json'].sort());
  });

  it('rejects unsupported types with 415 and leaves no file', async () => {
    const { upload, assetsDir } = await setup();
    const res = await upload('setup.exe', PNG);
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ error: 'unsupported_asset_type' });
    expect(await readdir(assetsDir)).toEqual(['index.json']);
  });

  it('rejects files over the limit with 413 and leaves no temp file', async () => {
    const { upload, assetsDir } = await setup({ assetMaxBytes: 1024 });
    const res = await upload('big.png', Buffer.alloc(4096));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: 'asset_too_large' });
    expect(await readdir(assetsDir)).toEqual(['index.json']);
  });

  it('rejects an upload without a name', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: { host, cookie, origin: TEST_ORIGIN },
      payload: PNG,
    });
    expect(res.statusCode).toBe(400);
  });

  it('stores odd file names safely', async () => {
    const { upload, assetsDir } = await setup();
    const res = await upload('..\\..\\Mon son É.MP3', Buffer.from('ID3 fake mp3'));
    expect(res.statusCode).toBe(201);
    const asset = AssetSchema.parse(res.json());
    expect(asset).toMatchObject({ name: 'Mon son É.MP3', kind: 'audio', mime: 'audio/mpeg' });
    expect((await readdir(assetsDir)).sort()).toEqual([`${asset.id}.mp3`, 'index.json'].sort());
    const upper = AssetSchema.parse((await upload('ALERT.PNG', PNG)).json());
    expect(upper).toMatchObject({ kind: 'image', name: 'ALERT.PNG' });
  });

  it('lists assets by kind, newest first', async () => {
    const { app, cookie, upload } = await setup();
    const first = (await upload('one.png', Buffer.from('1'))).json<{ id: string }>();
    const sound = (await upload('two.mp3', Buffer.from('2'))).json<{ id: string }>();
    const second = (await upload('three.png', Buffer.from('3'))).json<{ id: string }>();
    const list = async (query: string) =>
      (await app.inject({ url: `/api/assets${query}`, headers: { host, cookie } }))
        .json<{ assets: { id: string }[] }>()
        .assets.map((asset) => asset.id);
    expect(await list('?kind=image')).toEqual([second.id, first.id]);
    expect(await list('?kind=image,audio')).toEqual([second.id, sound.id, first.id]);
    expect(await list('?kind=image&kind=audio')).toEqual([second.id, sound.id, first.id]);
    expect(await list('')).toEqual([second.id, sound.id, first.id]);
    const bad = await app.inject({ url: '/api/assets?kind=pdf', headers: { host, cookie } });
    expect(bad.statusCode).toBe(400);
  });

  it('deletes an asset and its file', async () => {
    const { app, cookie, upload, assetsDir } = await setup();
    const { id } = (await upload('a.png', PNG)).json<{ id: string }>();
    const del = (url: string) =>
      app.inject({ method: 'DELETE', url, headers: { host, cookie, origin: TEST_ORIGIN } });
    expect((await del(`/api/assets/${id}`)).statusCode).toBe(204);
    expect(await readdir(assetsDir)).toEqual(['index.json']);
    expect((await del(`/api/assets/${id}`)).statusCode).toBe(404);
    expect((await app.inject({ url: `/assets/${id}`, headers: { host } })).statusCode).toBe(404);
  });

  it('answers a range request with 206', async () => {
    const { app, upload } = await setup();
    const { id } = (await upload('a.png', PNG)).json<{ id: string }>();
    const res = await app.inject({
      url: `/assets/${id}`,
      headers: { host, range: 'bytes=0-3' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-3/16');
    expect(res.rawPayload.equals(PNG.subarray(0, 4))).toBe(true);
  });

  it('requires the session and Origin for uploads', async () => {
    const { app, cookie } = await setup();
    const noSession = await app.inject({
      method: 'POST',
      url: '/api/assets?name=a.png',
      headers: { host, origin: TEST_ORIGIN },
      payload: PNG,
    });
    expect(noSession.statusCode).toBe(401);
    const noOrigin = await app.inject({
      method: 'POST',
      url: '/api/assets?name=a.png',
      headers: { host, cookie },
      payload: PNG,
    });
    expect(noOrigin.statusCode).toBe(403);
  });
});
