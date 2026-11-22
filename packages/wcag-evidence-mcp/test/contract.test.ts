// The contract that the server shows a client: what it says about itself when a session opens
// (its capabilities, its name and version, its instructions), its prompts, and what `tools/list`
// and `resources/templates/list` return, with names, schemas, annotations and descriptions.
// fixtures/contract.json is the reference, checked in each protocol era. A change to a tool's
// schema or text shows up here as a change of that file, so a review sees what the agent will read.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MODERN_VERSION, openSession, type Era, type Session } from './session.ts';

const REFERENCE: unknown = JSON.parse(
  readFileSync(new URL('fixtures/contract.json', import.meta.url), 'utf8'),
);
const SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

const sessions: Session[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

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
 * What the server lists for a client, as JSON. The in-memory link passes objects as they are, with
 * keys whose value is `undefined`, which JSON leaves out.
 */
async function listedContract(session: Session, era: Era): Promise<unknown> {
  const prompts = await session.request('prompts/list');
  const tools = await session.request('tools/list');
  const templates = await session.request('resources/templates/list');
  return JSON.parse(
    JSON.stringify({
      server: await serverOf(session, era),
      prompts: prompts.result?.prompts ?? { error: prompts.error?.code },
      tools: tools.result?.tools,
      resourceTemplates: templates.result?.resourceTemplates,
    }),
  ) as unknown;
}

// Two 2025 revisions and the 2026-07-28 one, which list the same.
describe.each<[Era, string]>([
  ['legacy', '2025-03-26'],
  ['legacy', '2025-11-25'],
  ['modern', MODERN_VERSION],
])('the contract for a %s client on %s', (era, version) => {
  it('is the reference in fixtures/contract.json', async () => {
    const session = await openSession(era, version);
    sessions.push(session);

    expect(await listedContract(session, era)).toStrictEqual(REFERENCE);
  });
});
