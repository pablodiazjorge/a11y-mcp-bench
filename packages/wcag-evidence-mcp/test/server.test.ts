// Both protocol eras, served in process: what a client sees when it lists and calls tools.

import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import { createServerFactory } from '../src/adapters/mcp/factory.ts';
import { serve } from '../src/adapters/mcp/serve.ts';
import { createBrowserDouble } from './browser-double.ts';
import { IDENTITY, MODERN_VERSION, openSession, type Era, type Session } from './session.ts';

interface ListedTool {
  name: string;
  title?: string;
  annotations?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

const OUTPUT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The package name of the server' },
    version: { type: 'string', description: 'The package version of the server' },
    protocolVersion: {
      type: 'string',
      description: 'The MCP protocol revision of the current connection',
    },
  },
  required: ['name', 'version', 'protocolVersion'],
  additionalProperties: false,
};

const sessions: Session[] = [];

async function open(era: Era, version: string): Promise<Session> {
  const session = await openSession(era, version);
  sessions.push(session);
  return session;
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

async function listServerInfo(session: Session): Promise<ListedTool> {
  const listed = await session.request('tools/list');
  const tools = (listed.result?.tools ?? []) as ListedTool[];
  const tool = tools.find((candidate) => candidate.name === 'server_info');
  if (tool === undefined) throw new Error(`server_info is not listed: ${JSON.stringify(listed)}`);
  return tool;
}

async function callServerInfo(session: Session, meta?: Record<string, unknown>) {
  const params = { name: 'server_info', arguments: {}, ...(meta && { _meta: meta }) };
  return (await session.request('tools/call', params)).result as ToolResult;
}

// Two 2025 revisions, so that a server reporting one fixed revision fails.
describe.each<[Era, string]>([
  ['legacy', '2025-03-26'],
  ['legacy', '2025-11-25'],
  ['modern', MODERN_VERSION],
])('a %s client on %s', (era, version) => {
  it('lists server_info as a read-only tool with an input and an output schema', async () => {
    const tool = await listServerInfo(await open(era, version));

    expect(tool.title).toBe('Server info');
    expect(tool.annotations).toStrictEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool.inputSchema).toMatchObject({ type: 'object', properties: {} });
    expect(tool.outputSchema).toStrictEqual(OUTPUT_SCHEMA);
  });

  it('gets structured content that matches the listed output schema, and the same JSON as text', async () => {
    const session = await open(era, version);
    const tool = await listServerInfo(session);
    const result = await callServerInfo(session);

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toStrictEqual({ ...IDENTITY, protocolVersion: version });
    const listedSchema = z.fromJSONSchema(tool.outputSchema ?? {});
    expect(listedSchema.safeParse(result.structuredContent).success).toBe(true);

    const texts = (result.content ?? []).filter((block) => block.type === 'text');
    expect(texts).toHaveLength(1);
    expect(JSON.parse(texts[0]?.text ?? 'null')).toStrictEqual(result.structuredContent);
  });

  it('answers an unknown tool with an error', async () => {
    const session = await open(era, version);
    const called = await session.request('tools/call', { name: 'no_such_tool', arguments: {} });

    expect(called.result).toBeUndefined();
    expect(called.error?.code).toBe(-32602);
    expect(called.error?.message).toContain('no_such_tool');
  });

  it('logs the instance it builds for the era', async () => {
    const session = await open(era, version);
    await callServerInfo(session);

    expect(session.logs).toContain('serving MCP over stdio');
    expect(session.logs).toContain(`new server instance for the ${era} protocol era`);
    expect(session.logs).toContain(`server_info called over protocol ${version}`);
  });
});

describe('a legacy client that claims a revision in _meta', () => {
  it('gets the revision agreed in initialize, not the one it claims', async () => {
    const session = await open('legacy', '2025-06-18');
    const result = await callServerInfo(session, {
      'io.modelcontextprotocol/protocolVersion': '2099-01-01',
    });

    expect(result.structuredContent).toMatchObject({ protocolVersion: '2025-06-18' });
    expect(session.logs).not.toContain('server_info called over protocol 2099-01-01');
  });
});

describe('a transport error', () => {
  it('is logged', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const logs: string[] = [];
    const handle = serve({
      identity: IDENTITY,
      browser: createBrowserDouble(),
      log: (line) => logs.push(line),
      transport: new StdioServerTransport(stdin, stdout),
    });
    const logged = new Promise<void>((resolve) => {
      stdout.once('error', () => {
        setImmediate(resolve);
      });
    });

    stdout.emit('error', new Error('broken pipe'));
    await logged;
    await handle.close();

    expect(logs).toContain('error: broken pipe');
  });
});

describe('the server factory', () => {
  it('builds a new instance on each call, as the SDK may discard one', async () => {
    const logs: string[] = [];
    const factory = createServerFactory({
      identity: IDENTITY,
      log: (line) => logs.push(line),
      browser: createBrowserDouble(),
    });

    const first = await factory({ era: 'modern' });
    const second = await factory({ era: 'legacy' });

    expect(first).not.toBe(second);
    expect(logs).toStrictEqual([
      'new server instance for the modern protocol era',
      'new server instance for the legacy protocol era',
    ]);
  });
});
