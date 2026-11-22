// The server's tool contract, tools.contract.json, and the reference generated from it,
// docs/tools.md. Each must be what the server answers today, formatted as Prettier formats it, or
// the test fails; `npm run gen` runs this file with `--update`, which writes both. The contract is
// the same in every protocol era, so one file serves all of them.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { beforeAll, describe, expect, it } from 'vitest';
import { MODERN_VERSION } from './session.ts';
import { contractOf, renderToolsReference } from './tools-reference.ts';

// Generous, so a slow CI machine does not fail a test; building the contract takes about a second.
const TIMEOUT_MS = 30_000;
const CONTRACT_FILE = '../tools.contract.json';
const REFERENCE_FILE = '../../../docs/tools.md';

/** `text` as Prettier formats the file at `relative`, so that the format check passes on it. */
async function formatted(text: string, relative: string): Promise<string> {
  const filepath = fileURLToPath(new URL(relative, import.meta.url));
  const options = await prettier.resolveConfig(filepath);
  return prettier.format(text, { ...options, filepath });
}

/**
 * Fails when the file at `relative` is missing, unless the run writes snapshots (`--update`, as
 * `npm run gen` runs). Without it, vitest writes a missing file snapshot outside CI and passes.
 */
function expectWritten(relative: string): void {
  if (expect.getState().snapshotState.snapshotUpdateState === 'all') return;
  const path = fileURLToPath(new URL(relative, import.meta.url));
  expect(existsSync(path), `${relative} is missing: run npm run gen`).toBe(true);
}

let contracts: unknown[];

beforeAll(async () => {
  contracts = await Promise.all([
    contractOf('legacy', '2025-03-26'),
    contractOf('legacy', '2025-11-25'),
    contractOf('modern', MODERN_VERSION),
  ]);
}, TIMEOUT_MS);

describe('the tool contract', { timeout: TIMEOUT_MS }, () => {
  it('is the same for a client on 2025-03-26, on 2025-11-25 and on 2026-07-28', () => {
    const [first, ...others] = contracts;

    for (const other of others) expect(other).toStrictEqual(first);
  });

  it('is tools.contract.json', async () => {
    expectWritten(CONTRACT_FILE);
    const json = await formatted(JSON.stringify(contracts.at(-1)), CONTRACT_FILE);

    await expect(json).toMatchFileSnapshot(CONTRACT_FILE);
  });

  it('gives docs/tools.md', async () => {
    expectWritten(REFERENCE_FILE);
    const markdown = await formatted(renderToolsReference(contracts.at(-1)), REFERENCE_FILE);

    await expect(markdown).toMatchFileSnapshot(REFERENCE_FILE);
  });
});
