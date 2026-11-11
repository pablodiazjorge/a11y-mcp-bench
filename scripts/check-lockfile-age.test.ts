import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRegistryTimes,
  lockedVersions,
  readPolicy,
  youngVersions,
  type PublishTimes,
} from './check-lockfile-age.ts';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

describe('readPolicy', () => {
  it('reads the minimum age and the excluded packages', () => {
    const npmrc = [
      'save-exact=true',
      '# a comment with min-release-age=99 inside',
      '; another comment',
      'min-release-age = 7',
      'min-release-age-exclude[]=left-pad',
      'min-release-age-exclude[]=@scope/pkg',
      'min-release-age-exclude=one, two',
    ].join('\r\n');

    expect(readPolicy(npmrc)).toEqual({
      days: 7,
      exclude: ['left-pad', '@scope/pkg', 'one', 'two'],
    });
  });

  it('reports zero days when the option is missing', () => {
    expect(readPolicy('save-exact=true\n')).toEqual({ days: 0, exclude: [] });
  });

  it('keeps the last minimum age, as npm does', () => {
    expect(readPolicy('min-release-age=7\nmin-release-age=30').days).toBe(30);
  });

  it('rejects a value that is not a number of days', () => {
    expect(() => readPolicy('min-release-age=soon')).toThrow(/number of days/);
    expect(() => readPolicy('min-release-age=-1')).toThrow(/number of days/);
    expect(() => readPolicy('min-release-age=')).toThrow(/number of days/);
  });

  // Every line here is one that npm reads differently from a naive reader. With the first
  // six, a naive reader keeps 7 days where npm reads 30; with the rest, it exempts a package
  // that npm does not.
  it.each([
    ['a quoted key', 'min-release-age=7\n"min-release-age"=30'],
    ['a comment sign in the key', 'min-release-age=7\nmin-release-age#x=30'],
    ['an environment variable in the key', 'min-release-age=7\nmin-release-age${NOPE?}=30'],
    ['a comment after the value', 'min-release-age=7 ; a week'],
    ['a lone carriage return', 'min-release-age=7\n# note\rmin-release-age=30'],
    ['a Unicode line separator', 'min-release-age=30\nmin-release-age=1 '],
    ['a section', '[section]\nmin-release-age-exclude[]=evil'],
    ['a section after a lone carriage return', '# note\r[x]\nmin-release-age-exclude[]=evil'],
    ['a quoted value', 'min-release-age-exclude[]="evil"'],
    ['a key without a value', 'min-release-age-exclude=evil\nmin-release-age-exclude'],
    ['a glob pattern with a star', 'min-release-age-exclude[]=@scope/*'],
    ['a glob pattern with a question mark', 'min-release-age-exclude[]=lodas?'],
    ['a glob pattern with brackets', 'min-release-age-exclude[]=lod[ab]sh'],
    ['a comment after an exclusion', 'min-release-age-exclude=a # later, lodash'],
  ])('rejects %s', (_case, npmrc) => {
    expect(() => readPolicy(npmrc)).toThrow(/only reads plain/);
  });

  it('rejects the other forms it could read differently from npm', () => {
    // npm keeps only the last line of a key without "[]".
    expect(() => readPolicy('min-release-age-exclude=a\nmin-release-age-exclude=b')).toThrow(
      /repeated/,
    );
    // A key that only looks like the ones it reads.
    expect(() => readPolicy('min-release-age-excluded[]=a')).toThrow(/does not know/);
    // npm reads these words as values, not as package names.
    expect(() => readPolicy('min-release-age-exclude[]=true')).toThrow(/not a package name/);
    expect(() => readPolicy('min-release-age-exclude=two words')).toThrow(/not a package name/);
  });
});

describe('lockedVersions', () => {
  const lockfile = (packages: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    lockfileVersion: 3,
    packages,
    ...extra,
  });
  const tarball = (name: string, version: string) =>
    `https://registry.npmjs.org/${name}/-/${name.split('/').pop() ?? name}-${version}.tgz`;

  it('lists registry packages once, including nested, scoped, aliased and bundled ones', () => {
    const lock = lockfile({
      '': { name: 'root', version: '0.0.0' },
      'packages/server': { name: 'server', version: '1.0.0' },
      'node_modules/server': { resolved: 'packages/server', link: true },
      'node_modules/a': { version: '1.0.0', resolved: tarball('a', '1.0.0') },
      'node_modules/b/node_modules/a': { version: '1.0.0' },
      'node_modules/b/node_modules/@scope/c': {
        version: '2.1.0-rc.1',
        resolved: tarball('@scope/c', '2.1.0-rc.1'),
      },
      'node_modules/alias': {
        name: 'real-name',
        version: '3.0.0',
        resolved: tarball('real-name', '3.0.0'),
      },
      'node_modules/parent/node_modules/bundled': { version: '9.9.9', inBundle: true },
    });

    expect(lockedVersions(lock)).toEqual([
      { name: 'a', version: '1.0.0' },
      { name: '@scope/c', version: '2.1.0-rc.1' },
      { name: 'real-name', version: '3.0.0' },
      { name: 'bundled', version: '9.9.9' },
    ]);
  });

  it('rejects a package that does not come from the npm registry', () => {
    const lock = lockfile({
      'node_modules/from-git': {
        version: '1.0.0',
        resolved: 'git+ssh://git@github.com/owner/repo.git#abc',
      },
    });

    expect(() => lockedVersions(lock)).toThrow(/from-git resolves to git\+ssh/);
  });

  it('rejects an entry whose name or version is not the one it downloads', () => {
    const entry = (fields: Record<string, string>) =>
      lockfile({ 'node_modules/x': { version: '1.0.0', ...fields } });

    expect(() => lockedVersions(entry({ resolved: tarball('x', '2.0.0') }))).toThrow(
      'not to https://registry.npmjs.org/x/-/x-1.0.0.tgz',
    );
    expect(() =>
      lockedVersions(entry({ name: 'old-and-safe', resolved: tarball('x', '1.0.0') })),
    ).toThrow(/cannot be checked/);
  });

  // The first name is a real bypass without this rule: the URL parser reads the backslashes
  // as slashes, so this check would read the dates of `left-pad` while `npm ci` downloads
  // `@evil/left-pad`.
  it.each([
    ['backslashes', '@evil/x\\..\\left-pad'],
    ['a parent folder', '@evil/x/../left-pad'],
    ['only dots', '..'],
    ['an encoded character', '%2e%2e'],
    ['a query', 'left-pad?x'],
    ['a fragment', 'left-pad#x'],
    ['a space at the end', 'left-pad '],
    ['a tab inside', 'left\t-pad'],
    ['three segments', 'a/b/c'],
    ['an empty scope', '@/left-pad'],
    ['no characters', ''],
  ])('rejects a name with %s', (_case, name) => {
    const lock = lockfile({
      'node_modules/left-pad': { name, version: '1.3.0', resolved: tarball(name, '1.3.0') },
    });

    expect(() => lockedVersions(lock)).toThrow(/not a plain package name/);
  });

  it('accepts plain names, with or without a scope', () => {
    const names = ['left-pad', 'JSONStream', 'lodash.merge', '@types/node', '@scope/a_b~c'];
    const packages = Object.fromEntries(
      names.map((name) => [`node_modules/${name}`, { version: '1.0.0' }]),
    );

    expect(lockedVersions(lockfile(packages)).map((entry) => entry.name)).toEqual(names);
  });

  // An entry that this check skipped could still be downloaded. With the first three
  // lockfiles, a real `npm ci` installed a package that the check had not looked at.
  it.each<[string, Record<string, unknown>, RegExp]>([
    [
      'a registry package without a version',
      { 'node_modules/x': { resolved: tarball('x', '1.0.0') } },
      /no plain exact version \(none\)/,
    ],
    [
      'a backslash in the path',
      { 'node_modules\\x': { version: '1.0.0', resolved: tarball('x', '1.0.0') } },
      /use "\/" only/,
    ],
    [
      'a package that ships its own npm-shrinkwrap.json',
      { 'node_modules/x': { version: '1.0.0', hasShrinkwrap: true } },
      /ships its own npm-shrinkwrap.json/,
    ],
    [
      'a folder nested under a package',
      { 'node_modules/a/extra/x': { version: '1.0.0' } },
      /not a plain package name/,
    ],
    ['an empty entry', { 'node_modules/x': {} }, /no plain exact version/],
    [
      'a range as the version',
      { 'node_modules/x': { version: '^1.0.0' } },
      /no plain exact version/,
    ],
    ['a tag as the version', { 'node_modules/x': { version: 'latest' } }, /no plain exact version/],
    [
      'build metadata in the version',
      { 'node_modules/x': { version: '1.0.0+build.1' } },
      /no plain exact version/,
    ],
    [
      'an alias as the version',
      { 'node_modules/x': { version: 'npm:evil@1.0.0' } },
      /no plain exact version/,
    ],
    ['an entry that is not an object', { 'node_modules/x': '1.0.0' }, /is not an object/],
    ['a version that is not a string', { 'node_modules/x': { version: 1 } }, /"version" is not/],
    [
      'a name that is not a string',
      { 'node_modules/x': { name: ['x'], version: '1.0.0' } },
      /"name" is not/,
    ],
    [
      'a tarball that is not a string',
      { 'node_modules/x': { version: '1.0.0', resolved: false } },
      /"resolved" is not/,
    ],
    ['a link that is not true or false', { 'node_modules/x': { link: 'yes' } }, /"link" is not/],
    [
      'a project folder with a tarball',
      { 'tools/x': { name: 'x', version: '1.0.0', resolved: tarball('x', '1.0.0') } },
      /not a project folder/,
    ],
    [
      'a folder spelled like node_modules',
      { 'Node_Modules/x': { name: 'x', version: '1.0.0' } },
      /not a project folder/,
    ],
  ])('rejects %s', (_case, packages, message) => {
    expect(() => lockedVersions(lockfile(packages))).toThrow(message);
  });

  it('rejects a lockfile that is not a plain lockfileVersion 3 file', () => {
    expect(() => lockedVersions({ lockfileVersion: 1, dependencies: {} })).toThrow(/packages/);
    expect(() => lockedVersions(null)).toThrow(/packages/);
    expect(() => lockedVersions({ lockfileVersion: 2, packages: {} })).toThrow(/plain/);
    expect(() => lockedVersions({ packages: {} })).toThrow(/plain/);
    expect(() => lockedVersions(lockfile({}, { dependencies: {} }))).toThrow(/plain/);
  });
});

describe('youngVersions', () => {
  const times: PublishTimes = (name) =>
    Promise.resolve(
      {
        old: { '1.0.0': daysAgo(30) },
        boundary: { '1.0.0': daysAgo(7) },
        young: { '1.0.0': daysAgo(30), '1.1.0': daysAgo(6.9) },
        excluded: { '3.0.0': daysAgo(1) },
        garbled: { '1.0.0': 'not a date' },
      }[name] ?? {},
    );
  const policy = { days: 7, exclude: ['excluded'] };

  it('reports young versions, unlisted versions and dates that cannot be read', async () => {
    const versions = [
      { name: 'old', version: '1.0.0' },
      { name: 'boundary', version: '1.0.0' },
      { name: 'young', version: '1.0.0' },
      { name: 'young', version: '1.1.0' },
      { name: 'excluded', version: '3.0.0' },
      { name: 'unknown', version: '0.1.0' },
      { name: 'garbled', version: '1.0.0' },
    ];

    expect(await youngVersions(versions, policy, times, NOW)).toEqual([
      { name: 'garbled', version: '1.0.0', published: 'not a date' },
      { name: 'unknown', version: '0.1.0', published: undefined },
      { name: 'young', version: '1.1.0', published: daysAgo(6.9) },
    ]);
  });

  it.each([1, 16])('asks the registry once per package with %i workers', async (concurrency) => {
    const asked: string[] = [];
    const counting: PublishTimes = async (name) => {
      asked.push(name);
      // Yields, so that with several workers a second request could start before this one ends.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return times(name);
    };
    const versions = [
      { name: 'young', version: '1.0.0' },
      { name: 'young', version: '1.1.0' },
      { name: 'old', version: '1.0.0' },
    ];

    await youngVersions(versions, policy, counting, NOW, concurrency);

    expect(asked).toEqual(['young', 'old']);
  });

  it('fails when the publication dates cannot be read', async () => {
    const failing: PublishTimes = () => Promise.reject(new Error('registry down'));

    await expect(
      youngVersions([{ name: 'old', version: '1.0.0' }], policy, failing, NOW),
    ).rejects.toThrow('registry down');
  });

  it('returns nothing for an empty lockfile', async () => {
    expect(await youngVersions([], policy, times, NOW)).toEqual([]);
  });
});

describe('createRegistryTimes', () => {
  const quick = { retries: 2, retryDelayMs: 0 };
  /** Stubs `fetch` with a list of answers; the last one repeats. */
  function stubFetch(...answers: (() => Promise<Response>)[]) {
    let index = 0;
    const stub = vi.fn((_url: string, _init?: RequestInit) => {
      const answer = answers[Math.min(index++, answers.length - 1)];
      if (answer === undefined) throw new Error('stubFetch needs at least one answer');
      return answer();
    });
    vi.stubGlobal('fetch', stub);
    return stub;
  }
  const json = (body: unknown) => () => Promise.resolve(Response.json(body));
  const status = (code: number) => () => Promise.resolve(new Response('no', { status: code }));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the registry for a scoped package and keeps only the dates', async () => {
    const fetchStub = stubFetch(
      json({ time: { created: '2026-01-01T00:00:00.000Z', '1.0.0': 'x', bad: 5 } }),
    );

    expect(await createRegistryTimes(quick)('@scope/pkg')).toEqual({
      created: '2026-01-01T00:00:00.000Z',
      '1.0.0': 'x',
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]?.[0]).toBe('https://registry.npmjs.org/@scope%2Fpkg');
  });

  it('encodes every slash of a name', async () => {
    const fetchStub = stubFetch(json({ time: {} }));

    await createRegistryTimes(quick)('a/b/c');

    expect(fetchStub.mock.calls[0]?.[0]).toBe('https://registry.npmjs.org/a%2Fb%2Fc');
  });

  it('gives each request a time limit', async () => {
    const fetchStub = stubFetch(json({ time: {} }));

    await createRegistryTimes(quick)('pkg');

    expect(fetchStub.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns no dates when the answer has no time map', async () => {
    stubFetch(json({ name: 'pkg' }));

    expect(await createRegistryTimes(quick)('pkg')).toEqual({});
  });

  it('retries after a network error and after a 503', async () => {
    const fetchStub = stubFetch(
      () => Promise.reject(new TypeError('fetch failed')),
      status(503),
      json({ time: { '1.0.0': 'x' } }),
    );

    expect(await createRegistryTimes(quick)('pkg')).toEqual({ '1.0.0': 'x' });
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it('retries when the body breaks while it is read', async () => {
    const broken = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('terminated'));
            },
          }),
        ),
      );
    const fetchStub = stubFetch(broken, json({ time: { '1.0.0': 'x' } }));

    expect(await createRegistryTimes(quick)('pkg')).toEqual({ '1.0.0': 'x' });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last retry', async () => {
    const fetchStub = stubFetch(status(429));

    await expect(createRegistryTimes(quick)('pkg')).rejects.toThrow(/after 3 attempts/);
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it('does not retry an answer that will not change, such as a 404', async () => {
    const fetchStub = stubFetch(status(404));

    await expect(createRegistryTimes(quick)('pkg')).rejects.toThrow(/404/);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('names the address when the answer is not JSON', async () => {
    const fetchStub = stubFetch(() => Promise.resolve(new Response('<html>proxy</html>')));

    await expect(createRegistryTimes(quick)('pkg')).rejects.toThrow(
      'https://registry.npmjs.org/pkg did not answer with JSON',
    );
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
