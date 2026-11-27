// The command line of the binary: no argument serves MCP, `install-browser` installs Chromium, and
// any other form is refused rather than ignored.

import { describe, expect, it } from 'vitest';
import { readCommand } from '../src/core/command-line.ts';

describe('readCommand', () => {
  it('serves MCP over stdio with no argument, as an MCP client starts it', () => {
    expect(readCommand([])).toStrictEqual({ kind: 'serve' });
  });

  it('installs the browser with install-browser, and its system libraries with --with-deps', () => {
    expect(readCommand(['install-browser'])).toStrictEqual({
      kind: 'install-browser',
      withDeps: false,
    });
    expect(readCommand(['install-browser', '--with-deps'])).toStrictEqual({
      kind: 'install-browser',
      withDeps: true,
    });
  });

  it.each([
    [['--help']],
    [['--version']],
    [['serve']],
    [['']],
    [['INSTALL-BROWSER']],
    [['install-browser', '--force']],
    [['install-browser', '--with-deps', 'chromium']],
    [['--with-deps', 'install-browser']],
    [['install-browser', 'install-browser']],
  ])('refuses %j, and says which forms it reads', (args) => {
    const command = readCommand(args);

    expect(command).toMatchObject({ kind: 'refused' });
    expect(command.kind === 'refused' ? command.message : '').toContain(
      'run the binary with none to serve MCP over stdio, or with install-browser',
    );
  });
});
