// Builds the server's tool contract as an MCP client sees it, and the readable reference in
// docs/tools.md from that contract. contract.test.ts checks both files, and `npm run gen` writes
// them through the same test. It talks to the server over MCP, through the SDK's in-memory link,
// so that it needs no build and imports no adapter outside a test (ADR 0004).

import { readPackageIdentity } from '../src/adapters/package-json/read-identity.ts';
import type { BrowserPort, VisitFailure } from '../src/core/browser.ts';
import type { RuleEngine } from '../src/core/rule-engine.ts';
import { createBrowserDouble, pageDouble } from './browser-double.ts';
import { openSession, type Era, type Response, type Session } from './session.ts';

const SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
const LOCAL_PAGE = 'http://localhost:4200/';

/** One error that a client can get, with the request that gives it. */
interface ErrorCase {
  /** The JSON-RPC method, and the tool for `tools/call`. */
  readonly request: string;
  /** When it happens, in a few words. */
  readonly when: string;
  readonly params: Record<string, unknown>;
  /** The browser that the session uses: one that fails in a given way, or the default double. */
  readonly browser?: BrowserPort;
  /** The rule engine that the session uses, when not the default double. */
  readonly ruleEngine?: RuleEngine;
}

function failingBrowser(failure: VisitFailure): BrowserPort {
  return { visit: () => Promise.resolve({ ok: false, failure }), close: () => Promise.resolve() };
}

const auditRoute = (args: Record<string, unknown>) => ({ name: 'audit_route', arguments: args });

// The errors that the reference lists. Each is asked of the running server, so the answer in the
// contract is the server's own. The cases about a page give the session a stand-in browser or rule
// engine that fails in the way the case names; the others use the default stand-ins.
const ERROR_CASES: readonly ErrorCase[] = [
  {
    request: 'tools/call audit_route',
    when: 'The URL fails the URL policy',
    params: auditRoute({ url: 'http://example.com/' }),
  },
  {
    request: 'tools/call audit_route',
    when: 'A criterion is not one of the twelve',
    params: auditRoute({ url: LOCAL_PAGE, criteria: ['2.1.3'] }),
  },
  {
    request: 'tools/call audit_route',
    when: 'The page redirects to a URL that fails the policy',
    params: auditRoute({ url: LOCAL_PAGE }),
    browser: failingBrowser({
      reason: 'url-policy',
      url: 'http://localhost/',
      rejection: 'port-missing',
    }),
  },
  {
    request: 'tools/call audit_route',
    when: 'The page comes from another address',
    params: auditRoute({ url: LOCAL_PAGE }),
    browser: failingBrowser({ reason: 'not-local', address: '192.168.1.10' }),
  },
  {
    request: 'tools/call audit_route',
    when: 'The page does not load',
    params: auditRoute({ url: LOCAL_PAGE }),
    browser: failingBrowser({ reason: 'load-failed', message: 'net::ERR_CONNECTION_REFUSED' }),
  },
  {
    request: 'tools/call audit_route',
    when: 'The page goes to another document during the audit',
    params: auditRoute({ url: LOCAL_PAGE }),
    browser: failingBrowser({ reason: 'navigated' }),
  },
  {
    request: 'tools/call audit_route',
    when: 'The page or the audit takes too long',
    params: auditRoute({ url: LOCAL_PAGE }),
    browser: failingBrowser({ reason: 'timeout' }),
  },
  {
    request: 'tools/call audit_route',
    when: 'The browser cannot start, or closes',
    params: auditRoute({ url: LOCAL_PAGE }),
    browser: failingBrowser({ reason: 'browser-unavailable', message: 'closed' }),
  },
  {
    request: 'tools/call audit_route',
    when: 'The system does not allow the browser its sandbox',
    params: auditRoute({ url: LOCAL_PAGE }),
    browser: failingBrowser({
      reason: 'browser-unavailable',
      message: 'No usable sandbox!',
      sandbox: true,
    }),
  },
  {
    request: 'tools/call audit_route',
    when: 'The result of axe-core cannot be read',
    params: auditRoute({ url: LOCAL_PAGE }),
    browser: createBrowserDouble(pageDouble()),
    ruleEngine: {
      name: 'double',
      run: () => Promise.reject(new Error('unreadable')),
      locate: () => Promise.resolve([]),
    },
  },
  {
    request: 'tools/call explain_criterion',
    when: 'The criterion is not one of the twelve',
    params: { name: 'explain_criterion', arguments: { criterion: '2.1.3' } },
  },
  {
    request: 'resources/read',
    when: 'The URI names none of the twelve criteria',
    params: { uri: 'criterion://2.1.3' },
  },
  {
    request: 'tools/call',
    when: 'The tool does not exist',
    params: { name: 'audit_page', arguments: {} },
  },
];

/** What the server answered, without the fields that the 2026-07-28 era adds to every result. */
function answerOf(response: Response): Record<string, unknown> {
  if (response.error !== undefined) {
    const { code, message, data } = response.error as {
      code: number;
      message: string;
      data?: unknown;
    };
    return { error: { code, message, ...(data === undefined ? {} : { data }) } };
  }
  const { isError, content } = response.result ?? {};
  return { isError, content };
}

async function errorsOf(era: Era, version: string): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const { request, when, params, browser, ruleEngine } of ERROR_CASES) {
    const session = await openSession(era, version, {
      identity: readPackageIdentity(),
      ...(browser === undefined ? {} : { browser }),
      ...(ruleEngine === undefined ? {} : { ruleEngine }),
    });
    try {
      const method = request.split(' ')[0] ?? request;
      errors.push({
        request,
        when,
        params,
        answer: answerOf(await session.request(method, params)),
      });
    } finally {
      await session.close();
    }
  }
  return errors;
}

/**
 * What the server says about itself. A legacy client reads it in the answer to `initialize`; a
 * 2026-07-28 client asks `server/discover`, whose answer gives the name and version in `_meta`.
 */
async function serverOf(session: Session, era: Era): Promise<unknown> {
  const answer =
    era === 'legacy' ? session.initialized : (await session.request('server/discover')).result;
  const meta = answer?._meta as Record<string, unknown> | undefined;
  return {
    capabilities: answer?.capabilities,
    serverInfo: era === 'legacy' ? answer?.serverInfo : meta?.[SERVER_INFO],
    instructions: answer?.instructions ?? null,
  };
}

/**
 * The contract that the server shows a client on `version`: what it says about itself, its
 * prompts, its tools and resource templates with their schemas, annotations and descriptions, and
 * the errors of the cases above. As JSON: the in-memory link passes objects as they are, with keys
 * whose value is `undefined`, which JSON leaves out.
 */
export async function contractOf(era: Era, version: string): Promise<unknown> {
  const session = await openSession(era, version, { identity: readPackageIdentity() });
  try {
    const prompts = await session.request('prompts/list');
    const tools = await session.request('tools/list');
    const templates = await session.request('resources/templates/list');
    return JSON.parse(
      JSON.stringify({
        server: await serverOf(session, era),
        prompts: prompts.result?.prompts ?? { error: prompts.error?.code },
        tools: tools.result?.tools,
        resourceTemplates: templates.result?.resourceTemplates,
        errors: await errorsOf(era, version),
      }),
    ) as unknown;
  } finally {
    await session.close();
  }
}

// The reference in docs/tools.md, written from the contract alone.

interface Schema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
}

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Schema;
  outputSchema?: Schema;
  annotations?: Record<string, unknown>;
}

interface Template {
  name: string;
  uriTemplate: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

interface ListedError {
  request: string;
  when: string;
  params: Record<string, unknown>;
  answer: {
    isError?: boolean;
    content?: { text?: string }[];
    error?: { code: number; message: string; data?: unknown };
  };
}

interface Contract {
  server: {
    capabilities: Record<string, unknown>;
    serverInfo: { name: string; version: string };
    instructions: string | null;
  };
  prompts: unknown;
  tools: ListedTool[];
  resourceTemplates: Template[];
  errors: ListedError[];
}

/** Text for a cell of a Markdown table: one line, with its pipes escaped. */
function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

const code = (text: string): string => `\`${text}\``;

/** The type of a schema in a few words, such as `string or null` or `array of objects`. */
function typeOf(schema: Schema): string {
  if (schema.const !== undefined) return code(JSON.stringify(schema.const));
  if (schema.enum !== undefined)
    return `one of ${schema.enum.map((value) => code(JSON.stringify(value))).join(', ')}`;
  if (schema.oneOf !== undefined)
    return `object, one of ${String(schema.oneOf.length)} kinds below`;
  if (schema.anyOf !== undefined) {
    const kinds = schema.anyOf.filter(({ type }) => type !== 'null').map(typeOf);
    const nullable = schema.anyOf.some(({ type }) => type === 'null');
    return `${kinds.join(' or ')}${nullable ? ' or null' : ''}`;
  }
  if (schema.type === 'array' && schema.items !== undefined) {
    const items = typeOf(schema.items);
    return items === 'object' ? 'array of objects' : `array of ${items}`;
  }
  return Array.isArray(schema.type) ? schema.type.join(' or ') : (schema.type ?? 'any');
}

/** The object schema inside `schema`, if it holds one: itself, its items or its non-null branch. */
function objectIn(schema: Schema): Schema | undefined {
  if (schema.properties !== undefined) return schema;
  if (schema.items !== undefined) return objectIn(schema.items);
  return schema.anyOf?.map(objectIn).find((found) => found !== undefined);
}

/**
 * One row per field of `schema`, its nested fields after it, with their paths. The fields of one
 * kind of a union say which kind in their type, as `number, when kind is "contrast"`.
 */
function rows(schema: Schema, prefix = '', when = ''): string[] {
  const found: string[] = [];
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const path = `${prefix}${name}${field.type === 'array' ? '[]' : ''}`;
    const required = schema.required?.includes(name) === true ? 'yes' : 'no';
    const type = name === 'kind' || when === '' ? typeOf(field) : `${typeOf(field)}, ${when}`;
    found.push(
      `| ${code(path)} | ${cell(type)} | ${required} | ${cell(field.description ?? '')} |`,
    );
    for (const variant of field.oneOf ?? []) {
      const kind = JSON.stringify(variant.properties?.kind?.const);
      found.push(...rows(variant, `${path}.`, `when kind is ${code(kind)}`));
    }
    const inner = field.oneOf === undefined ? objectIn(field) : undefined;
    if (inner !== undefined) found.push(...rows(inner, `${path}.`, when));
  }
  return found;
}

function table(schema: Schema): string[] {
  return [
    '| Field | Type | Required | Description |',
    '| --- | --- | --- | --- |',
    ...rows(schema),
  ];
}

function answerText({ answer }: ListedError): string {
  if (answer.error !== undefined) {
    const { data } = answer.error;
    const withData = data === undefined ? '' : `, with data ${code(JSON.stringify(data))}`;
    return `JSON-RPC error ${String(answer.error.code)}: ${answer.error.message}${withData}`;
  }
  return `Tool result with \`isError\`: ${answer.content?.map(({ text }) => text ?? '').join(' ') ?? ''}`;
}

/** The Markdown of docs/tools.md, from the contract. */
export function renderToolsReference(contract: unknown): string {
  const { server, prompts, tools, resourceTemplates, errors } = contract as Contract;
  const capabilities = Object.entries(server.capabilities).map(
    ([name, value]) => `${code(name)} ${code(JSON.stringify(value))}`,
  );
  const lines = [
    '# Tools of the MCP server',
    '',
    `This reference is generated by \`npm run gen\` from the server's tool contract, [\`packages/wcag-evidence-mcp/tools.contract.json\`](../packages/wcag-evidence-mcp/tools.contract.json), which holds what the server shows an MCP client. A test fails when either file differs from what the server answers, so do not edit this file: change the server and run \`npm run gen\`. [The architecture](architecture.md) explains the server.`,
    '',
    '## The server',
    '',
    `- **Name and version:** ${code(server.serverInfo.name)} ${server.serverInfo.version}.`,
    `- **Capabilities:** ${capabilities.join(', ')}.`,
    `- **Prompts:** ${Array.isArray(prompts) && prompts.length > 0 ? String(prompts.length) : 'none'}.`,
    `- **Instructions:** ${server.instructions ?? 'none'}.`,
  ];
  for (const tool of tools) {
    const annotations = Object.entries(tool.annotations ?? {}).map(
      ([name, value]) => `${code(name)} ${code(JSON.stringify(value))}`,
    );
    lines.push(
      '',
      `## ${code(tool.name)}${tool.title === undefined ? '' : `: ${tool.title}`}`,
      '',
      tool.description ?? '',
      '',
      `**Annotations:** ${annotations.join(', ')}.`,
      '',
      '### Input',
      '',
      ...table(tool.inputSchema),
    );
    if (tool.outputSchema !== undefined)
      lines.push('', '### Output', '', ...table(tool.outputSchema));
  }
  lines.push(
    '',
    '## Resource templates',
    '',
    '| URI template | Name | Title | MIME type | Description |',
    '| --- | --- | --- | --- | --- |',
    ...resourceTemplates.map(
      ({ uriTemplate, name, title, mimeType, description }) =>
        `| ${code(uriTemplate)} | ${code(name)} | ${cell(title ?? '')} | ${code(mimeType ?? '')} | ${cell(description ?? '')} |`,
    ),
    '',
    '## Errors',
    '',
    'What the server answers in each of these cases, asked of the server when the reference was generated. The cases about a page use a stand-in browser or rule engine that fails in the given way. In an answer, the word in parentheses after "refused" is a reason of the URL policy, listed in [ADR 0005](adr/0005-url-policy.md).',
    '',
    '| Request | When | Answer |',
    '| --- | --- | --- |',
    ...errors.map(
      (error) => `| ${code(error.request)} | ${cell(error.when)} | ${cell(answerText(error))} |`,
    ),
    '',
  );
  return lines.join('\n');
}
