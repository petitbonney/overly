import {
  type ApiErrorBody,
  CreateWidgetBodySchema,
  formatIssues,
  type PluginInfo,
  type PluginManifest,
  RunActionBodySchema,
  UpdateWidgetBodySchema,
  type WidgetTypeDecl,
  type WidgetTypeInfo,
  widgetTypeRef,
} from '@overly/shared';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import type { z } from 'zod';

import type { PluginEntry, PluginRegistry } from '../plugins/registry.js';
import { type WidgetService, WidgetServiceError } from '../widgets/service.js';

function iconUrl(pluginId: string, path: string | undefined): string | null {
  return path === undefined ? null : `/plugins/${pluginId}/${path}`;
}

function widgetTypeInfo(manifest: PluginManifest, decl: WidgetTypeDecl): WidgetTypeInfo {
  return {
    type: widgetTypeRef(manifest.id, decl.type),
    pluginId: manifest.id,
    name: decl.name,
    ...(decl.description === undefined ? {} : { description: decl.description }),
    iconUrl: iconUrl(manifest.id, decl.icon ?? manifest.icon),
    settings: decl.settings,
    overlay:
      decl.overlay === undefined
        ? null
        : { width: decl.overlay.width, height: decl.overlay.height },
    actions: decl.actions.map((action) => ({
      name: action.name,
      title: action.title,
      ...(action.description === undefined ? {} : { description: action.description }),
      params: action.params,
      sample: action.sample,
      queued: action.queued,
    })),
    events: decl.events.map((event) => ({
      name: event.name,
      title: event.title,
      ...(event.description === undefined ? {} : { description: event.description }),
      payload: event.payload,
      sample: event.sample,
    })),
  };
}

function pluginInfo(entry: PluginEntry): PluginInfo {
  const { manifest } = entry;
  const ok = entry.status === 'ok' && manifest !== undefined;
  return {
    id: entry.id ?? null,
    folder: entry.folder,
    name: entry.name,
    version: entry.version ?? null,
    ...(manifest?.description === undefined ? {} : { description: manifest.description }),
    ...(manifest?.author === undefined ? {} : { author: manifest.author }),
    iconUrl: ok ? iconUrl(manifest.id, manifest.icon) : null,
    status: entry.status,
    errors: entry.errors,
    widgetTypes: ok ? manifest.widgets.map((decl) => widgetTypeInfo(manifest, decl)) : [],
  };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new WidgetServiceError(
      400,
      'invalid_body',
      'The request body is invalid',
      formatIssues(result.error),
    );
  }
  return result.data;
}

function sendError(reply: FastifyReply, error: WidgetServiceError): FastifyReply {
  const body: ApiErrorBody = {
    error: error.code,
    ...(error.detail === undefined ? {} : { message: error.detail }),
    ...(error.issues === undefined ? {} : { issues: error.issues }),
  };
  return reply.code(error.status).send(body);
}

interface IdParams {
  id: string;
}

/** `/api/plugins` and `/api/widgets…` (spec section 2, HTTP API). The guard checks the session. */
export async function registerWidgetRoutes(
  app: FastifyInstance,
  options: { widgets: WidgetService; registry: PluginRegistry },
): Promise<void> {
  const { widgets, registry } = options;

  await app.register((scope, _opts, done) => {
    scope.setErrorHandler((error: FastifyError, request, reply) => {
      if (error instanceof WidgetServiceError) return sendError(reply, error);
      // Fastify's own body errors (invalid JSON, wrong content type, too large).
      if (error.statusCode !== undefined && error.statusCode < 500) {
        return reply.code(error.statusCode).send({ error: 'invalid_body', message: error.message });
      }
      request.log.error({ err: error }, 'Widget API request failed');
      return reply.code(500).send({ error: 'internal_error' });
    });

    scope.get('/api/plugins', () => ({ plugins: registry.plugins().map(pluginInfo) }));

    scope.get('/api/widgets', () => ({ widgets: widgets.list() }));

    scope.post('/api/widgets', async (request, reply) => {
      const detail = await widgets.create(parseBody(CreateWidgetBodySchema, request.body));
      return reply.code(201).send(detail);
    });

    scope.get<{ Params: IdParams }>('/api/widgets/:id', (request) =>
      widgets.detail(request.params.id),
    );

    scope.patch<{ Params: IdParams }>('/api/widgets/:id', (request) =>
      widgets.update(request.params.id, parseBody(UpdateWidgetBodySchema, request.body)),
    );

    scope.delete<{ Params: IdParams }>('/api/widgets/:id', async (request, reply) => {
      await widgets.delete(request.params.id);
      return reply.code(204).send();
    });

    scope.post<{ Params: IdParams }>('/api/widgets/:id/duplicate', async (request, reply) => {
      const detail = await widgets.duplicate(request.params.id);
      return reply.code(201).send(detail);
    });

    scope.post<{ Params: IdParams & { action: string } }>(
      '/api/widgets/:id/actions/:action',
      async (request, reply) => {
        const body = parseBody(RunActionBodySchema, request.body);
        const started = await widgets.runAction(request.params.id, request.params.action, body);
        return reply.code(202).send(started);
      },
    );

    done();
  });
}
