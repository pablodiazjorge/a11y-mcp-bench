import { describe, expect, it } from 'vitest';
import { readMarkdown } from './markdown.ts';

// Every text of the two tables called "as GitHub does" was rendered with GitHub's Markdown
// API, and the expected result is what GitHub showed for it. The other tests were not
// compared with GitHub: they cover what this file adds to the parser. A target is written
// as the parser gives it, with a space as `%20` and a backslash as `%5C`.

const F = '```';
const targets = (text: string): string[] => readMarkdown(text).links.map((link) => link.target);
const levels = (text: string): number[] => readMarkdown(text).headings.map((one) => one.level);

describe('readMarkdown: links', () => {
  it.each<[string, string, string[]]>([
    // Destinations.
    ['a plain link', '[x](other.md)', ['other.md']],
    ['an anchor', '[x](other.md#sec)', ['other.md#sec']],
    ['a query', '[x](other.md?plain=1)', ['other.md?plain=1']],
    ['angle brackets', '[x](<other.md>)', ['other.md']],
    ['angle brackets around a space', '[x](<Guide Two.md>)', ['Guide%20Two.md']],
    ['an encoded space', '[x](Guide%20Two.md)', ['Guide%20Two.md']],
    ['a space without brackets, which is not a link', '[x](Guide Two.md)', []],
    ['balanced parentheses', '[x](a_(b).md)', ['a_(b).md']],
    ['an escaped angle bracket', '[x](<miss\\>ing.md>)', ['miss%3Eing.md']],
    ['a backslash before an underscore, which hides', '[x](a\\_b.md)', ['a_b.md']],
    ['M12: a backslash before a dot, which hides', '[x](other\\.md)', ['other.md']],
    ['M11: a backslash before a letter, which stays', '[x](oth\\er.md)', ['oth%5Cer.md']],
    ['a character entity', '[x](missing&#46;md)', ['missing.md']],
    ['a destination on the next line', '[x](\nmissing.md)', ['missing.md']],
    ['a file URL, which is not a link', '[x](file:///work/docs/a.md)', []],
    // Titles. Prettier rewrites the first form into the second in this repository.
    ['a title in double quotes', '[x](missing.md "T")', ['missing.md']],
    ['a title in single quotes', "[x](missing.md 'T')", ['missing.md']],
    ['a title in parentheses', '[x](missing.md (T))', ['missing.md']],
    // Images and what holds a link.
    ['an image', '![i](img/a%20b.png)', ['img/a%20b.png']],
    ['brackets in the text of a link', '[a [b] c](missing.md)', ['missing.md']],
    ['an escaped bracket, which is not a link', '\\[x](missing.md)', []],
    ['a link in a heading', '## See [x](missing.md)', ['missing.md']],
    ['a link in a table', '| a | [x](missing.md) |\n|---|---|', ['missing.md']],
    ['a file name in plain text', 'missing.md', []],
    ['a file name in angle brackets', '<missing.md>', []],
    // References. Footnotes have their own tests below.
    ['a reference that is used', '[x][r]\n\n[r]: missing.md', ['missing.md']],
    ['a reference that is not used', '[r]: missing.md "T"', []],
    ['a line that only looks like a reference', 'Some text\n[r]: missing.md', []],
    ['a reference defined in a quote', '> [r]: missing.md\n\n[x][r]', ['missing.md']],
    ['a reference defined in a list item', '- [r]: missing.md\n\n[x][r]', ['missing.md']],
    ['a reference in indented code', 'Text\n\n    [r]: missing.md', []],
    ['M2: a label with an escaped bracket', '[x][a\\]b]\n\n[a\\]b]: missing.md', ['missing.md']],
    // Code, which hides a link.
    ['a code span', '`[x](missing.md)`', []],
    ['a code span of two backticks', '``[x](missing.md) ` ``', []],
    ['an indented code block', 'Text\n\n    [x](missing.md)', []],
    ['a fenced block in a quote', `> ${F}\n> [x](missing.md)\n> ${F}`, []],
    ['a fence with a language, which cannot close', `${F}\n${F}js\n[x](missing.md)\n${F}`, []],
    // Text that looks like code and is not, so the link is real.
    ['a link between two code spans', '`a` [x](missing.md) `b`', ['missing.md']],
    ['a code span that holds a backtick', 'A `` ` `` then [x](missing.md)', ['missing.md']],
    ['N5: escaped backticks', 'Use \\` and [x](missing.md) and \\`.', ['missing.md']],
    [
      'an escaped backtick and a code span',
      'A \\` and `code` then [x](missing.md)',
      ['missing.md'],
    ],
    [
      'a 4-space fence after a paragraph',
      `Text\n\n    ${F}\n[x](missing.md)\n    ${F}`,
      ['missing.md'],
    ],
    [
      'a tab and a fence after a paragraph',
      `Text\n\n\t${F}\n[x](missing.md)\n\t${F}`,
      ['missing.md'],
    ],
    [
      'a 4-space fence after a rule',
      `* * *\n\n    ${F}\n[x](missing.md)\n    ${F}`,
      ['missing.md'],
    ],
    [
      'a 4-space fence after a list item',
      `- item\n\n    ${F}\n[x](missing.md)\n    ${F}`,
      ['missing.md'],
    ],
    ['N1: a line left of its item', `1. item\n   ${F}\n [x](missing.md)\n   ${F}`, ['missing.md']],
    [
      'N2: a fence deep in its item',
      `1. item\n\n       ${F}\n   [x](missing.md)\n       ${F}`,
      ['missing.md'],
    ],
    [
      'N3: a fence that its nested item ends',
      `- outer\n  - inner\n    ${F}\n    code\n  [x](missing.md)\n\n  ${F}\n  more\n  ${F}`,
      ['missing.md'],
    ],
    [
      'N4: a line left of its quoted item',
      `> 1. item\n>    ${F}\n> [x](missing.md)\n>    ${F}`,
      ['missing.md'],
    ],
    // Comments, and text that looks like one.
    ['a comment', '<!-- [x](missing.md) -->', []],
    ['a comment of several lines', '<!--\n[x](missing.md)\n-->', []],
    ['text after the end of a comment block', '<!--\nnote\n--> [x](missing.md)', []],
    ['text after a comment at the start of a line', '<!-- c -->[x](missing.md)', []],
    ['a comment inside a paragraph', 'Text <!-- c --> [x](missing.md)', ['missing.md']],
    ['N6: an escaped comment opener', '\\<!-- [x](missing.md) -->', ['missing.md']],
    [
      'N7: a comment opener in a title',
      '[y](other.md "<!--")\n\n[x](missing.md)\n\n-->',
      ['other.md', 'missing.md'],
    ],
    [
      'M1: a comment open over a blank line',
      'Text <!-- note\n\n[x](missing.md)\n\n-->',
      ['missing.md'],
    ],
    // Rules that look like front matter.
    ['N8: a rule on the first line', '---\n\n[x](missing.md)\n\n---\n\nEnd', ['missing.md']],
    [
      'M6: a rule, text and dots',
      '---\ntitle: x\n...\n\n[x](missing.md)\n\n---\n\nEnd',
      ['missing.md'],
    ],
    // Raw HTML.
    ['an HTML link in single quotes', "<a href='missing.md'>x</a>", ['missing.md']],
    ['an HTML image without quotes', '<img src=missing.png>', ['missing.png']],
    ['an HTML image with a space', '<img src="img/a b.png">', ['img/a b.png']],
    ['Markdown in an HTML block, which is text', '<div>\n[x](missing.md)\n</div>', []],
    ['Markdown in a pre block, which is text', '<pre>\n[x](missing.md)\n</pre>', []],
    [
      'Markdown after a blank line in HTML',
      '<details>\n\n[x](missing.md)\n\n</details>',
      ['missing.md'],
    ],
    ['M5: srcset', '<img srcset="img/none.png 2x" src="img/a%20b.png">', ['img/a%20b.png']],
    ['M7: a video', '<video src="img/a%20b.png" poster="img/none.png"></video>', []],
  ])('reads %s as GitHub does', (_case, text, expected) => {
    expect(targets(text)).toEqual(expected);
    expect(readMarkdown(text).unread).toEqual([]);
  });

  it.each<[string, string, string[]]>([
    ['an image inside a link', '[![i](i.png)](other.md)', ['other.md', 'i.png']],
    ['a fenced block', `${F}md\n[x](missing.md)\n${F}`, []],
    ['an HTML tag in capitals', '<A HREF="missing.md">x</A>', ['missing.md']],
    [
      'a comment inside an HTML block',
      '<div>\n<!-- <img src="no.png"> -->\n<img src="a.png">\n</div>',
      ['a.png'],
    ],
    ['a comment that never closes', '<div>\n<!-- <img src="no.png">\n</div>', []],
    ['attributes of other tags', '<div>\n<source src="a.mp4"><link href="a.css">\n</div>', []],
    ['attributes that end like href and src', '<a data-href="a.md"><img data-src="a.png"></a>', []],
    ['the attribute of the other tag', '<a src="a.md"><img href="a.png"></a>', []],
  ])('reads %s', (_case, text, expected) => {
    expect(targets(text)).toEqual(expected);
    expect(readMarkdown(text).unread).toEqual([]);
  });

  it('reads a path on a local drive as a link, though GitHub shows it without a destination', () => {
    // M3: the one text of the table where the parser and GitHub differ. checkRelativeLinks
    // reports such a link, so that it is not taken for a URL with a scheme.
    expect(targets('[x](C:/work/docs/a.md)')).toEqual(['C:/work/docs/a.md']);
  });

  it('gives the line of every link', () => {
    const text = [
      'First [a](one.md)',
      'and [b](two.md) with',
      'an image ![c](three.png).',
      '',
      '| Name | Link |',
      '| ---- | ---- |',
      '| x    | [d](four.md) |',
      '',
      '<div>',
      '  <!-- a',
      '  comment -->',
      '  <a href="five.md">e</a>',
      '</div>',
      '',
      'Text <a',
      '  href="six.md">f</a> and [g](seven.md).',
    ].join('\n');

    expect(readMarkdown(text).links).toEqual([
      { target: 'one.md', line: 1 },
      { target: 'two.md', line: 2 },
      { target: 'three.png', line: 3 },
      { target: 'four.md', line: 7 },
      { target: 'five.md', line: 12 },
      { target: 'six.md', line: 15 },
      { target: 'seven.md', line: 16 },
    ]);
  });

  it.each([
    ['an attribute without a value', '<div>\n<a href=>x</a>\n</div>'],
    ['a quote that does not close', '<p>\n<img src="a.png>\n</p>'],
  ])('reports %s in raw HTML, where it cannot tell what GitHub shows', (_case, text) => {
    expect(readMarkdown(text)).toEqual({
      headings: [],
      links: [],
      unread: [{ line: 2, message: 'link this check cannot read' }],
    });
  });
});

describe('readMarkdown: footnotes', () => {
  const issues = (text: string) => readMarkdown(text).unread;

  // The parser does not know footnotes. Without this rule, the link of the first text is
  // never checked, because the second paragraph of the note is read as code.
  it.each<[string, string, number]>([
    [
      'a note with a second paragraph',
      'A[^1].\n\n[^1]: First.\n\n    Second with [x](missing.md).',
      3,
    ],
    ['a note of one word', 'A[^1].\n\n[^1]: TODO', 3],
    ['a note with a link', 'A[^1].\n\n[^1]: See [x](missing.md).', 3],
    ['a note inside a quote', '> A[^note].\n>\n> [^note]: Text.', 3],
    [
      'a note written as a list item',
      'A[^1].\n\n- [^1]: See the guide.\n\n      [x](missing.md)',
      3,
    ],
    ['a one-word note written as a list item', 'A[^1].\n\n- [^1]: First.', 3],
  ])('reports %s', (_case, text, line) => {
    expect(issues(text)).toEqual([{ line, message: 'footnote, which this check cannot read' }]);
  });

  it('does not report a line that looks like a footnote inside code', () => {
    expect(issues(`${F}\n[^1]: text\n${F}`)).toEqual([]);
    expect(issues('Text\n\n    [^1]: text')).toEqual([]);
    expect(issues('A `[^1]: text` in a code span')).toEqual([]);
  });
});

describe('readMarkdown: headings', () => {
  it.each<[string, string, number[]]>([
    ['an ATX heading', '# Extra', [1]],
    ['an ATX heading with up to three spaces', '  ## Extra', [2]],
    ['an ATX heading after a tab', '#\tExtra', [1]],
    ['an ATX heading without a title', '#', [1]],
    ['a Setext heading of level 1', 'Extra\n=====', [1]],
    ['a Setext heading of level 2', 'Extra\n-----', [2]],
    ['a heading in a quote', '> ## Extra', [2]],
    ['a heading in a list item', '- ## Extra', [2]],
    ['a heading in a numbered item', '1. # Extra', [1]],
    ['a heading on the second line of a list item', '- item\n  ## Extra', [2]],
    ['a Setext heading in a list item', '- Extra\n  ---', [2]],
    ['equals signs after a quote, which are text', '> Extra\n===', []],
    ['an HTML heading', '<h3 align="center">Extra</h3>', [3]],
    ['an HTML heading with attributes on the next line', '<h2\n  id="x">Extra</h2>', [2]],
    ['a heading tag in a code span', 'Use `<h2>` here', []],
    ['a heading tag in a comment', '<!-- <h2>Extra</h2> -->', []],
    ['a heading after a blank line in HTML', '<details>\n\n## Extra\n\n</details>', [2]],
    ['N1: a heading left of its item', `1. item\n   ${F}\n ## Extra\n   ${F}`, [2]],
    ['N4: a heading left of its quoted item', `> 1. item\n>    ${F}\n> ## Extra\n>    ${F}`, [2]],
    ['N5: a heading between escaped backticks', 'Use \\` and\n\n## Extra\n\nand \\`.', [2]],
    ['N6: a heading after an escaped comment opener', '\\<!-- x\n\n## Extra\n\n-->', [2]],
    ['N8: a heading between two rules', '---\n\n## Extra\n\n---', [2]],
    ['M1: a heading after a comment left open', 'Text <!-- note\n\n## Extra\n\n-->', [2]],
    ['M6: a heading after a rule, text and dots', '---\ntitle: x\n...\n\n## Extra\n\n---', [2]],
  ])('reads %s as GitHub does', (_case, text, expected) => {
    expect(levels(text)).toEqual(expected);
  });

  it('does not read a heading in a fenced block', () => {
    expect(levels(`${F}sh\n# a comment\n${F}`)).toEqual([]);
  });

  it('gives the line of every heading, in the order of the document', () => {
    const lines = [
      '# One',
      '',
      'Two',
      '---',
      '',
      '<div>',
      '<h3>Three</h3>',
      '</div>',
      '',
      '> #### Four',
    ];

    expect(readMarkdown(lines.join('\n')).headings).toEqual([
      { level: 1, line: 1 },
      { level: 2, line: 3 },
      { level: 3, line: 7 },
      { level: 4, line: 10 },
    ]);
  });
});

// Found in the third review, each one rendered with GitHub's Markdown API: GitHub shows the
// link or the heading, and an earlier version of this file said nothing.
describe('readMarkdown: raw HTML that an earlier version misread', () => {
  it.each<[string, string, string[]]>([
    [
      'a picture with a source for dark mode',
      '<picture><source media="(prefers-color-scheme: dark)" srcset="img/none.png"><img src="img/a.png"></picture>',
      ['img/none.png', 'img/a.png'],
    ],
    [
      'every candidate of a srcset',
      '<picture><source srcset="a.png 1x, b.png 2x"><img src="c.png"></picture>',
      ['a.png', 'b.png', 'c.png'],
    ],
    ['a comment that ends at once', '<!--> <a href="missing.md">x</a> -->', ['missing.md']],
    ['a comment closed by --!>', '<!-- n --!> <a href="missing.md">x</a> -->', ['missing.md']],
    [
      'a comment opener inside a quoted value',
      '<a title="<!--" href="missing.md">x</a> -->',
      ['missing.md'],
    ],
  ])('reads the links of %s', (_case, text, expected) => {
    expect(targets(text)).toEqual(expected);
    expect(readMarkdown(text).unread).toEqual([]);
  });

  it('does not read the srcset of an image, which GitHub removes', () => {
    expect(targets('<img srcset="img/none.png 2x" src="img/a.png">')).toEqual(['img/a.png']);
  });

  it.each<[string, string, number[]]>([
    ['a heading tag closed with a slash', '<h2/>Extra', [2]],
    ['a heading after a comment that ends at once', '<!--> <h2>Extra</h2> -->', [2]],
    ['a heading after a comment closed by --!>', '<!-- n --!> <h2>Extra</h2> -->', [2]],
  ])('counts %s', (_case, text, expected) => {
    expect(levels(text)).toEqual(expected);
  });

  it('gives the line of each tag in a long piece of HTML', () => {
    const html = ['<div>', '<a href="one.md">1</a>', '<!--', 'note', '-->', '<h3>x</h3>', '</div>'];

    expect(readMarkdown(html.join('\n'))).toEqual({
      headings: [{ level: 3, line: 6 }],
      links: [{ target: 'one.md', line: 2 }],
      unread: [],
    });
  });
});

describe('readMarkdown: limits', () => {
  // The parser stops reading below 100 levels of nesting, and GitHub does not.
  it.each([
    ['quotes', `${'> '.repeat(120)}[x](missing.md)`],
    [
      'lists',
      `${Array.from({ length: 60 }, (_, depth) => `${'  '.repeat(depth)}- a`).join('\n')}\n${'  '.repeat(60)}[x](missing.md)`,
    ],
  ])('reports %s nested deeper than the parser reads', (_case, text) => {
    expect(readMarkdown(text).unread).toEqual([
      expect.objectContaining({ message: 'nesting deeper than this check reads' }),
    ]);
  });

  it('does not report ordinary nesting', () => {
    expect(readMarkdown('> - a\n>   - b\n>     > [x](other.md)').unread).toEqual([]);
  });
});
