import { describe, expect, it } from 'vitest';
import {
  MUST_BE_IGNORED,
  REQUIRED_FILES,
  checkBilingualParity,
  checkClaudeFile,
  checkEnglishCode,
  checkIgnoredFolders,
  checkRelativeLinks,
  checkRequiredFiles,
  checkSpanishStyle,
  decodeText,
  formatProblem,
  parsePathList,
  readPublishedFiles,
  runChecks,
  type Problem,
  type PublishedFiles,
} from './repo-checks.ts';

// The checks for personal data and secrets have their own file of tests:
// repo-checks.personal-data.test.ts.

// The data that the checks look for is put together from parts, here and in every test, so
// that this file does not contain it and passes the checks itself.
const ADDRESS = ['jane.doe', ['corp-unit', 'dev'].join('.')].join('@');
const EM_DASH = String.fromCharCode(0x2014);
const MIDDLE_DOT = String.fromCharCode(0xb7);
const N_WITH_TILDE = String.fromCharCode(0xf1);
const OPENING_QUESTION_MARK = String.fromCharCode(0xbf);

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Builds the published files from a map of path to text. */
const published = (entries: Record<string, string>): PublishedFiles => ({
  paths: new Set(Object.keys(entries)),
  texts: new Map(Object.entries(entries)),
  problems: [],
});
const oneFile = (text: string, path = 'notes.txt') => published({ [path]: text }).texts;
/** The problems as the lines that the command prints, which are shorter to compare. */
const report = (problems: readonly Problem[]): string[] => problems.map(formatProblem);

describe('formatProblem', () => {
  it('writes the line only when the problem has one', () => {
    expect(formatProblem({ file: 'a.md', line: 3, message: 'broken' })).toBe('a.md:3: broken');
    expect(formatProblem({ file: 'a.md', message: 'missing' })).toBe('a.md: missing');
  });
});

describe('parsePathList', () => {
  it('splits the paths that git ends with a null byte', () => {
    expect(parsePathList('a.txt\0docs/b c.md\0')).toEqual(['a.txt', 'docs/b c.md']);
    expect(parsePathList('')).toEqual([]);
  });
});

describe('decodeText', () => {
  it('returns the text of a text file', () => {
    expect(decodeText(bytes('# Title\n'))).toBe('# Title\n');
  });

  it('drops the byte order mark of UTF-8', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi');
  });

  it('reads UTF-16 with a byte order mark, in either byte order', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe('hi');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]))).toBe('hi');
  });

  it('returns nothing for bytes with a null byte near the start', () => {
    expect(decodeText(new Uint8Array([0x68, 0x00, 0x69]))).toBeUndefined();
  });
});

describe('readPublishedFiles', () => {
  const disk: Record<string, Uint8Array | 'folder'> = {
    'b.txt': bytes('b'),
    'a.PNG': new Uint8Array([0x89, 0x50, 0x00]),
    'notes.txt': new Uint8Array([0xff, 0xfe, 0x68, 0x00]),
    'data.bin': new Uint8Array([0x01, 0x00, 0x02]),
    'vendor/sub': 'folder',
  };
  const read = (path: string) => disk[path];

  it('keeps the text of text files and only the path of known binary files', () => {
    const files = readPublishedFiles(['notes.txt', 'b.txt', 'a.PNG'], new Set(), read);

    expect([...files.paths]).toEqual(['a.PNG', 'b.txt', 'notes.txt']);
    expect([...files.texts]).toEqual([
      ['b.txt', 'b'],
      ['notes.txt', 'h'],
    ]);
    expect(files.problems).toEqual([]);
  });

  it('leaves out a tracked file that was deleted from the working tree', () => {
    const files = readPublishedFiles(['b.txt', 'gone.txt'], new Set(['gone.txt']), read);

    expect([...files.paths]).toEqual(['b.txt']);
    expect(files.problems).toEqual([]);
  });

  it('reports a file that it cannot check, and never skips it', () => {
    const listed = ['b.txt', 'vendor/sub', 'locked.txt', 'data.bin'];
    const files = readPublishedFiles(listed, new Set(), read);

    expect([...files.paths]).toEqual(['b.txt', 'data.bin', 'locked.txt', 'vendor/sub']);
    expect(report(files.problems)).toEqual([
      'data.bin: binary file with an unknown extension',
      'locked.txt: listed by git but not readable',
      'vendor/sub: is a nested repository or a submodule, which this check does not read',
    ]);
  });
});

describe('checkBilingualParity', () => {
  const english = [
    '# Title',
    "[Spanish](README.es.md 'Leer en castellano')",
    '## Install',
    '```sh',
    '# a comment in a code block, not a heading',
    '```',
    '<h3 align="center">Usage</h3>',
  ].join('\n');
  const spanish = [
    '# Titulo',
    '[English](./README.md)',
    '## Instalar',
    '### Uso',
    '~~~',
    '```',
    '## still inside the block that the tildes opened',
    '~~~',
  ].join('\n');
  const pair = (spanishText: string, englishText = english) =>
    published({ 'README.md': englishText, 'README.es.md': spanishText });

  it('accepts a pair with the same heading levels and links both ways', () => {
    expect(checkBilingualParity(pair(spanish))).toEqual([]);
  });

  it('accepts a pair in a folder, with a link written from the root', () => {
    const files = published({
      'docs/guide.md': '# Guide\n[es](guide.es.md)\n',
      'docs/guide.es.md': '# Guia\n\n[English][en]\n\n[en]: /docs/guide.md\n',
    });

    expect(checkBilingualParity(files)).toEqual([]);
  });

  it('reports a Spanish document without its English original', () => {
    const files = published({ 'docs/guide.es.md': '# Guia\n' });

    expect(checkBilingualParity(files)).toEqual([
      { file: 'docs/guide.es.md', message: 'has no English counterpart (docs/guide.md)' },
    ]);
  });

  it('reports the first heading with a different level', () => {
    const files = pair(spanish.replace('### Uso', '## Uso\n#### Extra'));

    expect(report(checkBilingualParity(files))).toEqual([
      'README.es.md:4: heading 3 does not match README.md (level 2 here, level 3 there)',
    ]);
  });

  it('reports a heading that only one of the two has', () => {
    const shorter = pair(spanish.replace('### Uso', 'Uso'));
    const longer = pair(`${spanish}\n## Licencia`);

    expect(report(checkBilingualParity(shorter))).toEqual([
      'README.es.md: heading 3 does not match README.md (no heading here, level 3 there)',
    ]);
    expect(report(checkBilingualParity(longer))).toEqual([
      'README.es.md:9: heading 4 does not match README.md (level 2 here, no heading there)',
    ]);
  });

  it('counts a heading in any form that GitHub shows as one', () => {
    const same = pair(`${spanish}\n\nLicencia\n---\n`, `${english}\n\n> ## License\n`);
    const missing = pair(spanish, `${english}\n\n- ## License\n`);

    expect(checkBilingualParity(same)).toEqual([]);
    expect(report(checkBilingualParity(missing))).toEqual([
      'README.es.md: heading 4 does not match README.md (no heading here, level 2 there)',
    ]);
  });

  it('reports each document that does not link to the other', () => {
    const files = published({
      // The name of the other file in plain text or in a code span is not a link.
      'README.md': '# Title\nSee `[Spanish](README.es.md)` or README.es.md\n',
      'README.es.md': '# Titulo\n[English](docs/README.md)\n',
    });

    expect(report(checkBilingualParity(files))).toEqual([
      'README.md: does not link to README.es.md',
      'README.es.md: does not link to README.md',
    ]);
  });
});

describe('checkRelativeLinks', () => {
  const files = (markdown: string, path = 'docs/guide.md') =>
    published({ [path]: markdown, 'README.md': '', 'docs/img/a b.png': '', 'src/index.ts': '' });
  const broken = (target: string, line = 1) =>
    `docs/guide.md:${String(line)}: links to ${target}, which is not a published file`;

  it.each([
    ['a file in the same folder', '[self](guide.md)'],
    ['a file in a parent folder', '[readme](../README.md#usage)'],
    ['a path from the root', '[code](/src/index.ts)'],
    ['a published folder', '[sources](../src/) and [docs](.) and [root](..)'],
    ['an encoded path with a title', "![shot](img/a%20b.png 'A title')"],
    ['a path with spaces in angle brackets', '![shot](<img/a b.png>)'],
    ['a reference definition', '[readme]: ../README.md'],
    ['an HTML link and image', '<a href="../README.md"><img src=\'img/a%20b.png\'></a>'],
    ['external links', '[a](https://host.test/x.md) [b](mailto:x) [c](//host.test/y) [d](#top)'],
    ['a link with only a query, and an empty one', '[same page](?tab=readme) [todo]()'],
    ['a link in a code span', 'Write `[text](missing.md)` to link.'],
    ['a link in a code block', '```md\n[text](missing.md)\n```'],
    ['a link in a comment', '<!-- [text](missing.md) -->'],
  ])('accepts %s', (_case, markdown) => {
    expect(checkRelativeLinks(files(markdown))).toEqual([]);
  });

  it.each([
    ['a file that is not published', '[gone](missing.md)', 'missing.md'],
    ['a missing file with a title, as Prettier writes it', "[gone](missing.md 'T')", 'missing.md'],
    ['a file in the wrong folder', '[readme](README.md)', 'README.md'],
    ['a path that leaves the repository', '[out](../../other/a.md)', '../../other/a.md'],
    ['a broken image inside a link', '[![shot](img/none.png)](../README.md)', 'img/none.png'],
    ['a broken target around an image', '[![shot](img/a%20b.png)](none.md)', 'none.md'],
    ['a file written as a folder', '[self](guide.md/)', 'guide.md/'],
    ['a broken reference', '[text][ref]\n\n[ref]: <none.md>', 'none.md'],
    ['a broken HTML image', "<img src='img/none.png'>", 'img/none.png'],
    ['a stray percent sign', '[bad](100%.md)', '100%25.md'],
    ['a stray percent sign in HTML', '<img src="100%.png">', '100%.png'],
    ['a path with a backslash', '[back](img\\a%20b.png)', 'img%5Ca%20b.png'],
    ['a name that is only the start of a folder', '[partial](../sr)', '../sr'],
  ])('reports %s', (_case, markdown, target) => {
    expect(report(checkRelativeLinks(files(markdown)))).toEqual([broken(target)]);
  });

  it('reports an HTML link that the Markdown reader cannot read, with its line', () => {
    const markdown = '# Guide\n\n<div>\n<a href=>one</a>\n</div>\n\n[b](two.md)\n';

    expect(report(checkRelativeLinks(files(markdown)))).toEqual([
      'docs/guide.md:4: link this check cannot read',
      broken('two.md', 7),
    ]);
  });

  it('reports a path on a local drive, which is not a URL with a scheme', () => {
    expect(report(checkRelativeLinks(files('[x](C:/work/docs/guide.md)')))).toEqual([
      'docs/guide.md:1: links to C:/work/docs/guide.md, which is a path on a local drive',
    ]);
  });

  it('only reads Markdown files', () => {
    expect(checkRelativeLinks(files('[gone](missing.md)', 'docs/guide.txt'))).toEqual([]);
  });
});

describe('checkSpanishStyle', () => {
  it('reports the em dash and the middle dot in Spanish documents', () => {
    const text = `Uno ${EM_DASH} dos\nbien\nA ${MIDDLE_DOT} B ${EM_DASH} C\n`;

    expect(report(checkSpanishStyle(oneFile(text, 'README.es.md')))).toEqual([
      'README.es.md:1: em dash (use a comma, a colon or parentheses)',
      'README.es.md:3: em dash (use a comma, a colon or parentheses)',
      'README.es.md:3: middle dot as a separator (use a spaced hyphen)',
    ]);
  });

  it('leaves the other documents alone', () => {
    const texts = published({
      'README.md': `One ${EM_DASH} two ${MIDDLE_DOT} three`,
      'README.es.md': 'Uno, dos - tres',
    }).texts;

    expect(checkSpanishStyle(texts)).toEqual([]);
  });
});

describe('checkEnglishCode', () => {
  const spanishLine = `// a${N_WITH_TILDE}o`;

  it.each(['src/a.ts', 'src/b.mts', 'c.CTS', 'app/page.html', 'app/style.scss', 'ci.yml'])(
    'reports Spanish characters in %s',
    (path) => {
      const texts = oneFile(`const a = 1;\n${spanishLine}\n`, path);

      expect(report(checkEnglishCode(texts))).toEqual([
        `${path}:2: code and configuration must be in English`,
      ]);
    },
  );

  it('reports an opening question mark', () => {
    expect(checkEnglishCode(oneFile(`# ${OPENING_QUESTION_MARK}why?`, 'run.sh'))).toHaveLength(1);
  });

  it('accepts documents, the lockfile and other non-ASCII characters', () => {
    const texts = published({
      'README.es.md': spanishLine,
      'package-lock.json': spanishLine,
      'packages/server/package-lock.json': spanishLine,
      'src/a.ts': `const arrow = '${String.fromCharCode(0x2192)}';`,
    }).texts;

    expect(checkEnglishCode(texts)).toEqual([]);
  });
});

describe('checkClaudeFile', () => {
  it('accepts a repository without CLAUDE.md', () => {
    expect(checkClaudeFile(published({ 'AGENTS.md': '# Agents' }))).toEqual([]);
  });

  it('accepts a CLAUDE.md that only imports AGENTS.md', () => {
    const files = published({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': '# Agents' });

    expect(checkClaudeFile(files)).toEqual([]);
  });

  it('reports a CLAUDE.md with anything else', () => {
    const files = published({ 'CLAUDE.md': '@AGENTS.md\n\nAlso, be nice.\n', 'AGENTS.md': '' });

    expect(report(checkClaudeFile(files))).toEqual([
      'CLAUDE.md: must only contain @AGENTS.md (instructions live in AGENTS.md)',
    ]);
  });

  it('reports an import of an AGENTS.md that is not published', () => {
    expect(report(checkClaudeFile(published({ 'CLAUDE.md': '@AGENTS.md' })))).toEqual([
      'CLAUDE.md: imports AGENTS.md, which is not a published file',
    ]);
  });
});

describe('checkRequiredFiles', () => {
  it('requires the files that every state of the repository must have', () => {
    expect(REQUIRED_FILES).toEqual([
      'AGENTS.md',
      'CHANGELOG.md',
      'CLAUDE.md',
      'CONTRIBUTING.md',
      'LICENSE',
      'LICENSE-CC-BY-4.0',
      'README.es.md',
      'README.md',
      'SECURITY.md',
      'package.json',
    ]);
    expect(checkRequiredFiles(new Set([...REQUIRED_FILES, 'docs/guide.md']))).toEqual([]);
    expect(report(checkRequiredFiles(new Set(['docs/LICENSE'])))).toEqual(
      REQUIRED_FILES.map((file) => `${file}: missing`),
    );
  });

  it('takes another list', () => {
    expect(report(checkRequiredFiles(new Set(['a']), ['a', 'b']))).toEqual(['b: missing']);
  });
});

describe('checkIgnoredFolders', () => {
  it('accepts a repository that ignores the three folders', () => {
    expect(MUST_BE_IGNORED).toEqual(['node_modules', 'coverage', 'dist']);
    expect(checkIgnoredFolders(new Set(['src/dist.ts', 'coverage']), () => true)).toEqual([]);
  });

  it('reports a folder that git does not ignore', () => {
    const problems = checkIgnoredFolders(new Set(), (folder) => folder !== 'dist');

    expect(report(problems)).toEqual(['.gitignore: dist/ must be ignored']);
  });

  it('reports a published file inside one of the folders, at any depth', () => {
    const paths = new Set(['dist/index.js', 'packages/server/node_modules/x/index.js', 'a.ts']);

    expect(report(checkIgnoredFolders(paths, () => true))).toEqual([
      'dist/index.js: is inside dist/, which must not be published',
      'packages/server/node_modules/x/index.js: is inside node_modules/, which must not be published',
    ]);
  });
});

describe('runChecks', () => {
  it('finds nothing in a sound repository', () => {
    const files = published({
      ...Object.fromEntries(REQUIRED_FILES.map((file) => [file, 'Text.\n'])),
      'CLAUDE.md': '@AGENTS.md\n',
      'package.json': '{}',
      'README.md': '# Title\n\n[Spanish](README.es.md)\n',
      'README.es.md': '# Titulo\n\n[English](README.md)\n',
    });

    expect(runChecks(files, { isIgnored: () => true })).toEqual([]);
  });

  it('runs every check and sorts the problems by file and line', () => {
    const files: PublishedFiles = {
      ...published({
        'README.md': `# Title\n[gone](missing.md)\n${ADDRESS}\n`,
        'README.es.md': `# Titulo ${EM_DASH} uno\n`,
        'CLAUDE.md': 'Instructions',
        'src/a.ts': `// ${N_WITH_TILDE}\nconst key = '${'sk-'}${'d4'.repeat(12)}'; // zelda\n`,
      }),
      problems: [{ file: 'data.bin', message: 'binary file with an unknown extension' }],
    };

    expect(report(runChecks(files, { userName: 'zelda', isIgnored: () => false }))).toEqual([
      '.gitignore: coverage/ must be ignored',
      '.gitignore: dist/ must be ignored',
      '.gitignore: node_modules/ must be ignored',
      'AGENTS.md: missing',
      'CHANGELOG.md: missing',
      'CLAUDE.md: must only contain @AGENTS.md (instructions live in AGENTS.md)',
      'CONTRIBUTING.md: missing',
      'LICENSE: missing',
      'LICENSE-CC-BY-4.0: missing',
      'README.es.md: does not link to README.md',
      'README.es.md:1: em dash (use a comma, a colon or parentheses)',
      'README.md: does not link to README.es.md',
      'README.md:2: links to missing.md, which is not a published file',
      'README.md:3: contains an email address',
      'SECURITY.md: missing',
      'data.bin: binary file with an unknown extension',
      'package.json: missing',
      'src/a.ts:1: code and configuration must be in English',
      'src/a.ts:2: contains the local user name',
      'src/a.ts:2: looks like an API key',
    ]);
  });
});
