// The `install-browser` subcommand calls the installer of the installed `playwright-core`. No test
// downloads: one records the call through a double, and one runs the real installer with
// `--dry-run`, which only prints what it would install.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installBrowser, type Run } from '../src/adapters/playwright/install-browser.ts';

const PLAYWRIGHT = dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
const manifest = JSON.parse(readFileSync(join(PLAYWRIGHT, 'package.json'), 'utf8')) as {
  readonly bin: Readonly<Record<string, string>>;
};
const CLI = join(PLAYWRIGHT, manifest.bin['playwright-core'] ?? '');

/** A double of the runner that keeps each call and answers with `code`. */
function recording(code: number) {
  const calls: { command: string; args: readonly string[] }[] = [];
  const run: Run = (command, args) => {
    calls.push({ command, args });
    return code;
  };
  return { calls, run };
}

describe('installBrowser', () => {
  it('runs the installer of playwright-core with Node, for the headless shell only, removing nothing', () => {
    const { calls, run } = recording(0);

    expect(installBrowser(false, run)).toBe(0);
    expect(calls).toStrictEqual([
      {
        command: process.execPath,
        args: [CLI, 'install', '--only-shell', '--no-remove', 'chromium'],
      },
    ]);
  });

  it('adds --with-deps when asked, and gives the exit code of the installer', () => {
    const { calls, run } = recording(7);

    expect(installBrowser(true, run)).toBe(7);
    expect(calls[0]?.args).toStrictEqual([
      CLI,
      'install',
      '--only-shell',
      '--no-remove',
      '--with-deps',
      'chromium',
    ]);
  });

  it('builds a command that the real installer accepts, run here with --dry-run', () => {
    const run: Run = (command, args) => {
      const result = spawnSync(command, [...args, '--dry-run'], { encoding: 'utf8' });
      expect(result.stdout).toMatch(/\(playwright chromium-headless-shell v\d+\)/);
      return result.status ?? 1;
    };

    expect(installBrowser(false, run)).toBe(0);
  });
});
