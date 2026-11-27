import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Runs a program with the terminal of the binary, and gives its exit code. */
export type Run = (command: string, args: readonly string[]) => number;

/**
 * Installs the Chrome Headless Shell that the installed `playwright-core` names, with that
 * package's own installer, as `npm run browser:install` does in a clone. `--no-remove` keeps the
 * browsers of other projects, which the installer would otherwise delete when no Playwright that
 * it knows uses them. Gives the installer's exit code.
 */
export function installBrowser(withDeps: boolean, run: Run): number {
  const manifest = fileURLToPath(import.meta.resolve('playwright-core/package.json'));
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: Record<string, unknown> };
  const entry = parsed.bin?.['playwright-core'];
  if (typeof entry !== 'string') throw new Error(`${manifest}: no "playwright-core" in "bin"`);
  const options = ['--only-shell', '--no-remove', ...(withDeps ? ['--with-deps'] : [])];
  return run(process.execPath, [join(dirname(manifest), entry), 'install', ...options, 'chromium']);
}
