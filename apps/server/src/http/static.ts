import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Registers @fastify/static once, without routes, for `reply.sendFile(file, root)` (range
 * requests, ETags, content types). Every caller passes its own root; other instances use
 * `decorateReply: false`.
 */
export async function registerStatic(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, { root, serve: false });
}
