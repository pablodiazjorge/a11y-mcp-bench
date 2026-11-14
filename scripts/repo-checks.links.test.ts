import { describe, expect, it } from 'vitest';
import {
  formatProblem,
  parseIndexEntries,
  readPublishedFiles,
  type DiskEntry,
  type IndexEntry,
  type Problem,
} from './repo-checks.ts';

// The tests of the git modes: the index entries that `git ls-files --stage -z` prints, and
// the links, submodules and other paths that are not regular files.

const SHA1 = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const SHA256 = 'a'.repeat(64);
const N_WITH_TILDE = String.fromCharCode(0xf1);
const LINK =
  'is a symbolic link, which may lead outside the repository: npm follows one under a workspace folder';
const TARGET = ['..', '..', 'outside'].join('/');

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const entry = (mode: string, path: string, stage = 0): IndexEntry => ({ mode, stage, path });
const report = (problems: readonly Problem[]): string[] => problems.map(formatProblem);

describe('parseIndexEntries', () => {
  it('reads every entry, with its mode, stage and path', () => {
    const output = [
      `100644 ${SHA1} 0\ta.txt`,
      `120000 ${SHA256} 0\tpackages/evil`,
      `100755 ${SHA1} 3\tdocs/a b ${N_WITH_TILDE}.md`,
      `160000 ${SHA1} 1\tpath\twith a tab\nand a line break`,
    ].join('\0');

    expect(parseIndexEntries(`${output}\0`)).toEqual([
      entry('100644', 'a.txt'),
      entry('120000', 'packages/evil'),
      entry('100755', `docs/a b ${N_WITH_TILDE}.md`, 3),
      entry('160000', 'path\twith a tab\nand a line break', 1),
    ]);
    expect(parseIndexEntries('')).toEqual([]);
  });

  it.each([
    ['a mode that is not octal', `100648 ${SHA1} 0\ta.txt\0`],
    ['text before the mode', `x100644 ${SHA1} 0\ta.txt\0`],
    ['an object name of 41 characters', `100644 ${SHA1}a 0\ta.txt\0`],
    ['a mode with five digits', `10644 ${SHA1} 0\ta.txt\0`],
    ['an object name that is too short', `100644 ${SHA1.slice(1)} 0\ta.txt\0`],
    ['an object name in upper case', `100644 ${SHA1.toUpperCase()} 0\ta.txt\0`],
    ['a stage above 3', `100644 ${SHA1} 4\ta.txt\0`],
    ['a space instead of the tab', `100644 ${SHA1} 0 a.txt\0`],
    ['an empty path', `100644 ${SHA1} 0\t\0`],
    ['a field too many', `100644 ${SHA1} 0 0\ta.txt\0`],
    [
      'an empty entry between two',
      [`100644 ${SHA1} 0\ta.txt`, '', `100644 ${SHA1} 0\tb.txt\0`].join('\0'),
    ],
    ['a line that is only a path', 'a.txt\0'],
  ])('throws on %s', (_case, output) => {
    expect(() => parseIndexEntries(output)).toThrow(/entry \d+ cannot be read/);
  });

  it('throws when the last entry does not end with a null byte', () => {
    expect(() => parseIndexEntries(`100644 ${SHA1} 0\ta.txt`)).toThrow(/null byte/);
  });
});

describe('readPublishedFiles and the git modes', () => {
  const read =
    (disk: Record<string, DiskEntry>) =>
    (path: string): DiskEntry =>
      disk[path];

  it.each([
    ['100644', []],
    ['100755', []],
    ['120000', [`a.txt: ${LINK}`]],
    ['160000', ['a.txt: is a submodule, which this check does not read']],
    ['100664', ['a.txt: is not a regular file (git mode 100664)']],
    ['040000', ['a.txt: is not a regular file (git mode 040000)']],
  ])('checks the mode %s', (mode, expected) => {
    const files = readPublishedFiles(['a.txt'], new Set(), read({ 'a.txt': bytes('a') }), [
      entry(mode, 'a.txt'),
    ]);

    expect(report(files.problems)).toEqual(expected);
  });

  it('finds nothing in a repository of regular files', () => {
    const disk = { 'a.txt': bytes('a'), 'run.sh': bytes('#!/bin/sh') };
    const index = [entry('100644', 'a.txt'), entry('100755', 'run.sh')];
    const files = readPublishedFiles(['run.sh', 'a.txt'], new Set(), read(disk), index);

    expect([...files.paths]).toEqual(['a.txt', 'run.sh']);
    expect(files.problems).toEqual([]);
  });

  it('reports a tracked link checked out as a plain file, and keeps its target as text', () => {
    // What a clone without symbolic links holds: a file with the target as its text.
    const disk = { 'packages/evil': bytes(TARGET) };
    const index = [entry('120000', 'packages/evil')];
    const files = readPublishedFiles(['packages/evil'], new Set(), read(disk), index);

    expect(report(files.problems)).toEqual([`packages/evil: ${LINK}`]);
    expect(files.texts.get('packages/evil')).toBe(TARGET);
  });

  it('reports a tracked link once when the disk shows the link too', () => {
    const disk = { 'packages/evil': { link: bytes(TARGET) } };
    const index = [entry('120000', 'packages/evil')];
    const files = readPublishedFiles(['packages/evil'], new Set(), read(disk), index);

    expect(report(files.problems)).toEqual([`packages/evil: ${LINK}`]);
    expect(files.texts.get('packages/evil')).toBe(TARGET);
  });

  it('reports a tracked link whose file is gone, which the index still holds', () => {
    const deleted = new Set(['packages/evil', 'gone.txt']);
    const index = [entry('120000', 'packages/evil'), entry('100644', 'gone.txt')];
    const files = readPublishedFiles(['packages/evil', 'gone.txt'], deleted, read({}), index);

    expect(files.paths.size).toBe(0);
    expect(report(files.problems)).toEqual([`packages/evil: ${LINK}`]);
  });

  it('reports a link that is not tracked, or that replaced a tracked file, by the disk', () => {
    const disk = { 'packages/new': { link: bytes(TARGET) }, 'a.txt': { link: bytes(TARGET) } };
    const index = [entry('100644', 'a.txt')];
    const files = readPublishedFiles(['packages/new', 'a.txt'], new Set(), read(disk), index);

    expect(report(files.problems)).toEqual([`a.txt: ${LINK}`, `packages/new: ${LINK}`]);
    expect(files.texts.get('packages/new')).toBe(TARGET);
  });

  it('reports a submodule once, and a nested repository that is not tracked', () => {
    const disk: Record<string, DiskEntry> = { 'vendor/sub': 'folder', 'vendor/other': 'folder' };
    const index = [entry('160000', 'vendor/sub')];
    const listed = ['vendor/sub', 'vendor/other'];
    const files = readPublishedFiles(listed, new Set(), read(disk), index);

    expect(report(files.problems)).toEqual([
      'vendor/sub: is a submodule, which this check does not read',
      'vendor/other: is a nested repository or a submodule, which this check does not read',
    ]);
  });

  it.each([1, 2, 3])('reports a link held only by stage %i of a merge conflict', (stage) => {
    const index = [1, 2, 3].map((each) =>
      entry(each === stage ? '120000' : '100644', 'packages/evil', each),
    );
    const disk = { 'packages/evil': bytes('<<<<<<< ours') };
    const files = readPublishedFiles(['packages/evil'], new Set(), read(disk), index);

    expect(report(files.problems)).toEqual([`packages/evil: ${LINK}`]);
  });

  it('reports a path in a merge conflict once, though git lists it once per version', () => {
    const index = [1, 2, 3].map((stage) => entry('100644', 'packages/evil', stage));
    const listed = ['packages/evil', 'packages/evil', 'packages/evil'];
    const disk = { 'packages/evil': { link: bytes(TARGET) } };
    const files = readPublishedFiles(listed, new Set(), read(disk), index);

    expect([...files.paths]).toEqual(['packages/evil']);
    expect(report(files.problems)).toEqual([`packages/evil: ${LINK}`]);
  });

  it('reports a tracked link once when its file is missing but not deleted', () => {
    // A sparse checkout leaves the file out, and git does not list it as deleted.
    const files = readPublishedFiles(['packages/evil'], new Set(), read({}), [
      entry('120000', 'packages/evil'),
    ]);

    expect(report(files.problems)).toEqual([`packages/evil: ${LINK}`]);
  });
});
