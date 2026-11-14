// Runs the repository checks of repo-checks.ts on the files that git would publish: the
// tracked ones plus the untracked ones that .gitignore does not exclude. A file that is not
// committed yet is checked too, so a problem shows up before it reaches the history.
// Adapted from scripts/check.mjs in rea-lab (https://github.com/pablodiazjorge/rea-lab), MIT.

import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import {
  formatProblem,
  parseIndexEntries,
  parsePathList,
  readPublishedFiles,
  runChecks,
  type PublishedFiles,
} from './repo-checks.ts';

function runGit(root: string, args: string[]) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    // The default of 1 MB is small for the file list of a large repository.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error('git could not be run', { cause: result.error });
  }
  return result;
}

/** Asks git which files the repository at `root` would publish, and reads them from disk. */
export function collectPublishedFiles(root: string): PublishedFiles {
  const git = (args: string[]) => runGit(root, args);
  const list = (...options: string[]): string[] => {
    const result = git(['ls-files', '-z', ...options]);
    if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
    return parsePathList(result.stdout);
  };

  // Inside a repository, this prints the path from its top level to the current folder,
  // which is empty at the top level itself.
  const prefix = git(['rev-parse', '--show-prefix']);
  if (prefix.status !== 0 || prefix.stdout.trim() !== '') {
    throw new Error(
      `${root} is not the top level of a git repository, and these checks need git to list the files`,
    );
  }

  // The mode of each tracked path. With `core.symlinks` set to false, as on Windows by
  // default, a tracked link is checked out as a plain file, so only the index shows it.
  const stage = git(['ls-files', '--stage', '-z']);
  if (stage.status !== 0) throw new Error(`git ls-files failed: ${stage.stderr.trim()}`);

  return readPublishedFiles(
    list('--cached', '--others', '--exclude-standard'),
    // Tracked files that are gone from the working tree. Any other path that cannot be
    // read is reported, not skipped.
    new Set(list('--deleted')),
    (path) => {
      try {
        const stats = lstatSync(join(root, path));
        // A link that is not tracked yet, or that replaced a tracked file. Its target is read
        // as text, not followed: the target may be outside the repository. A Windows junction
        // is not looked for: git lists the files inside it, not the junction, and commits them
        // as regular files, so no clone gets the junction.
        if (stats.isSymbolicLink()) return { link: Buffer.from(readlinkSync(join(root, path))) };
        // git lists a folder as a single path when it is another repository: a submodule,
        // or a nested repository that is not tracked.
        if (stats.isDirectory()) return 'folder';
        return stats.isFile() ? readFileSync(join(root, path)) : undefined;
      } catch {
        return undefined;
      }
    },
    parseIndexEntries(stage.stdout),
  );
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  const files = collectPublishedFiles(root);

  // CI machines use generic account names, such as "runner", that also appear in prose.
  const onCi = process.env.CI !== undefined;
  if (onCi) console.log('CI is set: the name of the local user account is not checked');
  const problems = runChecks(files, {
    userName: onCi ? undefined : userInfo().username,
    isIgnored: (folder) => {
      // The question is about a file inside the folder, because a pattern such as `dist/`
      // only matches a folder, and the folder may not exist. `--no-index` asks the ignore
      // rules alone, whatever is tracked.
      const { status } = runGit(root, ['check-ignore', '-q', '--no-index', `${folder}/probe`]);
      if (status !== 0 && status !== 1) throw new Error(`git check-ignore failed for ${folder}`);
      return status === 0;
    },
  });

  for (const problem of problems) console.error(formatProblem(problem));
  console.log(
    `${String(files.paths.size)} published files checked, problems found: ${String(problems.length)}`,
  );
  process.exitCode = problems.length === 0 ? 0 : 1;
}
