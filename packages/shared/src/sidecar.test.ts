import { describe, expect, it } from 'vitest';

import {
  DashboardUrlResultSchema,
  FATAL_CODES,
  FatalParamsSchema,
  JSON_RPC_ERRORS,
  JsonRpcMessageSchema,
  ReadyParamsSchema,
  SidecarMethod,
} from './sidecar.js';

describe('JSON-RPC messages', () => {
  it('keeps the id of a request and has none on a notification', () => {
    expect(
      JsonRpcMessageSchema.parse({ jsonrpc: '2.0', id: 1, method: 'shutdown' }),
    ).toHaveProperty('id', 1);
    expect(
      JsonRpcMessageSchema.parse({ jsonrpc: '2.0', method: 'ready', params: {} }),
    ).not.toHaveProperty('id');
  });

  it('parses success and error responses', () => {
    expect(JsonRpcMessageSchema.parse({ jsonrpc: '2.0', id: 2, result: {} })).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: {},
    });
    expect(
      JsonRpcMessageSchema.parse({
        jsonrpc: '2.0',
        id: null,
        error: { code: JSON_RPC_ERRORS.parseError, message: 'Parse error' },
      }),
    ).toHaveProperty('error.code', -32700);
  });

  it('rejects a message without jsonrpc 2.0', () => {
    expect(JsonRpcMessageSchema.safeParse({ id: 1, method: 'x' }).success).toBe(false);
    expect(JsonRpcMessageSchema.safeParse({ jsonrpc: '1.0', id: 1, method: 'x' }).success).toBe(
      false,
    );
  });

  it('uses the standard error codes', () => {
    expect(JSON_RPC_ERRORS).toEqual({
      parseError: -32700,
      invalidRequest: -32600,
      methodNotFound: -32601,
      invalidParams: -32602,
      internalError: -32603,
    });
  });
});

describe('sidecar methods', () => {
  it('names the four methods', () => {
    expect(SidecarMethod).toEqual({
      ready: 'ready',
      fatal: 'fatal',
      getDashboardUrl: 'getDashboardUrl',
      shutdown: 'shutdown',
    });
  });

  it('accepts every fatal code and rejects others', () => {
    for (const code of FATAL_CODES) {
      expect(FatalParamsSchema.parse({ code, message: 'm' }).code).toBe(code);
    }
    expect(FatalParamsSchema.safeParse({ code: 'oops', message: 'm' }).success).toBe(false);
  });

  it('validates ready params and dashboard URLs', () => {
    expect(ReadyParamsSchema.parse({ port: 6859, version: '0.0.0' })).toEqual({
      port: 6859,
      version: '0.0.0',
    });
    expect(ReadyParamsSchema.safeParse({ port: 0, version: '0.0.0' }).success).toBe(false);
    expect(DashboardUrlResultSchema.safeParse({ url: 'not a url' }).success).toBe(false);
  });
});
