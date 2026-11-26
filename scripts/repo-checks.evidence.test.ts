import { describe, expect, it } from 'vitest';
import { checkCitedTests, checkPinnedActions } from './repo-checks.evidence.ts';
import { formatProblem, type Problem, type PublishedFiles } from './repo-checks.ts';

// The checks that keep two claims true: that each test that THREAT_MODEL.md cites is a test of
// its file, and that each action that a workflow uses is pinned.

const published = (entries: Record<string, string>): PublishedFiles => ({
  paths: new Set(Object.keys(entries)),
  texts: new Map(Object.entries(entries)),
  problems: [],
});
const oneFile = (text: string, path: string) => published({ [path]: text }).texts;
const report = (problems: readonly Problem[]): string[] => problems.map(formatProblem);

describe('checkCitedTests', () => {
  const TEST = 'scripts/a.test.ts';
  const model = (...citations: string[]): string =>
    citations.map((citation) => `- \`${citation}\``).join('\n');
  const notATest = (line: number, name: string): string =>
    `THREAT_MODEL.md:${String(line)}: cites "${name}", which is not a test that ${TEST} runs`;

  it('accepts a test and a group, called directly or through .each, with or without type arguments', () => {
    const source = [
      "describe('the walk', () => {",
      "  it('keeps the rule', () => {});",
      '  it.each([[1, (x: number) => x]])("checks case %i", () => {});',
      '  it.each<[string, number]>([',
      "    ['a', 1],",
      '  ])(`reads %s`, () => {});',
      "  describe.concurrent.each(['x'])('runs %s at once', () => {});",
      "  test(\n    'is written on its own line',\n    () => {},\n  );",
      '});',
    ].join('\n');
    const files = published({
      'THREAT_MODEL.md': model(
        `${TEST} > the walk`,
        `${TEST} > keeps the rule`,
        `${TEST} > checks case %i`,
        `${TEST} > reads %s`,
        `${TEST} > runs %s at once`,
        `${TEST} > is written on its own line`,
      ),
      [TEST]: source,
    });

    expect(checkCitedTests(files)).toEqual([]);
  });

  it('reports a cited file that is missing and a test that was renamed, with their lines', () => {
    const files = published({
      'THREAT_MODEL.md': model('scripts/gone.test.ts > keeps the rule', `${TEST} > keeps a rule`),
      [TEST]: "it('keeps the rule', () => {});\n",
    });

    expect(report(checkCitedTests(files))).toEqual([
      'THREAT_MODEL.md:1: cites scripts/gone.test.ts, which is not a published file',
      notATest(2, 'keeps a rule'),
    ]);
  });

  it('reports a name that the file has as another string, or as a test that does not run', () => {
    const source = [
      '// The old test `presses nothing at all` was removed.',
      "it('keeps the walk short', () => { expect(log).toContain('submits the form twice'); });",
      "it.skip('is skipped, but still counts', () => {});",
      "it.only('runs alone', () => {});",
      "it.todo('comes later');",
      'const note = "a test that never existed";',
    ].join('\n');
    const files = published({
      'THREAT_MODEL.md': model(
        `${TEST} > presses nothing at all`,
        `${TEST} > submits the form twice`,
        `${TEST} > is skipped, but still counts`,
        `${TEST} > runs alone`,
        `${TEST} > comes later`,
        `${TEST} > a test that never existed`,
        `${TEST} > keeps the walk short`,
      ),
      [TEST]: source,
    });

    expect(report(checkCitedTests(files))).toEqual([
      notATest(1, 'presses nothing at all'),
      notATest(2, 'submits the form twice'),
      notATest(3, 'is skipped, but still counts'),
      notATest(4, 'runs alone'),
      notATest(5, 'comes later'),
      notATest(6, 'a test that never existed'),
    ]);
  });

  it('reads only the code spans that cite a test', () => {
    const files = published({ 'THREAT_MODEL.md': 'Run `npm run ci`, and `a > b`.\n' });

    expect(checkCitedTests(files)).toEqual([]);
  });
});

describe('checkPinnedActions', () => {
  const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
  const DIGEST = 'b'.repeat(64);
  const WORKFLOW = '.github/workflows/ci.yml';
  const unread = (line: number): string =>
    `${WORKFLOW}:${String(line)}: writes uses in a form that this check does not read`;
  const unpinned = (line: number, used: string): string =>
    `${WORKFLOW}:${String(line)}: uses ${used}, which is not pinned to a commit or a digest`;

  it('accepts a commit SHA, a quoted one, a Docker digest and an action of the repository', () => {
    const workflow = [
      'steps:',
      '  # uses: actions/checkout@v7, in a comment',
      `  - uses: actions/checkout@${SHA} # v7.0.1`,
      `  - uses: "owner/action/path@${SHA}"`,
      `  - uses: 'owner/action@${SHA}'`,
      `  - uses: docker://alpine@sha256:${DIGEST}`,
      '  - uses: ./.github/actions/local',
    ].join('\n');

    expect(checkPinnedActions(oneFile(workflow, WORKFLOW))).toEqual([]);
  });

  it('reports a tag, a branch, a short SHA, a reusable workflow on a branch and a Docker tag', () => {
    const workflow = [
      '  - uses: actions/checkout@v7',
      '    uses: actions/setup-node@main',
      `  - uses: owner/action@${SHA.slice(0, 7)}`,
      '    uses: org/repo/.github/workflows/w.yml@main',
      '  - uses: docker://alpine:3.20',
    ].join('\n');

    expect(report(checkPinnedActions(oneFile(workflow, WORKFLOW)))).toEqual([
      unpinned(1, 'actions/checkout@v7'),
      unpinned(2, 'actions/setup-node@main'),
      unpinned(3, `owner/action@${SHA.slice(0, 7)}`),
      unpinned(4, 'org/repo/.github/workflows/w.yml@main'),
      unpinned(5, 'docker://alpine:3.20'),
    ]);
  });

  it.each([
    ['a flow mapping', `  - { uses: actions/checkout@${SHA} }`],
    ['a quoted key', `  - "uses": actions/checkout@${SHA}`],
    ['a key in single quotes', `  - 'uses': actions/checkout@${SHA}`],
    ['a block scalar', '    uses: >-'],
    ['a literal block', '    uses: |'],
    ['no value on the line', '    uses:'],
    ['a value in brackets', '    uses: [actions/checkout]'],
  ])('reports %s, which it does not read, rather than skip it', (_case, line) => {
    expect(report(checkPinnedActions(oneFile(line, WORKFLOW)))).toEqual([unread(1)]);
  });

  it('reads the actions of the repository and both extensions, and no other file', () => {
    const texts = new Map([
      ['.github/actions/local/action.yml', '    - uses: actions/checkout@v7'],
      ['.github/actions/a/b/action.yaml', '    - uses: actions/checkout@v7'],
      ['.github/workflows/w.yaml', '    - uses: actions/checkout@v7'],
      ['docs/example.yml', 'uses: actions/checkout@v7'],
      ['.github/dependabot.yml', 'uses: actions/checkout@v7'],
    ]);

    expect(report(checkPinnedActions(texts)).map((line) => line.split(':')[0])).toEqual([
      '.github/actions/local/action.yml',
      '.github/actions/a/b/action.yaml',
      '.github/workflows/w.yaml',
    ]);
  });
});
