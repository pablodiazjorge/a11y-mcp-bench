// Runs collectPublishedFiles on small git repositories in temporary folders, so that the git
// calls and the disk reads of check-repo.ts are tested, not only the pure checks.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { collectPublishedFiles } from './check-repo.ts';
import { formatProblem } from './repo-checks.ts';

const LINK =
  'is a symbolic link, which may lead outside the repository: npm follows one under a workspace folder';

const roots: string[] = [];

// A git hook exports GIT_DIR and GIT_INDEX_FILE. Left in place, they point the git calls of
// these tests at the repository that runs the hook, where `git init` can turn a repository
// with linked worktrees into a bare one.
beforeAll(() => {
  const names = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout;
  for (const name of names.split('\n').filter(Boolean)) vi.stubEnv(name, undefined);
  // The system and user settings, such as `core.safecrlf` or a template that ignores every
  // file, would change what `git add` does. An empty file stands in for the user settings.
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'check-repo-config-')));
  roots.push(home);
  const config = join(home, 'gitconfig');
  writeFileSync(config, '');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
});

afterAll(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Runs git in `root` and returns what it prints, or throws when it fails. */
function git(root: string, args: string[], input?: string): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', input });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * Makes a repository with one tracked regular file. Nothing is committed, so git needs no
 * identity. The real path, because on Windows the temporary folder can come in its short
 * form, and git would then not see the folder as its top level.
 */
function repository(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'check-repo-')));
  roots.push(root);
  // The branch name is set so that git prints no hint about it.
  git(root, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git(root, ['add', 'a.txt']);
  return root;
}

/** Adds an index entry with a mode, without the rights that a real link needs. */
function addEntry(root: string, mode: string, path: string): void {
  const object =
    mode === '160000' ? '0'.repeat(39) + '1' : git(root, ['hash-object', '-w', '--stdin'], '..');
  git(root, ['update-index', '--add', '--cacheinfo', `${mode},${object},${path}`]);
}

const problems = (root: string): string[] =>
  collectPublishedFiles(root).problems.map(formatProblem);

describe('collectPublishedFiles', () => {
  it('finds nothing in a repository of regular files', () => {
    const root = repository();

    expect([...collectPublishedFiles(root).paths]).toEqual(['a.txt']);
    expect(problems(root)).toEqual([]);
  });

  it('refuses a folder that is not the top level of the repository', () => {
    const root = repository();
    mkdirSync(join(root, 'sub'));

    expect(() => collectPublishedFiles(join(root, 'sub'))).toThrow(/not the top level/);
  });

  it('reports a link that only the index shows', () => {
    const root = repository();
    addEntry(root, '120000', 'packages/evil');
    // What a checkout without symbolic links writes: a plain file that holds the target.
    mkdirSync(join(root, 'packages'));
    writeFileSync(join(root, 'packages', 'evil'), '..');

    expect(problems(root)).toEqual([`packages/evil: ${LINK}`]);
  });

  it('reports a submodule that only the index shows', () => {
    const root = repository();
    addEntry(root, '160000', 'vendor/sub');

    expect(problems(root)).toEqual(['vendor/sub: is a submodule, which this check does not read']);
  });

  it('reports a tracked file that the disk shows as a link', () => {
    const root = repository();
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'check-repo-outside-')));
    roots.push(outside);
    mkdirSync(join(root, 'packages'));
    writeFileSync(join(root, 'packages', 'evil'), 'x\n');
    git(root, ['add', 'packages/evil']);
    rmSync(join(root, 'packages', 'evil'));
    // A junction needs no special rights on Windows, and other systems ignore the type and
    // make a symbolic link.
    symlinkSync(outside, join(root, 'packages', 'evil'), 'junction');

    expect(problems(root)).toEqual([`packages/evil: ${LINK}`]);
  });
});
