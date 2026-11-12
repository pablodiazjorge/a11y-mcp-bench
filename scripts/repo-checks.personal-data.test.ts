import { describe, expect, it } from 'vitest';
import {
  checkPersonalData,
  checkSecrets,
  formatProblem,
  type Problem,
  type PublishedFiles,
} from './repo-checks.ts';

// The data that the checks look for is put together from parts, here and in every test, so
// that this file does not contain it and passes the checks itself.
const WINDOWS_HOME = ['C:', 'Users', 'someone'].join('\\');
const MAC_HOME = ['', 'Users', 'someone'].join('/');
const LINUX_HOME = ['', 'home', 'someone'].join('/');
// A domain that is not reserved for examples, for the addresses that must be reported.
const DOMAIN = ['corp-unit', 'dev'].join('.');
const ADDRESS = ['jane.doe', DOMAIN].join('@');
const address = (local: string, domain: string): string => [local, domain].join('@');

const published = (entries: Record<string, string>): PublishedFiles => ({
  paths: new Set(Object.keys(entries)),
  texts: new Map(Object.entries(entries)),
  problems: [],
});
const oneFile = (text: string, path = 'notes.txt') => published({ [path]: text });
/** The problems as the lines that the command prints, which are shorter to compare. */
const report = (problems: readonly Problem[]): string[] => problems.map(formatProblem);

describe('checkPersonalData: local paths', () => {
  it('fails on a file with a personal path', () => {
    const files = oneFile(`first line\nopen ${[WINDOWS_HOME, 'repo'].join('\\')} to start\n`);

    expect(checkPersonalData(files)).toEqual([
      { file: 'notes.txt', line: 2, message: 'contains a local user path' },
    ]);
  });

  it.each([
    ['a Windows path', WINDOWS_HOME],
    ['a Windows path with forward slashes', WINDOWS_HOME.replaceAll('\\', '/')],
    ['a Windows path in a JSON string', WINDOWS_HOME.replaceAll('\\', '\\\\')],
    ['a Windows path in lower case', WINDOWS_HOME.toLowerCase()],
    ['a macOS path', MAC_HOME],
    ['a quoted macOS path', `cd "${MAC_HOME}/repo"`],
    ['a macOS path after a colon', `cwd:${MAC_HOME}`],
    ['a macOS path in braces', `{${MAC_HOME}}`],
    ['a macOS path in a file URL', `file://${MAC_HOME}/repo`],
    ['a Git Bash path', `/c${MAC_HOME}`],
    ['a WSL path', `ls /mnt/c${MAC_HOME}`],
    ['a Cygwin path', `/cygdrive/d${MAC_HOME}`],
  ])('reports %s', (_case, line) => {
    expect(report(checkPersonalData(oneFile(line)))).toEqual([
      'notes.txt:1: contains a local user path',
    ]);
  });

  it.each([
    ['a home path', LINUX_HOME],
    ['a home path in a command', `cd ${LINUX_HOME}/repo`],
    ['a home path in an assignment', `HOME=${LINUX_HOME}`],
    ['a home path in a list of folders', `PATH=/usr/bin:${LINUX_HOME}/bin`],
    ['a home path in an option', `--prefix=${LINUX_HOME}/.local`],
    ['a home path in an array', `[/tmp,${LINUX_HOME}/a]`],
    ['a home path after a semicolon', `a;${LINUX_HOME}/b`],
    ['a home path in parentheses', `(${LINUX_HOME})`],
    ['a home path in a code span', `\`${LINUX_HOME}\``],
    ['a home path in a file URL', `file://${LINUX_HOME}/repo`],
  ])('reports %s', (_case, line) => {
    expect(report(checkPersonalData(oneFile(line)))).toEqual(['notes.txt:1: contains a home path']);
  });

  it.each([
    ['a Windows placeholder', ['C:', 'Users', '<name>', 'repo'].join('\\')],
    ['the Windows public folder', ['C:', 'Users', 'Public', 'Documents'].join('\\')],
    ['the Windows default profile', ['C:', 'Users', 'Default'].join('\\')],
    ['a Users folder that is not at the root of the drive', 'D:\\data\\Users\\list'],
    ['a macOS placeholder', '/Users/<name>/repo'],
    ['the macOS shared folder', ['', 'Users', 'Shared', 'data'].join('/')],
    ['the public folder through WSL', ['', 'mnt', 'c', 'Users', 'Public', 'x'].join('/')],
    ['a Linux placeholder', '/home/<name>'],
    ['a placeholder in a file URL', 'file:///home/<name>/repo'],
    ['the home of the CI account', ['', 'home', 'runner', 'work'].join('/')],
    ['a variable for the home folder', '--prefix=$HOME/.local and ~/home/x'],
    ['a page of a site', 'https://host.test/home/page'],
    ['a page of a site with a port', 'http://localhost:4200/home/details'],
    ['a page of a site with an IPv6 address', 'http://[::1]/home/x'],
    ['a page of a site without the scheme', 'see host.test/Users/list'],
    ['a link to a page of a site', '<a href="https://host.test:8080/home/x">x</a>'],
    ['a path inside an HTML tag', '<code>/home/x</code>'],
    ['a path after a variable', '${base}/home/x and $ROOT/Users/x'],
    ['a folder called Users in a path', 'src/Users/list.ts'],
    ['a folder called home in a path', 'src/app/home/home.component.ts'],
    ['a relative import', "import { Home } from './home/home.component';"],
    ['an import from a parent folder', "import { Home } from '../home/home.ts';"],
    ['an import through an alias', "import { Home } from '@app/home/home';"],
    ['a route without a leading slash', "{ path: 'home/details', component: Home }"],
    ['a route with one segment', 'routerLink="/home" and navigate([\'/home\', id])'],
    ['a route with one segment and a query', "navigateByUrl('/home?tab=1')"],
    ['a folder with a longer name', 'key=/homes/x and /UsersGuide/x'],
    ['a file called home', 'url(/home.png)'],
    ['a folder of a workspace', 'packages/home/src/index.ts'],
    ['a document in a folder called home', '[docs](docs/home/index.md)'],
  ])('accepts %s', (_case, line) => {
    expect(checkPersonalData(oneFile(line))).toEqual([]);
  });

  it('reports each kind once per line and every line that has one', () => {
    const files = oneFile(`${ADDRESS} ${ADDRESS} ${LINUX_HOME}\n\n${MAC_HOME}`);

    expect(report(checkPersonalData(files))).toEqual([
      'notes.txt:1: contains a home path',
      'notes.txt:1: contains an email address',
      'notes.txt:3: contains a local user path',
    ]);
  });
});

describe('checkPersonalData: email addresses', () => {
  it.each([
    ['an address', `Contact: ${ADDRESS}.`],
    ['an address after an allowed one', `git@github.com and ${ADDRESS}`],
    ['a domain that starts like a reserved one', address('jane', 'example.community')],
    ['a reserved domain in the middle', address('jane', `example.com.${DOMAIN}`)],
    ['a top-level domain that ends like a reserved one', address('jane', 'host.mytest')],
    ['a local part that only contains noreply', address('jane.noreply', DOMAIN)],
    ['a domain that only contains noreply', address('jane', `noreply-${DOMAIN}`)],
    ['another host of the GitHub noreply domain', address('jane', 'noreply.github.com')],
    // `.md` is the top-level domain of a country, so it does not count as a file extension.
    ['a domain that ends like a Markdown file', address('jane', 'firma.md')],
    ['an address after a dot, a hyphen or a plus sign', `.${ADDRESS} -${ADDRESS} +${ADDRESS}`],
  ])('reports %s', (_case, line) => {
    expect(report(checkPersonalData(oneFile(line)))).toEqual([
      'notes.txt:1: contains an email address',
    ]);
  });

  it.each([
    ['the reserved example domains', 'jane@example.com, jane@mail.example.net, j@example.org'],
    ['the reserved top-level domains', 'a@host.test b@corp.example c@x.invalid d@box.localhost'],
    ['a noreply mailbox', `${address('noreply', DOMAIN)} ${address('No-Reply', DOMAIN)}`],
    ['a GitHub noreply address', '12345+someone@users.noreply.github.com'],
    ['a git URL over SSH', 'git+ssh://git@github.com/owner/repo.git'],
    ['a package with its version', 'typescript@6.0.3 and actions/checkout@v7.0.1'],
    ['a file name with a scale', 'logo@2x.png, icon@3x.SVG and styles@next.css'],
    ['an import of a Markdown file', "CLAUDE.md contains '@AGENTS.md' and @docs/setup.md"],
    [
      'an allowed address after punctuation',
      `--from=-${address('noreply', DOMAIN)} .git@github.com`,
    ],
  ])('accepts %s', (_case, line) => {
    expect(checkPersonalData(oneFile(line))).toEqual([]);
  });

  // An earlier pattern started again from every word of a run like these. On these two lines
  // of 200,000 characters it needed 15 and 22 seconds, and the pattern now needs about a
  // millisecond, so the limit is far from both and does not depend on the machine.
  it.each([
    ['dotted words without an at sign', 'a.'.repeat(100_000)],
    ['dotted words around an at sign', `${'a.'.repeat(50_000)}@${'1.'.repeat(50_000)}`],
  ])('reads a long line of %s in a time that grows with its length', (_case, line) => {
    const start = performance.now();
    const problems = checkPersonalData(oneFile(line));

    expect(problems).toEqual([]);
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it('does not look for addresses in the lockfile, but still looks for paths', () => {
    const files = published({
      'package-lock.json': `"deprecated": "write to ${ADDRESS}"\n`,
      'packages/server/package-lock.json': `"deprecated": "${ADDRESS}",\n"cwd": "${LINUX_HOME}"\n`,
    });

    expect(report(checkPersonalData(files))).toEqual([
      'packages/server/package-lock.json:2: contains a home path',
    ]);
  });
});

describe('checkPersonalData: the local user name and file names', () => {
  it('reports the local user name as a whole word, in any case', () => {
    const files = oneFile('built by Zelda\nzeldas are not zelda1\nowner: "zelda"\n');

    expect(report(checkPersonalData(files, 'zelda'))).toEqual([
      'notes.txt:1: contains the local user name',
      'notes.txt:3: contains the local user name',
    ]);
  });

  it('reads the local user name as plain text, not as a pattern', () => {
    expect(checkPersonalData(oneFile('a.b and axb'), 'a.b')).toHaveLength(1);
    expect(checkPersonalData(oneFile('axb'), 'a.b')).toEqual([]);
    expect(checkPersonalData(oneFile('run as $me$ today'), '$me$')).toHaveLength(1);
  });

  it('does not look for a user name that is missing or shorter than three characters', () => {
    expect(checkPersonalData(oneFile('to be or not to be'), 'be')).toEqual([]);
    expect(checkPersonalData(oneFile('to be or not to be'))).toEqual([]);
  });

  it('checks the names of the files too, whatever they hold', () => {
    const files: PublishedFiles = {
      paths: new Set(['docs/notes-zelda.md', `mail/${ADDRESS}.txt`, 'img/logo@2x.png', 'a.md']),
      texts: new Map([['docs/notes-zelda.md', 'clean']]),
      problems: [],
    };

    expect(report(checkPersonalData(files, 'zelda'))).toEqual([
      'docs/notes-zelda.md: file name contains the local user name',
      `mail/${ADDRESS}.txt: file name contains an email address`,
    ]);
  });
});

describe('checkSecrets', () => {
  it.each([
    ['a GitHub token', `token: ${'ghp_'}${'a1'.repeat(18)}`],
    ['a GitHub token', `${'github_pat_'}${'A1_b2'.repeat(5)}`],
    ['an npm token', `//registry.npmjs.org/:_authToken=${'npm_'}${'a1'.repeat(18)}`],
    ['an Anthropic key', `${['sk', 'ant', 'api03'].join('-')}-${'b2'.repeat(12)}`],
    ['an API key', `${'sk-'}${'c3'.repeat(12)}`],
    ['an AWS key', `id=${'AKIA'}${'ABCD1234'.repeat(2)}`],
    ['a Slack token', ['xoxb', '123456789012'].join('-')],
    ['a private key', ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')],
    ['a private key', ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')],
    ['a private key', ['-----BEGIN', 'PGP', 'PRIVATE', 'KEY', 'BLOCK-----'].join(' ')],
  ])('reports %s', (kind, line) => {
    const { texts } = oneFile(`safe\n${line}\n`, '.env.example');

    expect(report(checkSecrets(texts))).toEqual([`.env.example:2: looks like ${kind}`]);
  });

  it('accepts placeholders and text that only looks similar', () => {
    const text = [
      'GITHUB_TOKEN=<your token>',
      'ANTHROPIC_API_KEY=sk-ant-...',
      'the task-runner and the sk-short key',
      'npm_config_registry and npm_package_version',
      `${'npm_'}${'a1'.repeat(19)}`,
      ['-----BEGIN', 'PUBLIC', 'KEY-----'].join(' '),
      ['-----BEGIN', 'PGP', 'PUBLIC', 'KEY', 'BLOCK-----'].join(' '),
      `${'AKIA'}${'ABCD1234'.repeat(2)}EXTRA`,
    ].join('\n');

    expect(checkSecrets(oneFile(text).texts)).toEqual([]);
  });
});
