// Fails when package-lock.json pins a version that is younger than the minimum release age set
// in .npmrc. npm only applies `min-release-age` while it resolves versions; `npm ci` installs
// whatever the lockfile pins without looking at dates, so CI checks the lockfile itself.

import { readFileSync } from 'node:fs';

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

/**
 * Lists every registry version that a lockfile (lockfileVersion 2 or 3) pins, without repeats.
 * Throws when an entry does not download what it declares, because its age cannot be checked.
 */
export function lockedVersions(lock: unknown): LockedVersion[] {
  if (!isRecord(lock) || !isRecord(lock.packages)) {
    throw new Error('package-lock.json has no "packages" map (lockfileVersion 2 or 3 expected)');
  }
  const marker = 'node_modules/';
  const seen = new Map<string, LockedVersion>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    const start = path.lastIndexOf(marker);
    // The root project and the workspaces themselves are not registry packages.
    if (start === -1 || !isRecord(entry)) continue;
    // A link points at a workspace folder, which has its own entry. A bundled dependency
    // ships inside the tarball of its parent, whose age is checked.
    if (entry.link === true || entry.inBundle === true) continue;
    if (typeof entry.version !== 'string') continue;
    // An alias (`"a": "npm:b@1"`) lives in the folder of the alias and records the real name.
    const name = typeof entry.name === 'string' ? entry.name : path.slice(start + marker.length);
    // `npm ci` downloads `resolved`, so the name and the version must be the ones in that URL.
    const tarball = `${REGISTRY}${name}/-/${name.split('/').pop() ?? name}-${entry.version}.tgz`;
    if (typeof entry.resolved === 'string' && entry.resolved !== tarball) {
      throw new Error(
        `${path} resolves to ${entry.resolved}, not to ${tarball}; its age cannot be checked`,
      );
    }
    seen.set(`${name}@${entry.version}`, { name, version: entry.version });
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
    const url = `${REGISTRY}${name.replace('/', '%2F')}`;
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
