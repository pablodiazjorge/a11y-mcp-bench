// Chromium's sandbox (ADR 0008), seen where it counts: on the command lines of the browser that the
// adapter starts and of the renderer that runs the page. Playwright turns the sandbox off with
// --no-sandbox, which Chromium passes on to its processes, and a browser asked for its sandbox that
// cannot have it does not start. So the sandbox is on when both run without that flag and the page
// opens. Chromium leaves its network service outside the sandbox either way, so it is not checked.
// Needs Chromium: `npm run browser:install`.

import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightBrowser } from '../src/adapters/playwright/browser.ts';
import { startSite, type LocalSite } from './local-site.ts';

// Generous, so a slow CI machine does not fail a test; listing the processes takes a second or two.
const TIMEOUT_MS = 60_000;

let site: LocalSite;

beforeAll(async () => {
  site = await startSite('127.0.0.1');
  site.page('/', '<title>home</title>');
}, TIMEOUT_MS);

afterAll(() => site.close(), TIMEOUT_MS);

interface Running {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

/**
 * Every process of the machine with its command line, read with the tool of the system, since
 * Playwright does not give the process of a browser that it launches.
 */
function processes(): Running[] {
  const options = {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 64 * 1024 * 1024,
  } as const;
  if (process.platform === 'win32') {
    const listing = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)" }',
      ],
      options,
    );
    return listing.split('\n').flatMap((line) => {
      const [pid, ppid, ...command] = line.replace(/\r$/, '').split('\t');
      return pid === undefined || ppid === undefined
        ? []
        : [{ pid: Number(pid), ppid: Number(ppid), command: command.join('\t') }];
    });
  }
  const listing = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args='], options);
  return listing.split('\n').flatMap((line) => {
    const found = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return found === null
      ? []
      : [{ pid: Number(found[1]), ppid: Number(found[2]), command: found[3] ?? '' }];
  });
}

/** The processes that this test process started, and those that they started, and so on. */
function descendants(): Running[] {
  const all = processes();
  const found: Running[] = [];
  const parents = new Set([process.pid]);
  for (let added = true; added;) {
    added = false;
    for (const each of all) {
      if (parents.has(each.ppid) && !parents.has(each.pid)) {
        parents.add(each.pid);
        found.push(each);
        added = true;
      }
    }
  }
  return found;
}

interface Started {
  /** The browser process: the one that holds the pipe to Playwright and is no helper. */
  readonly browser: string[];
  /** The processes that run pages. */
  readonly renderers: string[];
}

/**
 * Opens a page through the adapter, and returns the command lines of the processes that it started,
 * read while the page is open, since Chromium starts a renderer for it.
 */
async function startedProcesses(sandbox: boolean): Promise<Started> {
  const before = new Set(descendants().map(({ pid }) => pid));
  let commands: string[] = [];
  const browser = createPlaywrightBrowser({ log: () => undefined, sandbox });
  try {
    const visit = await browser.visit(`${site.origin}/`, (page) => {
      commands = descendants()
        .filter(({ pid }) => !before.has(pid))
        .map(({ command }) => command);
      return page.evaluate('document.title');
    });
    expect(visit).toStrictEqual({ ok: true, value: 'home' });
  } finally {
    await browser.close();
  }
  return {
    browser: commands.filter(
      (command) => command.includes('--remote-debugging-pipe') && !command.includes('--type='),
    ),
    renderers: commands.filter((command) => command.includes('--type=renderer')),
  };
}

describe("Chromium's sandbox", { timeout: TIMEOUT_MS }, () => {
  it('is on by default: the browser and its renderers have no --no-sandbox, and open a page', async () => {
    const { browser, renderers } = await startedProcesses(true);

    expect(browser).toHaveLength(1);
    expect(renderers).not.toHaveLength(0);
    for (const command of [...browser, ...renderers]) expect(command).not.toContain('--no-sandbox');
  });

  it('is off only when asked: the browser and its renderers then have --no-sandbox', async () => {
    const { browser, renderers } = await startedProcesses(false);

    expect(browser).toHaveLength(1);
    expect(renderers).not.toHaveLength(0);
    for (const command of [...browser, ...renderers]) expect(command).toContain('--no-sandbox');
  });
});
