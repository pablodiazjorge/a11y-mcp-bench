// The catalog of criteria, and its agreement with docs/wcag-2.2-scope.md, which explains the same
// twelve criteria to people, and with the map of axe-core rules. The page is read with
// markdown-it, and any text of it that the test does not know makes it fail.

import { readFileSync } from 'node:fs';
import axe from 'axe-core';
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { criterionOfTag, readAxeFacts } from '../scripts/axe-rule-map.ts';
import { AXE_RULE_MAP } from '../src/core/axe-rules.ts';
import { CRITERIA, criterionSchema, type Criterion } from '../src/core/criteria.ts';

const TOKENS = new MarkdownIt().parse(
  readFileSync(new URL('../../../docs/wcag-2.2-scope.md', import.meta.url), 'utf8'),
  {},
);

// The texts that the table of the page uses for how a criterion is decided and for its class.
const DECIDED_BY = new Map<string, Criterion['decidedBy']>([
  ['axe-core rules', 'axe-core'],
  ['axe-core rule', 'axe-core'],
  ['axe-core rule `target-size`, turned on', 'axe-core'],
  ['Own check, a heuristic', 'heuristic'],
  ['Own check, set when the keyboard checks are designed', 'own-check'],
]);
const CLASS = new Map<string, Criterion['class']>([
  ['Automatic', 'automatic'],
  ['Semi-automatic', 'semi-automatic'],
  ['Not set yet', null],
]);

function known<T>(texts: Map<string, T>, text: string): T {
  if (!texts.has(text))
    throw new Error(`the scope page has a text the test does not know: ${text}`);
  return texts.get(text) as T;
}

/** The inline tokens of each cell of the rows of the page's table, one array per row. */
function tableRows(): Token[][] {
  const rows: Token[][] = [];
  let row: Token[] | undefined;
  let inBody = false;
  for (const token of TOKENS) {
    if (token.type === 'tbody_open') inBody = true;
    if (token.type === 'tbody_close') inBody = false;
    if (inBody && token.type === 'tr_open') rows.push((row = []));
    if (inBody && token.type === 'inline') row?.push(token);
  }
  return rows;
}

type TableFields = Pick<
  Criterion,
  'id' | 'name' | 'level' | 'understanding' | 'decidedBy' | 'class'
>;

/** Reads one row of the table: a link with the number and name, then level, way and class. */
function readRow([first, level, how, kind]: Token[]): TableFields {
  const parts = first?.children ?? [];
  const link = String(parts.find(({ type }) => type === 'link_open')?.attrGet('href') ?? '');
  const text = parts.find(({ type }) => type === 'text')?.content ?? '';
  const match = /^(\d\.\d\.\d{1,2}) (.+)$/.exec(text);
  const levels = new Map<string, Criterion['level']>([
    ['A', 'A'],
    ['AA', 'AA'],
  ]);
  if (match === null) throw new Error(`the scope page has a row the test does not know: ${text}`);
  return {
    id: match[1] ?? '',
    name: match[2] ?? '',
    level: known(levels, level?.content ?? ''),
    understanding: link,
    decidedBy: known(DECIDED_BY, how?.content ?? ''),
    class: known(CLASS, kind?.content ?? ''),
  };
}

/**
 * The inline tokens under each criterion's heading in the section "The twelve criteria", by
 * criterion number. A heading there that does not start with a number fails the test.
 */
function sections(): Map<string, Token[]> {
  const found = new Map<string, Token[]>();
  let inTwelve = false;
  let current: Token[] | undefined;
  for (const [index, token] of TOKENS.entries()) {
    if (token.type === 'heading_open') {
      const title = TOKENS[index + 1]?.content ?? '';
      if (token.tag === 'h2') inTwelve = title === 'The twelve criteria';
      current = undefined;
      if (!inTwelve || token.tag !== 'h3') continue;
      const id = /^(\d\.\d\.\d{1,2}) /.exec(title)?.[1];
      if (id === undefined)
        throw new Error(`the scope page has a heading the test does not know: ${title}`);
      found.set(id, (current = []));
    } else if (token.type === 'inline' && current !== undefined) {
      current.push(token);
    }
  }
  return found;
}

/** The bold label that starts a list item, such as `Requires:`, and the inline tokens after it. */
function labeled(items: Token[], label: RegExp): { label: string; rest: Token[] } | undefined {
  for (const { children } of items) {
    // markdown-it starts an inline run with an empty text token.
    const parts = (children ?? []).filter(({ type, content }) => type !== 'text' || content !== '');
    const text = parts[0]?.type === 'strong_open' ? (parts[1]?.content ?? '') : '';
    if (label.test(text)) return { label: text, rest: parts.slice(3) };
  }
  return undefined;
}

interface Piece {
  code: boolean;
  text: string;
}

/**
 * Inline tokens as runs of text and code spans. A line break inside a paragraph reads as a space,
 * so a sentence or a list that is wrapped by hand reads the same.
 */
function pieces(tokens: Token[]): Piece[] {
  const found: Piece[] = [];
  for (const token of tokens) {
    const code = token.type === 'code_inline';
    const text = token.type === 'softbreak' ? ' ' : token.content;
    const last = found.at(-1);
    if (!code && last !== undefined && !last.code) last.text += text;
    else found.push({ code, text });
  }
  return found;
}

/** The text of inline tokens, with code spans in backticks as the page writes them. */
function textOf(tokens: Token[]): string {
  return pieces(tokens)
    .map(({ code, text }) => (code ? `\`${text}\`` : text))
    .join('');
}

/** The rule ids that a list item gives as a list: code spans joined by commas or `and`. */
function ruleList(rest: Token[]): string[] {
  const parts = pieces(rest);
  const ids: string[] = [];
  for (const part of parts.slice(parts.findIndex(({ code }) => code))) {
    if (part.code) ids.push(part.text);
    else if (!/^(, |, and | and )$/.test(part.text)) break;
  }
  return ids;
}

const valid: Criterion = {
  id: '2.4.11',
  name: 'Focus Not Obscured (Minimum)',
  level: 'AA',
  requires: 'Something.',
  understanding: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
  decidedBy: 'own-check',
  class: null,
};

describe('the criteria catalog', () => {
  it('holds twelve criteria, once each, in the order of their numbers', () => {
    expect(CRITERIA.map(({ id }) => id)).toStrictEqual([
      ...['1.1.1', '1.3.1', '1.3.5', '1.4.3', '2.1.1', '2.1.2', '2.4.3', '2.4.4'],
      ...['2.4.7', '2.4.11', '2.5.8', '4.1.2'],
    ]);
  });

  it('agrees with the table of the scope page', () => {
    const rows = tableRows().map(readRow);

    expect(rows).toHaveLength(12);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const { id, name, level, understanding, decidedBy, class: kind } of CRITERIA) {
      expect({ id, name, level, understanding, decidedBy, class: kind }).toStrictEqual(
        byId.get(id),
      );
    }
  });

  it('says what each criterion requires as the scope page does', () => {
    const page = sections();

    expect([...page.keys()].sort()).toStrictEqual(CRITERIA.map(({ id }) => id).sort());
    for (const { id, requires } of CRITERIA) {
      const item = labeled(page.get(id) ?? [], /^Requires:$/);
      const sentence = textOf(item?.rest ?? []).trim();
      expect(requires, id).toBe(sentence.charAt(0).toUpperCase() + sentence.slice(1));
    }
  });

  it('accepts a valid criterion and rejects one outside the scope', () => {
    expect(criterionSchema.parse(valid)).toStrictEqual(valid);
    for (const wrong of [
      { ...valid, id: '2.4' },
      { ...valid, level: 'AAA' },
      { ...valid, understanding: 'http://www.w3.org/WAI/WCAG22/Understanding/keyboard.html' },
      { ...valid, understanding: 'https://example.com/keyboard.html' },
      { ...valid, decidedBy: 'axe' },
      { ...valid, class: 'manual' },
      { ...valid, name: '' },
    ]) {
      expect(criterionSchema.safeParse(wrong).success).toBe(false);
    }
  });
});

describe('the rule lists of the scope page', () => {
  const page = sections();
  const carrying = (id: string) =>
    AXE_RULE_MAP.rules.filter(({ criteria }) => criteria.includes(id));

  it.each(CRITERIA.filter(({ decidedBy }) => decidedBy === 'axe-core'))(
    'list the rules of $id that axe-core runs by default, with their count',
    ({ id }) => {
      const item = labeled(page.get(id) ?? [], /^Rules? \(\d+\):$/);
      const count = Number(/\((\d+)\)/.exec(item?.label ?? '')?.[1]);
      const listed = ruleList(item?.rest ?? []);
      // 2.5.8 has one rule, which axe-core ships turned off and the server turns on.
      const rules = carrying(id).filter((rule) =>
        id === '2.5.8' ? !rule.enabled : rule.runsByDefault,
      );

      // The order of the list on the page does not matter.
      expect([...listed].sort(), id).toStrictEqual(rules.map((rule) => rule.id).sort());
      expect(count, id).toBe(listed.length);
    },
  );

  it('lists the default rules of axe-core that carry 2.1.1', () => {
    const item = labeled(page.get('2.1.1') ?? [], /^axe-core:$/);
    const rules = carrying('2.1.1').filter(({ runsByDefault }) => runsByDefault);

    expect(ruleList(item?.rest ?? []).sort()).toStrictEqual(rules.map(({ id }) => id).sort());
  });

  it('names every rule of the map under each criterion that the rule carries', () => {
    for (const { id: rule, criteria } of AXE_RULE_MAP.rules) {
      for (const criterion of criteria) {
        const spans = (page.get(criterion) ?? [])
          .flatMap(({ children }) => children ?? [])
          .filter(({ type }) => type === 'code_inline')
          .map(({ content }) => content);
        expect(spans, `${rule} under ${criterion}`).toContain(rule);
      }
    }
  });
});

describe('the counts of axe-core on the scope page', () => {
  // The page's own sentences, read as plain text, with the numbers that the test compares.
  const text = TOKENS.filter(({ type }) => type === 'inline')
    .map(({ children }) => textOf(children ?? []))
    .join('\n');
  const number = (pattern: RegExp, name: string): number => {
    const found = pattern.exec(text)?.[1];
    if (found === undefined)
      throw new Error(`the scope page does not say ${name} as the test expects`);
    return Number(found);
  };

  it('are the counts of the installed axe-core', () => {
    const { rules } = readAxeFacts(axe);
    const noCriterion = ({ tags }: { tags: readonly string[] }) =>
      tags.every((tag) => criterionOfTag(tag) === undefined);

    expect(rules).toHaveLength(number(/It has (\d+) rules, and a default run/, 'the rules'));
    expect(rules.filter(({ runsByDefault }) => runsByDefault)).toHaveLength(
      number(/a default run uses (\d+):/, 'the default run'),
    );
    expect(rules.filter(({ enabled }) => !enabled)).toHaveLength(
      number(/it leaves out the (\d+) that are turned off/, 'the rules turned off'),
    );
    expect(rules.filter(({ tags }) => tags.includes('experimental'))).toHaveLength(
      number(/and (\d+) that are experimental/, 'the experimental rules'),
    );
    expect(
      rules.filter((rule) => rule.tags.includes('best-practice') && noCriterion(rule)),
    ).toHaveLength(
      number(/has (\d+) rules that carry no WCAG criterion/, 'the best-practice rules'),
    );
  });
});
