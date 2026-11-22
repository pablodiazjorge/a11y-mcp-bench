// The criteria over MCP: the resource of each of the twelve, `explain_criterion`, and the link from
// the definitions of an audit to the resources. Each test runs in both protocol eras, through the
// SDK's in-memory link, as server.test.ts does.

import { afterEach, describe, expect, it } from 'vitest';
import { CRITERIA } from '../src/core/criteria.ts';
import { explainCriterion } from '../src/core/explain.ts';
import type { EngineFinding } from '../src/core/rule-engine.ts';
import { createBrowserDouble, createRuleEngineDouble, pageDouble } from './browser-double.ts';
import { MODERN_VERSION, openSession, type Era, type Session } from './session.ts';

interface ListedResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

interface ReadResult {
  contents: { uri: string; mimeType?: string; text?: string }[];
}

interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

const IMAGE: EngineFinding = {
  rule: 'image-alt',
  selector: 'img.logo',
  rect: { x: 10, y: 20, width: 30, height: 40 },
  documentIndex: 7,
  measurement: { kind: 'failed-checks', checks: ['has-alt'] },
  component: null,
  element: { tag: 'img', attributes: [], attributeCount: 0 },
  accessibleName: '',
};

const sessions: Session[] = [];

async function open(era: Era, version: string): Promise<Session> {
  const session = await openSession(era, version, {
    browser: createBrowserDouble(pageDouble()),
    ruleEngine: createRuleEngineDouble([IMAGE]),
  });
  sessions.push(session);
  return session;
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

async function readResource(session: Session, uri: string): Promise<ReadResult> {
  const read = await session.request('resources/read', { uri });
  if (read.error !== undefined) throw new Error(`the read failed: ${read.error.message}`);
  return read.result as unknown as ReadResult;
}

// Two 2025 revisions and the 2026-07-28 one.
describe.each<[Era, string]>([
  ['legacy', '2025-03-26'],
  ['legacy', '2025-11-25'],
  ['modern', MODERN_VERSION],
])('a %s client on %s', (era, version) => {
  it('lists one template, criterion://{id}, of JSON', async () => {
    const listed = await (await open(era, version)).request('resources/templates/list');

    expect(listed.result?.resourceTemplates).toMatchObject([
      { name: 'criterion', uriTemplate: 'criterion://{id}', mimeType: 'application/json' },
    ]);
  });

  it('lists the resources of the twelve criteria, and no other', async () => {
    const listed = await (await open(era, version)).request('resources/list');
    const resources = listed.result?.resources as ListedResource[];

    expect(resources).toStrictEqual(
      CRITERIA.map(({ id, name, requires }) => ({
        uri: `criterion://${id}`,
        name: id,
        title: `${id} ${name}`,
        description: requires,
        mimeType: 'application/json',
      })),
    );
  });

  it('reads the resource of each criterion as its explanation', async () => {
    const session = await open(era, version);

    for (const { id } of CRITERIA) {
      const { contents } = await readResource(session, `criterion://${id}`);
      expect(contents, id).toHaveLength(1);
      expect(contents[0]?.uri).toBe(`criterion://${id}`);
      expect(contents[0]?.mimeType).toBe('application/json');
      expect(JSON.parse(contents[0]?.text ?? '')).toStrictEqual(explainCriterion(id));
    }
  });

  it.each([
    'criterion://2.1.3',
    'criterion://1.4.3/',
    'criterion://1.1.1/extra',
    'criterion://',
    'https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html',
    'file:///etc/hosts',
    'not a URI',
  ])('answers %s with the error of the specification', async (uri) => {
    const read = await (await open(era, version)).request('resources/read', { uri });

    // The 2026-07-28 revision asks for -32602 with the URI in the data; earlier revisions used
    // -32002. The SDK gives -32602 in every era, with a message that repeats the URI.
    expect(read.error).toMatchObject({ code: -32602, data: { uri } });
  });

  it.each(['CRITERION://1.4.3', ' criterion://1.4.3'])(
    'reads %s as criterion://1.4.3, as the SDK reads a URI',
    async (uri) => {
      const { contents } = await readResource(await open(era, version), uri);

      expect(contents[0]?.uri).toBe('criterion://1.4.3');
      expect(JSON.parse(contents[0]?.text ?? '')).toStrictEqual(explainCriterion('1.4.3'));
    },
  );
  it('explains each criterion with explain_criterion, as structured content and as text', async () => {
    const session = await open(era, version);

    for (const { id } of CRITERIA) {
      const called = await session.request('tools/call', {
        name: 'explain_criterion',
        arguments: { criterion: id },
      });
      const result = called.result as ToolResult;
      expect(result.isError, id).toBeFalsy();
      expect(result.structuredContent, id).toStrictEqual(explainCriterion(id));
      expect(JSON.parse(result.content?.[0]?.text ?? '')).toStrictEqual(explainCriterion(id));
    }
  });

  it('refuses a criterion outside the twelve, without repeating it', async () => {
    const called = await (
      await open(era, version)
    ).request('tools/call', { name: 'explain_criterion', arguments: { criterion: '2.1.3' } });
    const result = called.result as ToolResult | undefined;
    const message = called.error?.message ?? result?.content?.[0]?.text ?? '';

    expect(called.error !== undefined || result?.isError === true).toBe(true);
    expect(message).not.toContain('2.1.3');
  });

  it('links the definitions of an audit to the resources, which read', async () => {
    const session = await open(era, version);
    const called = await session.request('tools/call', {
      name: 'audit_route',
      arguments: { url: 'http://localhost:4200/' },
    });
    const output = (called.result as ToolResult).structuredContent as {
      definitions: { criterion: string; resource: string; understanding: string }[];
    };

    expect(output.definitions).toMatchObject([
      {
        criterion: '1.1.1',
        resource: 'criterion://1.1.1',
        understanding: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
      },
    ]);
    const { contents } = await readResource(session, output.definitions[0]?.resource ?? '');
    expect(JSON.parse(contents[0]?.text ?? '')).toMatchObject({ criterion: '1.1.1' });
  });
});
