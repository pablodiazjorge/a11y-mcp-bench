// Shows how lockedVersions reads the folders of the project and the links to them: npm installs
// a folder or a link without the registry, so none may lead outside the repository. The registry
// packages and the rest of the script are tested in check-lockfile-age.test.ts.

import { describe, expect, it } from 'vitest';
import { lockedVersions } from './check-lockfile-age.ts';
import { lockfile, tarball } from './check-lockfile-age.fixtures.ts';

describe('lockedVersions with project folders and links', () => {
  // The shapes that npm 11 writes for workspaces and for a `file:` dependency on a folder
  // inside the repository, including a link nested in a folder of the project.
  it('accepts project folders and links to them', () => {
    const lock = lockfile({
      '': { name: 'root', version: '0.0.0' },
      'node_modules/wcag-evidence-mcp': { resolved: 'packages/wcag-evidence-mcp', link: true },
      'node_modules/@scope/shop': { resolved: 'fixtures/shop', link: true },
      'node_modules/bench': { resolved: 'bench', link: true },
      'packages/wcag-evidence-mcp/node_modules/x': { resolved: 'fixtures/shop.v2', link: true },
      'node_modules/deep': { resolved: 'tools/a/b/deep_1~x', link: true },
      'packages/wcag-evidence-mcp': { version: '1.0.0' },
      'fixtures/shop': { name: '@scope/shop', version: '1.0.0' },
      'fixtures/shop.v2': { version: '2.0.0' },
      bench: { version: '0.0.0' },
      'tools/a/b/deep_1~x': {},
      'fixtures/shop/node_modules/a': { version: '1.0.0', resolved: tarball('a', '1.0.0') },
    });

    expect(lockedVersions(lock)).toEqual([{ name: 'a', version: '1.0.0' }]);
  });

  // npm writes a `file:` folder outside the repository as a key that starts with "..", and
  // `npm ci` installs it. It wrote an absolute path on the same drive that way too. The other
  // paths are not ones npm writes, and the check does not guess how npm would read them.
  it.each([
    ['the parent folder', '..'],
    ['the current folder', '.'],
    ['a folder next to the repository', '../local'],
    ['a path that climbs out', 'a/../../b'],
    ['a path that starts with "./"', './a'],
    ['an absolute path', '/abs'],
    ['a drive letter', 'C:/x'],
    ['a network share', '//share/x'],
    ['an empty segment', 'a//b'],
    ['a trailing slash', 'a/'],
    ['a segment that starts with a dot', '.tools/x'],
  ])('rejects a project folder at %s', (_case, path) => {
    const lock = lockfile({ [path]: { version: '1.0.0' } });

    expect(() => lockedVersions(lock)).toThrow(
      `${path} is not a plain folder path inside the repository`,
    );
  });

  // With `../local` and a `../local` entry, a real `npm ci` linked the folder outside the
  // repository. The target entry comes after the link, so that only the link check can fire.
  it.each([
    ['the root project', ''],
    ['a folder next to the repository', '../local'],
    ['a path that climbs out', 'packages/../../local'],
    ['a path that starts with "./"', './packages/a'],
    ['an absolute path', '/abs/local'],
    ['a drive letter', 'C:/local'],
    ['a network share', '//share/local'],
    ['a backslash', 'packages\\a'],
    ['a backslash after the first segment', 'packages/a\\b'],
    ['a registry package', 'node_modules/y'],
    ['a folder spelled like node_modules', 'Node_Modules/y'],
  ])('rejects a link to %s', (_case, resolved) => {
    const lock = lockfile({
      'node_modules/x': { resolved, link: true },
      [resolved]: { version: '1.0.0' },
    });

    expect(() => lockedVersions(lock)).toThrow(
      `node_modules/x links to "${resolved}", which is not a plain project folder path`,
    );
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
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
    [
      'a link with no folder',
      { 'node_modules/x': { link: true } },
      /node_modules\/x is a link with no "resolved" folder/,
    ],
    [
      'a link whose target has no entry',
      { 'node_modules/x': { resolved: 'packages/missing', link: true } },
      /links to "packages\/missing", which has no entry in the lockfile/,
    ],
    [
      'a link whose target only exists on the prototype of an object',
      { 'node_modules/x': { resolved: 'constructor', link: true } },
      /links to "constructor", which has no entry in the lockfile/,
    ],
    [
      'a link to a folder entry with a tarball',
      {
        'node_modules/x': { resolved: 'packages/a', link: true },
        'packages/a': { version: '1.0.0', resolved: tarball('x', '1.0.0') },
      },
      /links to "packages\/a", whose entry is not a project folder/,
    ],
    [
      'a link to another link',
      {
        'node_modules/x': { resolved: 'packages/a', link: true },
        'packages/a': { link: true, resolved: '../local' },
      },
      /links to "packages\/a", whose entry is not a project folder/,
    ],
    [
      'a link to a folder entry with a "link" field',
      {
        'node_modules/x': { resolved: 'packages/a', link: true },
        'packages/a': { version: '1.0.0', link: false },
      },
      /links to "packages\/a", whose entry is not a project folder/,
    ],
    [
      'a link to an entry that is not an object',
      { 'node_modules/x': { resolved: 'packages/a', link: true }, 'packages/a': 42 },
      /links to "packages\/a", whose entry is not a project folder/,
    ],
    // npm installs what the npm-shrinkwrap.json in a folder pins when the entry claims one.
    [
      'a link to a folder with _hasShrinkwrap',
      {
        'node_modules/x': { resolved: 'packages/a', link: true },
        'packages/a': { version: '1.0.0', _hasShrinkwrap: true },
      },
      /packages\/a claims an npm-shrinkwrap.json/,
    ],
    [
      'a link to a folder with hasShrinkwrap',
      {
        'node_modules/x': { resolved: 'packages/a', link: true },
        'packages/a': { version: '1.0.0', hasShrinkwrap: true },
      },
      /packages\/a claims an npm-shrinkwrap.json/,
    ],
    [
      'a link with hasShrinkwrap',
      {
        'node_modules/x': { resolved: 'packages/a', link: true, hasShrinkwrap: true },
        'packages/a': { version: '1.0.0' },
      },
      /node_modules\/x claims an npm-shrinkwrap.json/,
    ],
    [
      'a project folder with _hasShrinkwrap',
      { 'packages/a': { version: '1.0.0', _hasShrinkwrap: true } },
      /packages\/a claims an npm-shrinkwrap.json/,
    ],
  ])('rejects %s', (_case, packages, message) => {
    expect(() => lockedVersions(lockfile(packages))).toThrow(message);
  });

  // npm 11 writes a link only in the node_modules folder of the root or of a project folder.
  it.each([
    ['outside node_modules', 'tools/linked-package'],
    ['nested below a package folder', 'node_modules/a/extra'],
    ['inside a registry package', 'node_modules/a/node_modules/x'],
    ['in a folder next to the repository', '../out/node_modules/x'],
    ['in a path that climbs out', 'packages/../node_modules/x'],
  ])('rejects a link %s', (_case, path) => {
    const lock = lockfile({
      [path]: { resolved: 'packages/a', link: true },
      'packages/a': { version: '1.0.0' },
    });

    expect(() => lockedVersions(lock)).toThrow(
      `${path} is a link that is not a plain package name in the node_modules of the root or of a project folder`,
    );
  });
});
