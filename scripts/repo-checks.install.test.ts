import { describe, expect, it } from 'vitest';
import { checkIgnoreScripts, checkInstallScripts } from './repo-checks.install.ts';
import { formatProblem, type Problem } from './repo-checks.ts';

// The checks that keep the install scripts of dependencies from running: the setting in .npmrc,
// and the allowlist of packages in the lockfile that have one.

const report = (problems: readonly Problem[]): string[] => problems.map(formatProblem);
const npmrc = (...lines: string[]) => new Map([['.npmrc', lines.join('\n')]]);

describe('checkIgnoreScripts', () => {
  it('accepts ignore-scripts=true among the other settings and comments', () => {
    const texts = npmrc(
      'save-exact=true',
      '# Supply chain: npm runs no install script.',
      '; ignore-scripts=false, in a comment',
      'ignore-scripts=true',
    );

    expect(checkIgnoreScripts(texts)).toEqual([]);
  });

  it('reports an .npmrc without the setting, and a missing .npmrc', () => {
    expect(report(checkIgnoreScripts(npmrc('save-exact=true')))).toEqual([
      '.npmrc: does not set ignore-scripts=true',
    ]);
    expect(report(checkIgnoreScripts(new Map()))).toEqual([
      '.npmrc: missing, so ignore-scripts=true is not set',
    ]);
  });

  it.each([
    ['false', 'ignore-scripts=false'],
    ['spaced', 'ignore-scripts = true'],
    ['uppercase', 'IGNORE-SCRIPTS=true'],
    ['quoted', 'ignore-scripts="true"'],
    ['indented', '  ignore-scripts=true'],
    ['with a trailing comment', 'ignore-scripts=true # off'],
  ])('reports a %s setting, which it does not read, rather than skip it', (_case, line) => {
    expect(report(checkIgnoreScripts(npmrc('save-exact=true', line)))).toEqual([
      '.npmrc:2: sets ignore-scripts in a form that this check does not read; write ignore-scripts=true once',
      '.npmrc: does not set ignore-scripts=true',
    ]);
  });

  it('reports a later line that would undo the setting, since npm keeps the last value', () => {
    const texts = npmrc('ignore-scripts=true', 'ignore-scripts=false', 'ignore-scripts=true');

    expect(report(checkIgnoreScripts(texts))).toEqual([
      '.npmrc:2: sets ignore-scripts in a form that this check does not read; write ignore-scripts=true once',
      '.npmrc:3: sets ignore-scripts in a form that this check does not read; write ignore-scripts=true once',
    ]);
  });
});

describe('checkInstallScripts', () => {
  const lockfile = (packages: Record<string, object>) =>
    new Map([['package-lock.json', JSON.stringify({ lockfileVersion: 3, packages }, null, 2)]]);
  const notAllowed = (line: number, name: string): string =>
    `package-lock.json:${String(line)}: ${name} has an install script and is not on the allowlist of scripts/repo-checks.install.ts`;

  it('accepts the allowed packages and those without an install script', () => {
    const texts = lockfile({
      '': { name: 'root' },
      'node_modules/fsevents': { version: '2.3.3', hasInstallScript: true, optional: true },
      'node_modules/zod': { version: '4.6.7' },
      'node_modules/esbuild': { version: '0.25.0', hasInstallScript: false },
    });

    expect(checkInstallScripts(texts)).toEqual([]);
  });

  it('reports a new package with an install script, nested or scoped, with its line', () => {
    const texts = lockfile({
      'node_modules/esbuild': { version: '0.25.0', hasInstallScript: true },
      'node_modules/a/node_modules/@scope/native': { version: '1.0.0', hasInstallScript: true },
    });

    expect(report(checkInstallScripts(texts))).toEqual([
      notAllowed(4, 'esbuild'),
      notAllowed(8, '@scope/native'),
    ]);
  });

  it('reports a package under an allowed name that the lockfile records as another', () => {
    const texts = lockfile({
      'node_modules/fsevents': { name: 'evil', version: '1.0.0', hasInstallScript: true },
    });

    expect(report(checkInstallScripts(texts))).toEqual([notAllowed(4, 'evil')]);
  });

  it('reports an install script of the root package or of a workspace', () => {
    const texts = lockfile({
      '': { name: 'root', hasInstallScript: true },
      'packages/server': { name: 'server', hasInstallScript: true },
    });

    expect(report(checkInstallScripts(texts))).toEqual([
      notAllowed(4, 'the root package'),
      notAllowed(8, 'server'),
    ]);
  });

  it.each([
    ['missing', new Map<string, string>()],
    ['not JSON', new Map([['package-lock.json', '{ "packages": ']])],
    ['without packages', new Map([['package-lock.json', '{ "lockfileVersion": 3 }']])],
  ])('reports a lockfile that is %s, rather than pass it', (_case, texts) => {
    expect(report(checkInstallScripts(texts))).toEqual([
      'package-lock.json: has no "packages" that this check can read',
    ]);
  });
});
