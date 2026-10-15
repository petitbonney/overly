import type { IncomingMessage } from 'node:http';

import { type AssetKind, AssetKindSchema, type AssetsResponse } from '@overly/shared';
import type { FastifyInstance } from 'fastify';

import { AssetError, type AssetStore } from '../assets/store.js';

/** An SVG opened directly from /assets/ runs no script on Overly's origin. */
export const ASSET_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
const ONE_YEAR_MS = 31_536_000_000;

/** `?kind=image&kind=audio` or `?kind=image,audio`; `undefined` for all kinds. */
function parseKinds(value: unknown): AssetKind[] | 'invalid' | undefined {
  if (value === undefined) return undefined;
  const raw = (Array.isArray(value) ? value : [value]).flatMap((item) =>
    typeof item === 'string' ? item.split(',') : [''],
  );
  const kinds: AssetKind[] = [];
  for (const item of raw) {
    const parsed = AssetKindSchema.safeParse(item.trim());
    if (!parsed.success) return 'invalid';
    kinds.push(parsed.data);
  }
  return kinds;
}

/**
 * The asset library: upload, list and delete under /api/assets (session and Origin checked by
 * the guard), and the files themselves at /assets/<id> for overlays, which have no session.
 */
export async function registerAssetRoutes(
  app: FastifyInstance,
  options: { assets: AssetStore },
): Promise<void> {
  const { assets } = options;

  await app.register((scope, _opts, done) => {
    // The upload body is the raw file, streamed to disk: no parser, whatever the content type.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, parsed) => {
      parsed(null, payload);
    });

    scope.post<{ Querystring: { name?: string } }>('/api/assets', async (request, reply) => {
      const { name } = request.query;
      const body = (request.body ?? request.raw) as IncomingMessage;
      if (typeof name !== 'string' || name === '') {
        body.resume();
        return reply
          .code(400)
          .send({ error: 'invalid_body', message: 'The ?name= parameter is missing.' });
      }
      try {
        const { asset, created } = await assets.add(name, body);
        return await reply.code(created ? 201 : 200).send(asset);
      } catch (error) {
        if (error instanceof AssetError) {
          return reply.code(error.status).send({ error: error.code, message: error.message });
        }
        throw error;
      }
    });
    done();
  });

  app.get<{ Querystring: { kind?: string | string[] } }>('/api/assets', (request, reply) => {
    const kinds = parseKinds(request.query.kind);
    if (kinds === 'invalid') {
      return reply.code(400).send({ error: 'invalid_body', message: 'Unknown asset kind.' });
    }
    const body: AssetsResponse = { assets: assets.list(kinds) };
    return reply.send(body);
  });

  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    if (!(await assets.delete(request.params.id))) {
      return reply.code(404).send({ error: 'asset_not_found' });
    }
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/assets/:id', (request, reply) => {
    const asset = assets.get(request.params.id);
    if (asset === undefined) return reply.code(404).send({ error: 'asset_not_found' });
    return reply
      .header('Content-Type', asset.mime)
      .header('Access-Control-Allow-Origin', '*')
      .header('Content-Security-Policy', ASSET_CSP)
      .sendFile(assets.fileName(asset), assets.dir, { maxAge: ONE_YEAR_MS, immutable: true });
  });
}
