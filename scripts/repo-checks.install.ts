// The repository checks that keep the install scripts of dependencies from running: .npmrc turns
// them off, and a new dependency that has one shows up in review. repo-checks.ts runs them with
// the others.

interface Problem {
  file: string;
  line?: number;
  message: string;
}

/**
 * The packages of the lockfile that may have an install script, which npm does not run. Adding
 * one needs the author's approval, with the reason in the pull request (`AGENTS.md`).
 */
export const INSTALL_SCRIPT_ALLOWLIST: readonly string[] = [
  // macOS only, optional, and a dependency of a development tool; it builds nothing that the
  // tools here need.
  'fsevents',
];

const NPMRC = '.npmrc';
const LOCKFILE = 'package-lock.json';
const SETTING = 'ignore-scripts=true';
const MODULES = 'node_modules/';

/**
 * Checks that `.npmrc` turns install scripts off: one line `ignore-scripts=true`, and no other
 * line about that key, since npm keeps the last value it reads. It guards security, so a line in
 * another form, such as `ignore-scripts = true`, is reported rather than read.
 */
export function checkIgnoreScripts(texts: ReadonlyMap<string, string>): Problem[] {
  const text = texts.get(NPMRC);
  if (text === undefined) return [{ file: NPMRC, message: `missing, so ${SETTING} is not set` }];
  const problems: Problem[] = [];
  let set = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*[#;]/.test(line) || !/ignore-scripts/i.test(line)) return;
    if (line === SETTING && !set) {
      set = true;
      return;
    }
    problems.push({
      file: NPMRC,
      line: index + 1,
      message: `sets ignore-scripts in a form that this check does not read; write ${SETTING} once`,
    });
  });
  if (!set) problems.push({ file: NPMRC, message: `does not set ${SETTING}` });
  return problems;
}

/**
 * Checks that no package of the lockfile has an install script unless it is on the allowlist, so
 * that a new one shows up in review. An aliased package counts under both names: the name of its
 * folder and the `name` that the lockfile records for it, so that an alias cannot borrow the name
 * of an allowed package.
 */
export function checkInstallScripts(
  texts: ReadonlyMap<string, string>,
  allowed: readonly string[] = INSTALL_SCRIPT_ALLOWLIST,
): Problem[] {
  const text = texts.get(LOCKFILE);
  let packages: unknown;
  try {
    packages =
      text === undefined ? undefined : (JSON.parse(text) as { packages?: unknown }).packages;
  } catch {
    packages = undefined;
  }
  if (typeof packages !== 'object' || packages === null) {
    return [{ file: LOCKFILE, message: 'has no "packages" that this check can read' }];
  }
  const problems: Problem[] = [];
  const lines = (text ?? '').split(/\r?\n/);
  for (const [path, entry] of Object.entries(packages as Record<string, unknown>)) {
    const scripted = typeof entry === 'object' && entry !== null && 'hasInstallScript' in entry;
    if (!scripted || entry.hasInstallScript === false) continue;
    const at = path.lastIndexOf(MODULES);
    const folder = at === -1 ? path : path.slice(at + MODULES.length);
    const name = 'name' in entry && typeof entry.name === 'string' ? entry.name : folder;
    if (allowed.includes(folder) && allowed.includes(name)) continue;
    const line = lines.findIndex((each) => each.includes(`${JSON.stringify(path)}: {`)) + 1;
    problems.push({
      file: LOCKFILE,
      ...(line > 0 ? { line } : {}),
      message: `${path === '' ? 'the root package' : name} has an install script and is not on the allowlist of scripts/repo-checks.install.ts`,
    });
  }
  return problems;
}
