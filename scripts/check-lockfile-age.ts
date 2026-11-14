// Fails when package-lock.json pins a version that is younger than the minimum release age set
// in .npmrc. npm only applies `min-release-age` while it resolves versions; `npm ci` installs
// whatever the lockfile pins without looking at dates, so CI checks the lockfile itself.

import { existsSync, readFileSync } from 'node:fs';

export interface Policy {
  /** Minimum age of a version, in days. Zero means that .npmrc does not set it. */
  days: number;
  /** Exact package names that are allowed to be younger. */
  exclude: string[];
}

export interface LockedVersion {
  name: string;
  version: string;
}

export interface YoungVersion extends LockedVersion {
  /** Publication date as the registry gives it, or undefined when it does not list the version. */
  published: string | undefined;
}

/** Returns the publication date of every version of a package, keyed by version. */
export type PublishTimes = (name: string) => Promise<Record<string, string>>;

const DAY_MS = 86_400_000;
const REGISTRY = 'https://registry.npmjs.org/';
// A plain package name, with or without a scope: letters, digits, `_`, `-`, `~` and, after
// the first character, dots. Apart from the slash after a scope, nothing that a URL reads
// as syntax.
const PLAIN_NAME = /^(?:@[\w~-][\w.~-]*\/)?[\w~-][\w.~-]*$/;
// An exact version, with or without a pre-release part and without build metadata, which
// npm drops when it publishes. Not a range, a tag or an alias.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
// A folder inside the repository, as npm writes it in a lockfile: relative, separated by "/"
// and already normalized. Each segment starts with a letter, a digit, `_`, `-` or `~`, so
// `.` and `..` cannot leave the repository, and nothing reads as a drive, a root or a share.
const PROJECT_FOLDER = /^[\w~-][\w.~-]*(?:\/[\w~-][\w.~-]*)*$/;

/** Tells whether a lockfile path names a folder of the project that npm does not download. */
function isProjectFolder(path: string): boolean {
  return PROJECT_FOLDER.test(path) && !/node_modules/i.test(path);
}

/**
 * Reads `min-release-age` and `min-release-age-exclude` from the text of an .npmrc file.
 *
 * npm reads .npmrc with rules that are easy to get subtly wrong (quoted keys, comments after
 * a value, environment variables, sections). Reading one line differently from npm could
 * exempt a package that npm would not, so this reader does not try to imitate them: it
 * accepts only a plain file, made of comment lines and `key=value` lines with a lowercase
 * key and a bare value, and it fails on anything else.
 */
export function readPolicy(npmrc: string): Policy {
  // Printable ASCII, tabs and line feeds only: no lone carriage return, no other line separator.
  const text = npmrc.replaceAll('\r\n', '\n');
  if (!/^[\t\n\x20-\x7e]*$/.test(text)) {
    throw new Error('.npmrc: this check only reads plain ASCII with ordinary line endings');
  }
  const policy: Policy = { days: 0, exclude: [] };
  let plainExcludeSeen = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const parts = /^([a-z][a-z0-9-]*(?:\[\])?)[\t ]*=[\t ]*([\w@./,\t -]*)$/.exec(line);
    if (parts === null) {
      throw new Error(`.npmrc: this check only reads plain "key=value" lines, not "${line}"`);
    }
    const key = parts[1] ?? '';
    const value = (parts[2] ?? '').trim();
    if (key === 'min-release-age') {
      const days = Number(value);
      if (value === '' || !Number.isFinite(days) || days < 0) {
        throw new Error(`.npmrc: min-release-age must be a number of days, got "${value}"`);
      }
      policy.days = days;
    } else if (key === 'min-release-age-exclude[]' || key === 'min-release-age-exclude') {
      if (key === 'min-release-age-exclude') {
        // npm keeps only the last line of a key without `[]`.
        if (plainExcludeSeen) {
          throw new Error('.npmrc: min-release-age-exclude is repeated; use the "[]" form');
        }
        plainExcludeSeen = true;
      }
      for (const name of value.split(',').map((part) => part.trim())) {
        if (name === '') continue;
        // npm would read these three words as values, not as package names.
        if (name === 'true' || name === 'false' || name === 'null' || /\s/.test(name)) {
          throw new Error(`.npmrc: "${name}" is not a package name this check can exempt`);
        }
        policy.exclude.push(name);
      }
    } else if (key.includes('min-release-age')) {
      throw new Error(`.npmrc: this check does not know the key "${key}"`);
    }
  }
  return policy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a field of a lockfile entry that npm writes as a string or leaves out. */
function optionalString(
  entry: Record<string, unknown>,
  field: string,
  path: string,
): string | undefined {
  const value = entry[field];
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${path}: "${field}" is not a string`);
  }
  return value;
}

/**
 * Lists every registry version that a lockfile (lockfileVersion 3) pins, without repeats.
 *
 * Like the .npmrc reader, it does not guess what npm does with an unusual entry. Every entry
 * must have one of the four shapes that this check understands: the root project, a folder of the project
 * (a workspace), a link to such a folder, or a registry package under node_modules. Anything
 * else throws, because npm could still download an entry that this check had skipped. A folder
 * or a link that leaves the repository throws too: npm installs it without the registry.
 */
export function lockedVersions(lock: unknown): LockedVersion[] {
  if (!isRecord(lock) || !isRecord(lock.packages)) {
    throw new Error('package-lock.json has no "packages" map (lockfileVersion 3 expected)');
  }
  // Older formats carry a second list of packages, which this check does not read.
  if (lock.lockfileVersion !== 3 || lock.dependencies !== undefined) {
    throw new Error('package-lock.json is not a plain lockfileVersion 3 file');
  }
  const packages = lock.packages;
  const marker = 'node_modules/';
  const seen = new Map<string, LockedVersion>();
  for (const [path, entry] of Object.entries(packages)) {
    if (!isRecord(entry)) throw new Error(`"${path}" is not an object`);
    const declaredName = optionalString(entry, 'name', path);
    const version = optionalString(entry, 'version', path);
    const resolved = optionalString(entry, 'resolved', path);
    if (entry.link !== undefined && typeof entry.link !== 'boolean') {
      throw new Error(`${path}: "link" is not true or false`);
    }
    // The root project.
    if (path === '') continue;
    // npm writes "/" on every system, and on Windows it reads "\" as a separator.
    if (path.includes('\\')) throw new Error(`${path}: lockfile paths use "/" only`);
    // npm installs what an npm-shrinkwrap.json pins, and this check cannot see inside a
    // tarball. A project folder whose entry has `_hasShrinkwrap` makes npm read the file in
    // the folder, so either flag on any entry fails.
    if (entry.hasShrinkwrap !== undefined || entry._hasShrinkwrap !== undefined) {
      throw new Error(`${path} claims an npm-shrinkwrap.json, whose pins cannot be checked`);
    }
    const start = `/${path}`.lastIndexOf(`/${marker}`);
    if (entry.link === true) {
      // A link is a symlink that npm puts in the node_modules folder of the root or of a
      // folder of the project, the only two places where npm 11 writes one.
      const parent = path.slice(0, Math.max(start - 1, 0));
      if (
        start === -1 ||
        (parent !== '' && !isProjectFolder(parent)) ||
        !PLAIN_NAME.test(path.slice(start + marker.length))
      ) {
        throw new Error(
          `${path} is a link that is not a plain package name in the node_modules of the root or of a project folder`,
        );
      }
      if (resolved === undefined) throw new Error(`${path} is a link with no "resolved" folder`);
      // npm makes the symlink when `resolved` leads to the key of an entry, and it accepts a
      // key outside the repository, such as the "../local" of a `file:../local` dependency.
      // npm writes `resolved` already normalized, so this check reads no other spelling.
      if (!isProjectFolder(resolved)) {
        throw new Error(`${path} links to "${resolved}", which is not a plain project folder path`);
      }
      // `Object.hasOwn`, because a folder may be called `constructor`.
      const target = Object.hasOwn(packages, resolved) ? packages[resolved] : undefined;
      if (target === undefined) {
        throw new Error(`${path} links to "${resolved}", which has no entry in the lockfile`);
      }
      if (!isRecord(target) || target.link !== undefined || target.resolved !== undefined) {
        throw new Error(`${path} links to "${resolved}", whose entry is not a project folder`);
      }
      continue;
    }
    if (start === -1) {
      // A folder of the project. npm downloads nothing for it, so it has no tarball, and
      // its path is not another spelling of node_modules.
      if (resolved !== undefined || /node_modules/i.test(path)) {
        throw new Error(`${path} is not a project folder that this check can skip`);
      }
      // npm writes a folder outside the repository as a path that starts with "..".
      if (!isProjectFolder(path)) {
        throw new Error(`${path} is not a plain folder path inside the repository`);
      }
      continue;
    }
    // From here on, a registry package. A bundled one (`inBundle`) is checked like the rest:
    // when its parent does not really bundle it, npm takes it from the registry.
    // An alias (`"a": "npm:b@1"`) lives in the folder of the alias and records the real name.
    const name = declaredName ?? path.slice(start + marker.length);
    // The name becomes part of two URLs, and a URL rewrites some characters: a backslash
    // counts as a slash and `..` goes up one folder. With them, the dates read here could
    // belong to a different package from the one that `npm ci` downloads.
    if (!PLAIN_NAME.test(name)) {
      throw new Error(`${path} names "${name}", which is not a plain package name`);
    }
    if (version === undefined || !EXACT_VERSION.test(version)) {
      throw new Error(
        `${path} has no plain exact version (${version ?? 'none'}); its age cannot be checked`,
      );
    }
    // `npm ci` downloads `resolved`, so the name and the version must be the ones in that URL.
    // Without `resolved`, npm asks the registry for this name and this version.
    const tarball = `${REGISTRY}${name}/-/${name.split('/').pop() ?? name}-${version}.tgz`;
    if (resolved !== undefined && resolved !== tarball) {
      throw new Error(
        `${path} resolves to ${resolved}, not to ${tarball}; its age cannot be checked`,
      );
    }
    seen.set(`${name}@${version}`, { name, version });
  }
  return [...seen.values()];
}

/** Returns the pinned versions that were published less than `policy.days` days before `now`. */
export async function youngVersions(
  versions: readonly LockedVersion[],
  policy: Policy,
  times: PublishTimes,
  now: number,
  concurrency = 16,
): Promise<YoungVersion[]> {
  const cutoff = now - policy.days * DAY_MS;
  const pending = versions.filter(({ name }) => !policy.exclude.includes(name));
  const young: YoungVersion[] = [];
  const cache = new Map<string, Promise<Record<string, string>>>();
  let next = 0;

  async function worker(): Promise<void> {
    while (next < pending.length) {
      const item = pending[next++];
      if (item === undefined) return;
      let request = cache.get(item.name);
      if (request === undefined) {
        request = times(item.name);
        cache.set(item.name, request);
      }
      const published = (await request)[item.version];
      // Written as a negation so that a date that cannot be parsed (NaN) counts as young.
      if (published === undefined || !(Date.parse(published) <= cutoff)) {
        young.push({ ...item, published });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  return young.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

export interface RegistryOptions {
  /** Extra attempts after a network error, a timeout, a 429 or a 5xx answer. */
  retries?: number;
  /** Pause before each extra attempt, in milliseconds. */
  retryDelayMs?: number;
  /** Time limit of each request, headers and body, in milliseconds. */
  timeoutMs?: number;
}

type Attempt = { text: string } | { retry: unknown } | { fatal: Error };

/** Makes one request. Only a failure that can change is reported as worth another attempt. */
async function request(url: string, timeoutMs: number): Promise<Attempt> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) return { text: await response.text() };
    await response.body?.cancel();
    const error = new Error(`${url} answered ${String(response.status)}`);
    return response.status === 429 || response.status >= 500 ? { retry: error } : { fatal: error };
  } catch (error) {
    // The connection failed, the body broke while it was read or the time limit ran out.
    return { retry: error };
  }
}

/** Builds a function that asks the npm registry for the publication dates of a package. */
export function createRegistryTimes(options: RegistryOptions = {}): PublishTimes {
  const { retries = 2, retryDelayMs = 2_000, timeoutMs = 30_000 } = options;
  return async (name) => {
    // Plain names, which lockedVersions enforces, have at most one slash: the one after
    // the scope.
    const url = `${REGISTRY}${name.replaceAll('/', '%2F')}`;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      const result = await request(url, timeoutMs);
      if ('fatal' in result) throw result.fatal;
      if ('retry' in result) {
        lastError = result.retry;
        continue;
      }
      let body: unknown;
      try {
        body = JSON.parse(result.text);
      } catch (error) {
        throw new Error(`${url} did not answer with JSON`, { cause: error });
      }
      const times: Record<string, string> = {};
      if (isRecord(body) && isRecord(body.time)) {
        for (const [version, date] of Object.entries(body.time)) {
          if (typeof date === 'string') times[version] = date;
        }
      }
      return times;
    }
    throw new Error(`${url} could not be read after ${String(retries + 1)} attempts`, {
      cause: lastError,
    });
  };
}

if (import.meta.main) {
  const policy = readPolicy(readFileSync('.npmrc', 'utf8'));
  if (policy.days === 0) {
    throw new Error('.npmrc does not set min-release-age, so there is nothing to check against');
  }
  // When both files exist, npm installs from npm-shrinkwrap.json.
  if (existsSync('npm-shrinkwrap.json')) {
    throw new Error('npm-shrinkwrap.json exists, and this check only reads package-lock.json');
  }
  const lock: unknown = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const versions = lockedVersions(lock);
  const young = await youngVersions(versions, policy, createRegistryTimes(), Date.now());
  for (const { name, version, published } of young) {
    console.error(`${name}@${version}: ${published ?? 'not listed by the registry'}`);
  }
  const days = String(policy.days);
  console.log(
    `${String(versions.length)} locked versions checked, ${String(young.length)} younger than ${days} days`,
  );
  process.exitCode = young.length === 0 ? 0 : 1;
}
