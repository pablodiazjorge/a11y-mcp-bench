// The package as npm would publish it: the files that `npm pack` ships, read from its dry run, and
// the binary started from a copy of exactly those files. The copy sits in a folder under the
// repository's `node_modules`, so its dependencies resolve from this install, as from a hoisted
// one, with no network. Installing the real tarball needs the network, so the release steps do it
// (docs/releasing.md). Needs `npm run build`: without it the test fails, it is never skipped.

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
// A project of its own under the root's `node_modules`, where git and npm leave it alone.
const PROJECT = join(PACKAGE_DIR, '..', '..', 'node_modules', '.cache', 'wcag-evidence-mcp-packed');
const INSTALLED = join(PROJECT, 'node_modules', 'wcag-evidence-mcp');
// Generous, so a slow CI machine does not fail a test; each takes a second or two here.
const TIMEOUT_MS = 60_000;

const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
  readonly name: string;
  readonly version: string;
  readonly bin: Readonly<Record<string, string>>;
};

// The files of the dry run, and their copy laid out as npm installs the package.
let packed: string[] = [];

beforeAll(() => {
  packed = packedFiles();
  rmSync(PROJECT, { recursive: true, force: true });
  for (const file of packed) {
    mkdirSync(join(INSTALLED, file, '..'), { recursive: true });
    cpSync(join(PACKAGE_DIR, file), join(INSTALLED, file));
  }
}, TIMEOUT_MS);

afterAll(() => {
  rmSync(PROJECT, { recursive: true, force: true });
});

/** Every file under `folder`, as paths relative to the package, written with `/`. */
function filesUnder(folder: string): string[] {
  return readdirSync(join(PACKAGE_DIR, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(PACKAGE_DIR, join(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    );
}

/** The files that `npm pack` would put in the tarball, as its dry run lists them. */
function packedFiles(): string[] {
  // npm is a `.cmd` file on Windows, which only a shell runs.
  const result = spawnSync('npm pack --dry-run --json', {
    cwd: PACKAGE_DIR,
    shell: true,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(`npm pack --dry-run failed: ${result.stderr}`);
  const packs = JSON.parse(result.stdout) as {
    readonly name: string;
    readonly version: string;
    readonly files: readonly { readonly path: string }[];
  }[];
  expect(packs.map(({ name, version }) => ({ name, version }))).toStrictEqual([
    { name: manifest.name, version: manifest.version },
  ]);
  return (packs[0]?.files ?? []).map(({ path }) => path).sort();
}

/** What the build makes of the source: each module, and each JSON file that a module imports. */
function builtFromSource(): string[] {
  const sources = filesUnder('src');
  const newest = Math.max(...sources.map((file) => statSync(join(PACKAGE_DIR, file)).mtimeMs));
  const bin = join(PACKAGE_DIR, 'dist', 'bin.js');
  if (statSync(bin, { throwIfNoEntry: false }) === undefined || statSync(bin).mtimeMs < newest) {
    throw new Error('dist is missing or older than src: run npm run build first');
  }
  return sources.map((file) => file.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js'));
}

describe('the package', { timeout: TIMEOUT_MS }, () => {
  it('ships the built server, its README, its license and package.json, and nothing else', () => {
    const expected = ['LICENSE', 'README.md', 'package.json', ...builtFromSource()].sort();

    expect(packed).toStrictEqual(expected);
  });

  it('starts from the packed files, reads its own package.json and lists its tools', async () => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const child = spawn(
      process.execPath,
      [join(INSTALLED, manifest.bin['wcag-evidence-mcp'] ?? '')],
      {
        cwd: PROJECT,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: TIMEOUT_MS,
      },
    );
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.resume();
    const closed = new Promise<number | null>((resolve) => child.on('close', resolve));
    const answered = new Promise<void>((resolve) => {
      child.stdout.on('data', () => {
        if (stdout.includes('"id":2')) resolve();
      });
    });

    const clientInfo = { name: 'test-client', version: '0.0.0' };
    for (const message of [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    await Promise.race([answered, closed]);
    child.stdin.end();

    expect(await closed).toBe(0);
    const answers = stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { id?: number; result?: Record<string, unknown> });
    expect(answers.find(({ id }) => id === 1)?.result).toMatchObject({
      serverInfo: { name: manifest.name, version: manifest.version },
    });
    const tools = answers.find(({ id }) => id === 2)?.result?.tools as { name: string }[];
    expect(tools.map(({ name }) => name).sort()).toStrictEqual([
      'audit_route',
      'explain_criterion',
    ]);
  });

  it('is a binary only: importing it by name fails, as exports is empty', () => {
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import('wcag-evidence-mcp').then(() => console.log('imported'), (error) => console.log(error.code))",
      ],
      { cwd: PROJECT, encoding: 'utf8', timeout: 30_000 },
    );

    expect(probe.stdout.trim()).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });
});
