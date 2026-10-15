import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, posix } from 'node:path';

import type { FastifyInstance, FastifyReply } from 'fastify';

import type { PluginRegistry } from '../plugins/registry.js';
import type { Allowlist } from '../security/allowlist.js';
import type { WidgetService } from '../widgets/service.js';
import { overlayCsp } from './csp.js';

export const SDK_NOT_BUILT =
  'The overlay SDK is not built. Run "bun run build", or use "bun run dev", which builds it.';

const NOT_FOUND_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Overlay not found</title>' +
  '<p>This overlay does not exist. Copy its URL again from the Overly dashboard.</p>';

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Adds `<base href>` (so the plugin's relative URLs reach its public files) and the overlay SDK
 * (so `window.overly` exists before the plugin's scripts) right after `<head>`. Without a head,
 * they go after the doctype, so the page stays in standards mode.
 */
export function injectOverlayHead(html: string, baseHref: string): string {
  const tags = `<base href="${escapeAttribute(baseHref)}"><script src="/sdk/overlay.js"></script>`;
  const anchor = /<head(?:\s[^>]*)?>/i.exec(html) ?? /^\s*<!doctype[^>]*>/i.exec(html);
  if (anchor === null) return tags + html;
  const at = anchor.index + anchor[0].length;
  return html.slice(0, at) + tags + html.slice(at);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function notFoundPage(reply: FastifyReply): FastifyReply {
  return reply.code(404).type('text/html; charset=utf-8').send(NOT_FOUND_PAGE);
}

/**
 * Routes without a session, for OBS and the dashboard preview: overlay pages at /o/<id>, the
 * public files of plugins at /plugins/<pluginId>/…, and the overlay SDK at /sdk/overlay.js.
 */
export function registerOverlayRoutes(
  app: FastifyInstance,
  options: {
    widgets: WidgetService;
    registry: PluginRegistry;
    overlaySdkPath: string | undefined;
    allowlist: Allowlist;
  },
): void {
  const { widgets, registry, overlaySdkPath, allowlist } = options;

  app.get<{ Params: { widgetId: string } }>('/o/:widgetId', async (request, reply) => {
    const { widgetId } = request.params;
    const type = widgets.has(widgetId) ? widgets.typeOf(widgetId) : undefined;
    const overlay = type?.decl.overlay;
    if (type === undefined || overlay === undefined) return notFoundPage(reply);
    const file = await registry.publicFile(type.pluginId, overlay.entry);
    if (file === undefined) return notFoundPage(reply);
    const folder = posix
      .dirname(overlay.entry)
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const html = injectOverlayHead(
      await readFile(file, 'utf8'),
      `/plugins/${encodeURIComponent(type.pluginId)}/${folder}/`,
    );
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', overlayCsp(allowlist.allowedOrigins()))
      .send(html);
  });

  app.get<{ Params: { pluginId: string; '*': string } }>(
    '/plugins/:pluginId/*',
    async (request, reply) => {
      const file = await registry.publicFile(request.params.pluginId, request.params['*']);
      if (file === undefined) return reply.code(404).send({ error: 'not_found' });
      return reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Cache-Control', 'no-cache')
        .sendFile(basename(file), dirname(file), { cacheControl: false });
    },
  );

  app.get('/sdk/overlay.js', async (_request, reply) => {
    if (overlaySdkPath === undefined || !(await isFile(overlaySdkPath))) {
      return reply.code(404).type('text/plain; charset=utf-8').send(SDK_NOT_BUILT);
    }
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'no-cache')
      .sendFile(basename(overlaySdkPath), dirname(overlaySdkPath), { cacheControl: false });
  });
}
