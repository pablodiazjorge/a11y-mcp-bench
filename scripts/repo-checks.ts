// The repository checks: rules that every file git would publish has to follow. No personal
// data, nothing shaped like a secret, bilingual documents that stay in step, links that lead
// somewhere, and code written in English.
// Adapted from scripts/check.mjs in rea-lab (https://github.com/pablodiazjorge/rea-lab), MIT.
//
// Every function here is pure: it gets the published files as values and returns the problems
// it finds. Reading the disk and asking git is the job of check-repo.ts.

import { posix } from 'node:path';
import { readMarkdown } from './markdown.ts';

export interface Problem {
  file: string;
  /** Line number, starting at 1. Left out when the problem is about the whole file. */
  line?: number;
  message: string;
}

export interface PublishedFiles {
  /** Every path that git would publish, relative to the root and written with `/`. */
  paths: ReadonlySet<string>;
  /** The text of each published file. A binary file has a path but no text. */
  texts: ReadonlyMap<string, string>;
  /** Files whose content could not be checked, found while the files were read. */
  problems: readonly Problem[];
}

export interface CheckOptions {
  /** Name of the local user account. Left out on CI, where the account has a generic name. */
  userName?: string | undefined;
  /** Tells whether git ignores what is inside a folder at the root of the repository. */
  isIgnored: (folder: string) => boolean;
}

/** Files that the repository must publish. Later work adds to this list as the files appear. */
export const REQUIRED_FILES: readonly string[] = [
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
];

/** Folders of dependencies and of generated output, which must never be published. */
export const MUST_BE_IGNORED: readonly string[] = ['node_modules', 'coverage', 'dist'];

// The only files that may hold bytes that are not text. Their content is not checked.
const BINARY_EXTENSIONS = new Set([
  ...['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.woff', '.woff2'],
  ...['.zip', '.exe', '.dll', '.so', '.o', '.obj', '.pdf'],
]);
const CODE_EXTENSIONS = new Set([
  ...['.mjs', '.cjs', '.js', '.ts', '.mts', '.cts', '.tsx', '.html', '.css', '.scss'],
  ...['.ps1', '.psm1', '.json', '.yml', '.yaml', '.toml', '.sh'],
]);
// A shorter name is too likely to be part of an ordinary word.
const MIN_USER_NAME_LENGTH = 3;

// Characters outside ASCII are built from code points, so that this file passes its own checks.
const EM_DASH = String.fromCharCode(0x2014);
const MIDDLE_DOT = String.fromCharCode(0xb7);
// Accented vowels, u with diaeresis and n with tilde, in lower and upper case, and the two
// opening marks.
const SPANISH_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0xe1, 0xe9, 0xed, 0xf3, 0xfa, 0xfc, 0xf1, 0xc1, 0xc9, 0xcd, 0xd3, 0xda, 0xdc, 0xd1, 0xbf, 0xa1)}]`,
);

const extension = (path: string): string => posix.extname(path).toLowerCase();
const isLockfile = (path: string): boolean => posix.basename(path) === 'package-lock.json';

function problem(file: string, message: string, line?: number): Problem {
  return line === undefined ? { file, message } : { file, line, message };
}

/** Runs `visit` on every line of every text file whose path passes `select`. */
function scanLines(
  texts: ReadonlyMap<string, string>,
  select: (path: string) => boolean,
  visit: (line: string, file: string) => string[],
): Problem[] {
  const problems: Problem[] = [];
  for (const [file, text] of texts) {
    if (!select(file)) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      for (const message of visit(line, file)) problems.push(problem(file, message, index + 1));
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Reading the published files

/** Splits the output of a git command that ends each path with a null byte (`-z`). */
export function parsePathList(output: string): string[] {
  return output.split('\0').filter((path) => path !== '');
}

/**
 * Returns the text that some bytes hold, or undefined when they are not text. UTF-16 has a
 * null byte in most characters, so it is told apart by its byte order mark; without one, a
 * null byte near the start means binary data, which is how git itself decides.
 */
export function decodeText(bytes: Uint8Array): string | undefined {
  // TextDecoder drops the byte order mark, which is not part of the text.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes.subarray(0, 8000).includes(0)) return undefined;
  return new TextDecoder().decode(bytes);
}

/**
 * Builds the published files from the paths that git lists. `deleted` holds the tracked
 * files that are gone from the working tree, which are left out: deleting them is the
 * change. `read` returns the bytes of a file, 'folder' for a path that is a folder and
 * undefined for a path that it cannot read.
 *
 * A file that cannot be checked is a problem, not a file to skip: a folder, which git lists
 * as one path when it is another repository; an unreadable path; or bytes that are not text
 * under an extension that is not a known binary format.
 */
export function readPublishedFiles(
  listed: readonly string[],
  deleted: ReadonlySet<string>,
  read: (path: string) => Uint8Array | 'folder' | undefined,
): PublishedFiles {
  const paths = new Set<string>();
  const texts = new Map<string, string>();
  const problems: Problem[] = [];
  for (const path of [...listed].sort()) {
    if (deleted.has(path)) continue;
    paths.add(path);
    const bytes = read(path);
    if (bytes === 'folder') {
      const message = 'is a nested repository or a submodule, which this check does not read';
      problems.push(problem(path, message));
      continue;
    }
    if (bytes === undefined) {
      problems.push(problem(path, 'listed by git but not readable'));
      continue;
    }
    if (BINARY_EXTENSIONS.has(extension(path))) continue;
    const text = decodeText(bytes);
    if (text === undefined) problems.push(problem(path, 'binary file with an unknown extension'));
    else texts.set(path, text);
  }
  return { paths, texts, problems };
}

// ---------------------------------------------------------------------------
// Personal data and secrets

// Each one stops at a placeholder such as `<name>` and at the accounts that every machine has.
const USER_PATHS: readonly (readonly [kind: string, pattern: RegExp])[] = [
  // Windows, with one or more slashes of either kind, as in a JSON string.
  [
    'a local user path',
    /\b[A-Za-z]:[\\/]+Users[\\/]+(?!<|Public\b|Default\b|Shared\b)[^\\/\s"'`<>]+/i,
  ],
  // The POSIX forms start a path: at the start of the line, after a character that comes
  // before a path in commands, lists and assignments, or in a `file:` URL. A folder with
  // the same name in the middle of a longer path or of a web address is not one.
  // macOS, and a Windows drive as Git Bash (`/c/`), WSL (`/mnt/c/`) and Cygwin write it.
  [
    'a local user path',
    /(?:^|(?<=[\s"'`(=:,;{[])|(?<=file:\/\/))\/(?:(?:mnt|cygdrive)\/)?(?:[a-z]\/)?Users\/(?!<|Public\b|Default\b|Shared\b)[^/\s"'`<>]+/,
  ],
  // Linux. `runner` is the account of the GitHub Actions machines.
  ['a home path', /(?:^|(?<=[\s"'`(=:,;{[])|(?<=file:\/\/))\/home\/(?!<|runner\b)[^/\s"'`<>]+/],
];
// The last label of the domain starts with a letter, so `name@6.4.0` is not an address.
// The lookbehind lets a match start only where a run of these characters starts. Without it,
// the pattern tried again from every word of a long run that has no at sign, and the time
// grew with the square of the length of the line.
const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z][\w-]*\b/g;
// The domains and the top-level domains that RFC 2606 and RFC 6761 reserve for examples.
const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|test|example|invalid|localhost)$/;
// File names such as `logo@2x.png` have the shape of an address. `md` is not in the list:
// it is also the top-level domain of a country, so it would let real addresses through.
const FILE_EXTENSIONS = new Set([
  ...['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
  ...['ts', 'js', 'mjs', 'cjs', 'json', 'html', 'css', 'scss'],
]);

function isAllowedEmail(address: string): boolean {
  // A dot, a hyphen or a plus sign before the name is punctuation of the text around it.
  const lower = address.toLowerCase().replace(/^[.+-]+/, '');
  const local = lower.slice(0, lower.lastIndexOf('@'));
  const domain = lower.slice(lower.lastIndexOf('@') + 1);
  return (
    // The start of a git URL over SSH, not a mailbox.
    lower === 'git@github.com' ||
    // Mailboxes that nobody reads, and the addresses GitHub gives to hide the real one.
    local === 'noreply' ||
    local === 'no-reply' ||
    domain === 'users.noreply.github.com' ||
    RESERVED_DOMAIN.test(domain) ||
    FILE_EXTENSIONS.has(domain.slice(domain.lastIndexOf('.') + 1))
  );
}

function userNamePattern(userName: string): RegExp {
  const escaped = userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Not `\b`, which does not work next to a name that starts or ends with a symbol.
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i');
}

/**
 * Finds local user paths, email addresses and, when it is given, the name of the local user,
 * in the text of the files and in their names. The messages name the kind of data and never
 * repeat it, because CI logs are public.
 */
export function checkPersonalData(files: PublishedFiles, userName?: string): Problem[] {
  const namePattern =
    userName !== undefined && userName.length >= MIN_USER_NAME_LENGTH
      ? userNamePattern(userName)
      : undefined;
  const kinds = (text: string, emails: boolean): string[] => {
    const found = new Set<string>();
    for (const [kind, pattern] of USER_PATHS) {
      if (pattern.test(text)) found.add(kind);
    }
    // Every address is looked at, so an allowed one cannot hide another.
    if (emails && [...text.matchAll(EMAIL)].some(([address]) => !isAllowedEmail(address))) {
      found.add('an email address');
    }
    if (namePattern?.test(text) === true) found.add('the local user name');
    return [...found];
  };
  return [
    ...[...files.paths].flatMap((path) =>
      kinds(path, true).map((kind) => problem(path, `file name contains ${kind}`)),
    ),
    ...scanLines(
      files.texts,
      () => true,
      // npm copies into the lockfile the deprecation notes of the packages, and some of
      // them give the address of a maintainer.
      (line, file) => kinds(line, !isLockfile(file)).map((kind) => `contains ${kind}`),
    ),
  ];
}

const SECRETS: readonly (readonly [kind: string, pattern: RegExp])[] = [
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['a GitHub token', /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ['an npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['an Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['an API key', /\bsk-[A-Za-z0-9]{20,}/],
  ['an AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  // Written in two parts so that this line does not look like a private key itself. PGP
  // keys end the line with the word BLOCK.
  ['a private key', new RegExp(['-----BEGIN', '[A-Z ]*PRIVATE KEY(?: BLOCK)?-----'].join(' '))],
];

/** Finds text with the shape of a token or a key of the services a project like this uses. */
export function checkSecrets(texts: ReadonlyMap<string, string>): Problem[] {
  return scanLines(
    texts,
    () => true,
    (line) =>
      SECRETS.filter(([, pattern]) => pattern.test(line)).map(([kind]) => `looks like ${kind}`),
  );
}

// ---------------------------------------------------------------------------
// Markdown: links and bilingual documents

/**
 * Returns the path, from the root of the repository, that a link in `file` points to. It
 * returns undefined for a link that is not checked: one with a scheme (`https:`, `mailto:`),
 * one to another host (`//`) or an anchor of the same page.
 */
function linkedPath(file: string, target: string): string | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return undefined;
  const written = target.split(/[?#]/)[0] ?? '';
  if (written === '') return undefined;
  let path = written;
  try {
    path = decodeURIComponent(written);
  } catch {
    // A stray `%`. The path stays as written, which no published file will match.
  }
  // GitHub reads a leading slash as the root of the repository.
  const fromRoot = path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(file), path);
  // A path that leaves the repository keeps its leading `..` and matches nothing. A slash
  // at the end stays too.
  return posix.normalize(fromRoot);
}

/**
 * Tells whether a path is a published file or a folder with published files inside. A path
 * that ends with a slash asks for a folder, so a file with that name does not answer it.
 */
function isPublished(paths: ReadonlySet<string>, path: string): boolean {
  const folder = path.endsWith('/') ? path : `${path}/`;
  // The root of the repository.
  if (folder === './') return true;
  if (paths.has(path)) return true;
  for (const published of paths) {
    if (published.startsWith(folder)) return true;
  }
  return false;
}

/**
 * Checks that every relative link of a Markdown file leads to a published file, and that the
 * file has no raw HTML link that the Markdown reader cannot read. A file that exists on disk
 * but that git ignores does not count as published: readers of the repository will not have
 * it. Neither does a path on a local drive, which GitHub shows as a link that leads nowhere.
 */
export function checkRelativeLinks(files: PublishedFiles): Problem[] {
  const problems: Problem[] = [];
  for (const [file, text] of files.texts) {
    if (extension(file) !== '.md') continue;
    const { links, unread } = readMarkdown(text);
    for (const { line, message } of unread) problems.push(problem(file, message, line));
    for (const { target, line } of links) {
      const path = linkedPath(file, target);
      if (/^[a-z]:/i.test(target)) {
        // A drive letter has the shape of a URL scheme, but no scheme has a single letter.
        problems.push(problem(file, `links to ${target}, which is a path on a local drive`, line));
      } else if (path !== undefined && !isPublished(files.paths, path)) {
        problems.push(problem(file, `links to ${target}, which is not a published file`, line));
      }
    }
  }
  return problems;
}

/**
 * Checks every Spanish document (`*.es.md`) against its English original (`*.md`): the
 * original exists, both have the same sequence of heading levels and each links to the
 * other.
 */
export function checkBilingualParity(files: PublishedFiles): Problem[] {
  const problems: Problem[] = [];
  const describe = (level: number | undefined): string =>
    level === undefined ? 'no heading' : `level ${String(level)}`;

  for (const [spanish, spanishText] of files.texts) {
    if (!spanish.endsWith('.es.md')) continue;
    const english = `${spanish.slice(0, -'.es.md'.length)}.md`;
    const englishText = files.texts.get(english);
    if (englishText === undefined) {
      problems.push(problem(spanish, `has no English counterpart (${english})`));
      continue;
    }
    const here = readMarkdown(spanishText);
    const there = readMarkdown(englishText);
    const longest = Math.max(here.headings.length, there.headings.length);
    for (let index = 0; index < longest; index++) {
      const mine = here.headings[index];
      const theirs = there.headings[index];
      if (mine?.level === theirs?.level) continue;
      const detail = `${describe(mine?.level)} here, ${describe(theirs?.level)} there`;
      const message = `heading ${String(index + 1)} does not match ${english} (${detail})`;
      problems.push(problem(spanish, message, mine?.line));
      // Once one heading is missing or extra, the rest are out of step too.
      break;
    }
    const linksTo = (from: string, { links }: typeof here, to: string): boolean =>
      links.some(({ target }) => linkedPath(from, target) === to);
    if (!linksTo(english, there, spanish)) {
      problems.push(problem(english, `does not link to ${posix.basename(spanish)}`));
    }
    if (!linksTo(spanish, here, english)) {
      problems.push(problem(spanish, `does not link to ${posix.basename(english)}`));
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Language rules

/** Checks the style rules of the Spanish documents: no em dash and no middle dot. */
export function checkSpanishStyle(texts: ReadonlyMap<string, string>): Problem[] {
  return scanLines(
    texts,
    (path) => path.endsWith('.es.md'),
    (line) => [
      ...(line.includes(EM_DASH) ? ['em dash (use a comma, a colon or parentheses)'] : []),
      ...(line.includes(MIDDLE_DOT) ? ['middle dot as a separator (use a spaced hyphen)'] : []),
    ],
  );
}

/**
 * Checks that code and configuration are written in English, by looking for the characters
 * that only Spanish text would have. The lockfile is exempt: npm writes it, with whatever
 * the packages declare.
 */
export function checkEnglishCode(texts: ReadonlyMap<string, string>): Problem[] {
  return scanLines(
    texts,
    (path) => CODE_EXTENSIONS.has(extension(path)) && !isLockfile(path),
    (line) => (SPANISH_CHARACTERS.test(line) ? ['code and configuration must be in English'] : []),
  );
}

// ---------------------------------------------------------------------------
// Files that must or must not be there

/**
 * Checks that CLAUDE.md, when the repository has one, only imports AGENTS.md. The
 * instructions live in AGENTS.md, which every agent reads, and a second copy would drift.
 */
export function checkClaudeFile(files: PublishedFiles): Problem[] {
  const file = 'CLAUDE.md';
  if (!files.paths.has(file)) return [];
  if (files.texts.get(file)?.trim() !== '@AGENTS.md') {
    return [problem(file, 'must only contain @AGENTS.md (instructions live in AGENTS.md)')];
  }
  if (!files.paths.has('AGENTS.md')) {
    return [problem(file, 'imports AGENTS.md, which is not a published file')];
  }
  return [];
}

/** Checks that every required file is published. */
export function checkRequiredFiles(
  paths: ReadonlySet<string>,
  required: readonly string[] = REQUIRED_FILES,
): Problem[] {
  return required.filter((file) => !paths.has(file)).map((file) => problem(file, 'missing'));
}

/**
 * Checks that git ignores the folders of dependencies and generated output, and that no
 * published file sits in a folder with one of those names, at any depth.
 */
export function checkIgnoredFolders(
  paths: ReadonlySet<string>,
  isIgnored: (folder: string) => boolean,
  folders: readonly string[] = MUST_BE_IGNORED,
): Problem[] {
  const problems: Problem[] = [];
  for (const folder of folders) {
    if (!isIgnored(folder)) problems.push(problem('.gitignore', `${folder}/ must be ignored`));
  }
  for (const path of paths) {
    const parents = path.split('/').slice(0, -1);
    const folder = folders.find((name) => parents.includes(name));
    if (folder !== undefined) {
      problems.push(problem(path, `is inside ${folder}/, which must not be published`));
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------

/** Runs every check and returns the problems in a stable order: by file, then by line. */
export function runChecks(files: PublishedFiles, options: CheckOptions): Problem[] {
  const problems = [
    ...files.problems,
    ...checkIgnoredFolders(files.paths, options.isIgnored),
    ...checkRequiredFiles(files.paths),
    ...checkPersonalData(files, options.userName),
    ...checkSecrets(files.texts),
    ...checkBilingualParity(files),
    ...checkRelativeLinks(files),
    ...checkSpanishStyle(files.texts),
    ...checkEnglishCode(files.texts),
    ...checkClaudeFile(files),
  ];
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return problems.sort(
    (a, b) => order(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || order(a.message, b.message),
  );
}

/** Writes a problem the way compilers do, so that an editor can jump to it. */
export function formatProblem({ file, line, message }: Problem): string {
  return line === undefined ? `${file}: ${message}` : `${file}:${String(line)}: ${message}`;
}
