// The built server as an MCP client runs it: the binary that package.json publishes, started by the
// SDK's own client over its stdio transport, through a whole session. stdio.test.ts covers the
// framing and the exit codes on the source with raw lines; this test covers the build, Chromium
// and the walk. Needs `npm run build` and Chromium (`npm run browser:install`): without them it
// fails, it is never skipped.

import { execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, it, onTestFinished } from 'vitest';
import { startSite } from './local-site.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
// Generous, so a slow CI machine does not fail the test; the whole session takes a few seconds.
const TIMEOUT_MS = 90_000;
// How long `StdioClientTransport` of SDK 2.4.0 waits, once it has ended stdin, before it sends
// SIGTERM: a server that is still running then is killed, so it has to exit on its own within that.
// A killed server is gone too, so the time of `close()` is what tells a clean exit from a kill.
const CLIENT_GRACE_MS = 2_000;
// How long a listing of the processes may take before the test gives up on it.
const LISTING_MS = 15_000;
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// One finding of axe-core (an image with no text alternative) and one of the walk (a button whose
// focus shows nothing).
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Smoke</title><style>button:focus { outline: none }</style></head><body><main><img src="${GIF}" width="40" height="40"><button>Go</button></main></body></html>`;

interface Manifest {
  readonly bin: Readonly<Record<string, string>>;
  readonly files: readonly string[];
}

/**
 * The binary that npm installs for the package: its `bin`, which `files` must ship, built after the
 * last change to the source, since `npm test` alone does not build.
 */
function publishedBinary(): string {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as Manifest;
  const entries = Object.values(manifest.bin);
  expect(entries).toHaveLength(1);
  const entry = normalize(entries[0] ?? '');
  expect(manifest.files.some((folder) => entry.startsWith(normalize(folder) + sep))).toBe(true);
  const path = join(PACKAGE_DIR, entry);
  if (!existsSync(path)) throw new Error(`${entry} is missing: run npm run build first`);
  const built = statSync(path).mtimeMs;
  const newer = sourceFiles(join(PACKAGE_DIR, 'src')).filter(
    (file) => statSync(file).mtimeMs > built,
  );
  if (newer.length > 0) {
    throw new Error(
      `${entry} is older than ${relative(PACKAGE_DIR, newer[0] ?? '')}: run npm run build first`,
    );
  }
  return path;
}

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

interface Running {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
  /** When the process was created, on Windows only: a number that grows with time. */
  readonly created: number | null;
}

/**
 * Every process of the machine, read with the tool of the system: ps, or CIM on Windows. Node has
 * no way to list the processes that a child started, and Chromium's run as grandchildren of the
 * server. `ps` gives the name cut to 15 characters on Linux, enough to match `chrom`.
 */
function processes(): Running[] {
  const windows = process.platform === 'win32';
  const [tool, args] = windows
    ? [
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) $($_.Name)" }',
        ],
      ]
    : ['ps', ['-A', '-o', 'pid=,ppid=,comm=']];
  let listing: string;
  try {
    listing = execFileSync(tool, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: LISTING_MS,
    });
  } catch (error) {
    throw new Error(`${tool} did not list the processes within ${String(LISTING_MS)} ms`, {
      cause: error,
    });
  }
  const line = windows
    ? /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*?)\s*$/
    : /^\s*(\d+)\s+(\d+)\s+()(.*?)\s*$/;
  return listing.split('\n').flatMap((text) => {
    const found = line.exec(text);
    if (found === null) return [];
    const [, pid, ppid, created, name] = found;
    return [
      {
        pid: Number(pid),
        ppid: Number(ppid),
        name: name ?? '',
        created: windows ? Number(created) : null,
      },
    ];
  });
}

/**
 * The processes that `root` started, and those that they started, and so on. On Windows, a process
 * keeps the id of its parent after the parent ends, and a new process can get that id again: a
 * child counts only when it was created after its parent.
 */
function descendants(root: number): Running[] {
  const all = processes();
  const byPid = new Map(all.map((each) => [each.pid, each]));
  const found: Running[] = [];
  const parents = new Set([root]);
  for (let added = true; added;) {
    added = false;
    for (const each of all) {
      if (!parents.has(each.ppid) || parents.has(each.pid)) continue;
      const parent = byPid.get(each.ppid)?.created ?? null;
      if (each.created !== null && parent !== null && each.created < parent) continue;
      parents.add(each.pid);
      found.push(each);
      added = true;
    }
  }
  return found;
}

/** The `pids` still alive after up to `ms`: Chromium's own processes can outlive its main one briefly. */
async function ended(pids: readonly number[], ms: number): Promise<number[]> {
  const deadline = performance.now() + ms;
  let left = pids.filter(alive);
  while (left.length > 0 && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    left = left.filter(alive);
  }
  return left;
}

function alive(pid: number): boolean {
  try {
    // Signal 0 only checks that the process exists, on Windows too. In a container with no init
    // process, an orphaned child of Chromium stays as a zombie, which signal 0 sees as alive.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it(
  'serves a whole session from the built binary to the SDK client, and leaves no process behind',
  async () => {
    const binary = publishedBinary();
    const site = await startSite('127.0.0.1');
    site.page('/smoke', PAGE);
    onTestFinished(() => site.close());

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [binary],
      stderr: 'pipe',
      // A client passes the server a small default environment, plus what its user configures, so
      // the test does the same rather than hand down its own. PLAYWRIGHT_BROWSERS_PATH is the one
      // setting passed on, so that the server finds a Chromium installed outside Playwright's
      // default folder, which the default environment already leads to.
      env:
        process.env.PLAYWRIGHT_BROWSERS_PATH === undefined
          ? {}
          : { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH },
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    // The SDK's client skips a line of stdout that is not JSON without a word, so the test reads
    // stdout too, from the child process that the transport keeps in a private field of SDK 2.4.0:
    // if the SDK renames it, the test fails here rather than pass blind.
    let stdout = '';
    const start = transport.start.bind(transport);
    transport.start = async () => {
      await start();
      const child = (transport as unknown as { _process?: ChildProcess })._process;
      if (!child?.stdout) throw new Error('the transport keeps its child process elsewhere');
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    };
    const client = new Client({ name: 'smoke-test', version: '0.0.0' });
    // A message that the client cannot read reaches it as an error.
    const errors: unknown[] = [];
    client.onerror = (error) => errors.push(error);
    let closed = false;
    client.onclose = () => (closed = true);
    onTestFinished(() => client.close());
    await client.connect(transport);
    const server = transport.pid;
    if (server === null) throw new Error('the transport has no process');

    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name).sort()).toStrictEqual([
      'audit_route',
      'explain_criterion',
    ]);

    const audit = await client.callTool({
      name: 'audit_route',
      arguments: { url: `${site.origin}/smoke`, criteria: ['1.1.1', '2.4.7'] },
    });
    expect(audit.isError).not.toBe(true);
    expect(audit.structuredContent).toMatchObject({
      findings: [{ rule: 'image-alt' }, { rule: 'focus-visible' }],
      notChecked: [],
    });
    // The browser stays open between calls: it is the server's, and it must go with the server.
    // The list guards against processes that detach from the server or survive their pipe to it.
    const started = descendants(server);
    expect(started.some(({ name }) => /chrom/i.test(name))).toBe(true);

    const explained = await client.callTool({
      name: 'explain_criterion',
      arguments: { criterion: '2.4.11' },
    });
    expect(explained.structuredContent).toMatchObject({
      criterion: '2.4.11',
      ownRule: 'focus-not-obscured',
    });

    const resource = await client.readResource({ uri: 'criterion://2.4.7' });
    expect(resource.contents).toMatchObject([
      { uri: 'criterion://2.4.7', mimeType: 'application/json' },
    ]);
    const [content] = resource.contents;
    expect(
      JSON.parse(content !== undefined && 'text' in content ? content.text : ''),
    ).toMatchObject({ criterion: '2.4.7', ownRule: 'focus-visible' });

    // Closing the client ends the server's stdin.
    const closing = performance.now();
    await client.close();
    const took = performance.now() - closing;

    expect(closed).toBe(true);
    expect(took, `the server took ${String(Math.round(took))} ms to exit`).toBeLessThan(
      CLIENT_GRACE_MS,
    );
    expect(alive(server)).toBe(false);
    // The server waits for Chromium's main process; its other processes end on their own soon
    // after. 5 s leaves a slow runner room without letting a process that lives on pass.
    expect(
      await ended(
        started.map(({ pid }) => pid),
        5_000,
      ),
    ).toStrictEqual([]);
    expect(errors).toStrictEqual([]);
    // One answer to each of the five requests, the opening `initialize` included, since the client
    // of SDK 2.4.0 opens a session of the 2025 era, and nothing else.
    const lines = stdout.split('\n').filter((line) => line.trim() !== '');
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
    expect(stderr).toContain('[wcag-evidence-mcp] serving MCP over stdio');
    expect(stderr).toContain('[wcag-evidence-mcp] new server instance for the legacy protocol era');
    expect(stderr).toContain('[wcag-evidence-mcp] started Chromium');
    expect(stderr).toContain('[wcag-evidence-mcp] closed Chromium');
  },
  TIMEOUT_MS,
);
