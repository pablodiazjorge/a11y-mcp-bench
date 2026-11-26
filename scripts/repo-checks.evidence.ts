// The repository checks that keep two claims true: each test that THREAT_MODEL.md cites is a
// test of its file, and each action that a workflow runs is pinned to a commit. repo-checks.ts
// runs them with the others.

import { readCodeSpans } from './markdown.ts';

interface Problem {
  file: string;
  line?: number;
  message: string;
}

const problem = (file: string, message: string, line: number): Problem => ({
  file,
  line,
  message,
});

/** The documents whose citations of tests the gate checks. */
export const CITING_FILES: readonly string[] = ['THREAT_MODEL.md'];

// A citation of a test, in a code span: the path of the test file from the root, ` > ` and the
// name of the test as its source writes it, the template of an `it.each` included.
const CITATION = /^(?<path>[\w./-]+\.test\.ts) > (?<name>.+)$/;
// What may come before the parenthesis that opens the name: a test or a group of Vitest that
// runs, called directly or through `.each(…)`. `.skip`, `.todo` and `.only` are not in it.
const TEST_CALL = /\b(?:it|test|describe)(?:\.(?:concurrent|sequential))?$/;
const EACH_CALL = /\b(?:it|test|describe)(?:\.(?:concurrent|sequential))?\.each$/;

/** The index of the last character before `index` that is not white space, or -1. */
function back(source: string, index: number): number {
  let at = index;
  while (at >= 0 && /\s/.test(source[at] ?? '')) at--;
  return at;
}

/** The index of the bracket that opens the one that closes at `index`, or -1. */
function opening(source: string, index: number, open: string, close: string): number {
  let depth = 0;
  for (let at = index; at >= 0; at--) {
    if (source[at] === close) depth++;
    else if (source[at] === open && --depth === 0) return at;
  }
  return -1;
}

/**
 * Whether the string that opens at `quote` is the name of a test or a group: the first argument
 * of `it`, `test` or `describe`, called directly or through `.each(…)`.
 */
function isTestName(source: string, quote: number): boolean {
  let at = back(source, quote - 1);
  if (source[at] !== '(') return false;
  at = back(source, at - 1);
  if (source[at] !== ')') return TEST_CALL.test(source.slice(0, at + 1));
  // The cases of `.each`, and the type arguments that may come before them.
  at = back(source, opening(source, at, '(', ')') - 1);
  if (source[at] === '>') at = back(source, opening(source, at, '<', '>') - 1);
  return at >= 0 && EACH_CALL.test(source.slice(0, at + 1));
}

/**
 * Checks the tests that a document cites, so that a claim does not outlive its evidence: the
 * cited file is published, and the cited name is the name of a test or a group of it that Vitest
 * runs, not a string elsewhere in the file. The check reads the source; it does not run the test,
 * so it cannot tell whether the test shows what the document says.
 */
export function checkCitedTests(
  files: { readonly texts: ReadonlyMap<string, string> },
  citing = CITING_FILES,
): Problem[] {
  const problems: Problem[] = [];
  for (const file of citing) {
    for (const { content, line } of readCodeSpans(files.texts.get(file) ?? '')) {
      const { path, name } = CITATION.exec(content)?.groups ?? {};
      if (path === undefined || name === undefined) continue;
      const source = files.texts.get(path);
      if (source === undefined) {
        problems.push(problem(file, `cites ${path}, which is not a published file`, line));
        continue;
      }
      const found = ["'", '"', '`'].some((quote) => {
        for (let at = source.indexOf(quote + name + quote); at !== -1;) {
          if (isTestName(source, at)) return true;
          at = source.indexOf(quote + name + quote, at + 1);
        }
        return false;
      });
      if (!found) {
        problems.push(
          problem(file, `cites "${name}", which is not a test that ${path} runs`, line),
        );
      }
    }
  }
  return problems;
}

// The files that can run an action: the workflows, and the actions that the repository defines.
const RUNS_ACTIONS = /^\.github\/(?:workflows\/[^/]+|actions\/(?:[^/]+\/)*action)\.ya?ml$/;
// A key `uses`, in any form: plain, quoted or inside a flow mapping.
const ANY_USES = /(?:^|[\s{,])["']?uses["']?\s*:/;
// The one form that the check reads: `uses:` as a plain key, alone or after the dash of a list
// item, a plain or quoted value on the same line, and an optional comment.
const PLAIN_USES =
  /^\s*(?:-\s+)?uses:\s+(?:"([^"\s]+)"|'([^'\s]+)'|([^\s"'#>|{[][^\s#]*))\s*(?:#.*)?$/;
const PINNED = [
  /^\.\//,
  /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/,
  /^docker:\/\/[^\s@]+@sha256:[0-9a-f]{64}$/,
];

/**
 * Checks that each action that a workflow or an action of the repository uses is pinned: to a
 * full commit SHA, to the digest of a Docker image, or is an action of the repository itself
 * (`./`), as a tag or a branch can be moved to other code. It guards security, so it reads one
 * form of `uses` and reports any other, such as a flow mapping or a block scalar, rather than
 * skip it.
 */
export function checkPinnedActions(texts: ReadonlyMap<string, string>): Problem[] {
  const problems: Problem[] = [];
  for (const [file, text] of texts) {
    if (!RUNS_ACTIONS.test(file)) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*#/.test(line) || !ANY_USES.test(line)) return;
      const read = PLAIN_USES.exec(line);
      const used = read?.[1] ?? read?.[2] ?? read?.[3];
      if (used === undefined) {
        problems.push(
          problem(file, 'writes uses in a form that this check does not read', index + 1),
        );
      } else if (!PINNED.some((pin) => pin.test(used))) {
        problems.push(
          problem(file, `uses ${used}, which is not pinned to a commit or a digest`, index + 1),
        );
      }
    });
  }
  return problems;
}
