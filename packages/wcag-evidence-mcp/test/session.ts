// A test client that sends raw JSON-RPC messages to the server over the SDK's in-memory link,
// in either protocol era. The link passes message objects as they are, with no serialization
// or framing; the stdio test covers those.

import {
  InMemoryTransport,
  PROTOCOL_VERSION_META_KEY,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';
import type { ServerDependencies } from '../src/adapters/mcp/factory.ts';
import { serve } from '../src/adapters/mcp/serve.ts';
import type { ServerIdentity } from '../src/core/identity.ts';
import { createBrowserDouble, createRuleEngineDouble } from './browser-double.ts';

export const IDENTITY: ServerIdentity = { name: 'test-server', version: '1.2.3' };
export const MODERN_VERSION = '2026-07-28';
export type Era = 'legacy' | 'modern';

const CLIENT_INFO = { name: 'test-client', version: '0.0.0' };

/** A JSON-RPC response: `result` on success, `error` on failure. */
export interface Response {
  id: string | number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export interface Session {
  /** Sends a request the way the session's era does and waits for its response. */
  request(method: string, params?: Record<string, unknown>): Promise<Response>;
  /** Every line the server logged. */
  readonly logs: readonly string[];
  close(): Promise<void>;
}

function isResponse(message: JSONRPCMessage): message is JSONRPCMessage & Response {
  return 'id' in message && ('result' in message || 'error' in message);
}

/**
 * Opens one connection to the server. A legacy session opens with the 2025 `initialize`
 * handshake for `version`; a modern session sends each request with the 2026-07-28 `_meta`
 * envelope. The browser and the rule engine are doubles unless `ports` gives others.
 */
export async function openSession(
  era: Era,
  version = MODERN_VERSION,
  ports: Partial<Pick<ServerDependencies, 'browser' | 'ruleEngine'>> = {},
): Promise<Session> {
  const [client, server] = InMemoryTransport.createLinkedPair();
  const logs: string[] = [];
  const handle = serve({
    identity: IDENTITY,
    log: (line) => logs.push(line),
    browser: ports.browser ?? createBrowserDouble(),
    ruleEngine: ports.ruleEngine ?? createRuleEngineDouble(),
    transport: server,
  });
  const waiting = new Map<string | number, (response: Response) => void>();
  client.onmessage = (message) => {
    if (isResponse(message)) waiting.get(message.id)?.(message);
  };
  await client.start();
  let nextId = 0;

  const send = (method: string, params: Record<string, unknown> | undefined): Promise<Response> => {
    const id = ++nextId;
    const answered = new Promise<Response>((resolve) => waiting.set(id, resolve));
    const message = params === undefined ? { method } : { method, params };
    void client.send({ jsonrpc: '2.0', id, ...message });
    return answered;
  };

  if (era === 'legacy') {
    const opened = await send('initialize', {
      protocolVersion: version,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    if (opened.error !== undefined) throw new Error(`initialize failed: ${opened.error.message}`);
    await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  return {
    logs,
    request: (method, params) =>
      era === 'legacy'
        ? send(method, params)
        : send(method, {
            ...params,
            _meta: {
              [PROTOCOL_VERSION_META_KEY]: version,
              'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          }),
    close: () => handle.close(),
  };
}
