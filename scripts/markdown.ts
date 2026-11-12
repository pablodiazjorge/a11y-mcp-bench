// Reads what the repository checks need from a Markdown document, as GitHub shows it: the
// headings and the targets of the links.
//
// The Markdown is read by markdown-it, a parser that follows the CommonMark specification, as
// GitHub does. A reader written by hand for this was tried first, and every review found
// another form that it took for something else: Markdown has no short list of forms to
// accept. Raw HTML is the one part that the parser hands over as text, so this file reads
// that part itself. Where it cannot tell what GitHub would show, it reports the place.

import MarkdownIt, { type Token } from 'markdown-it';

export interface Heading {
  level: number;
  line: number;
}

export interface Link {
  /** The destination, with the characters that a URL cannot hold percent-encoded. */
  target: string;
  line: number;
}

export interface Issue {
  line: number;
  message: string;
}

export interface MarkdownDocument {
  /** Markdown headings and HTML heading tags, in the order of the document. */
  headings: Heading[];
  /** The targets of Markdown links and images and of HTML `<a>`, `<img>` and `<source>` tags. */
  links: Link[];
  /** Places where this reader cannot tell what GitHub would show. */
  unread: Issue[];
}

const parser = new MarkdownIt({ html: true });

// One piece of raw HTML: a comment, or the start of a tag with its attributes up to the
// closing `>`. Both are in one pattern, read from left to right, so that a quoted value
// cannot open a comment and a comment cannot hide a tag that comes after it.
// - A comment ends at `-->` or `--!>`, and `<!-->` and `<!--->` are whole comments, as in
//   HTML. One that never closes runs to the end.
// - A quoted attribute value can hold a `>`.
const HTML_PIECE =
  /<!--(?:-?>|[\s\S]*?(?:--!?>|$))|<([a-z][a-z0-9]*)(?=[\s/>]|$)((?:"[^"]*"|'[^']*'|[^>"'])*)/gi;
// An attribute with a double-quoted, single-quoted or bare value. The value is optional in
// the pattern so that an attribute without a readable one is still found, and reported.
const ATTRIBUTE = /(?<![\w-])(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))?/gi;
// The attribute that makes each tag load or open something. GitHub removes the other tags
// that do, such as `<video>`, and the `srcset` of an `<img>`.
const LINK_ATTRIBUTE: Record<string, string> = { a: 'href', img: 'src', source: 'srcset' };
const HEADING_TAG = /^h([1-6])$/;
// A footnote (`[^1]: text`) is a GitHub extension that the parser does not know. It reads a
// one-word note as a link definition and the second paragraph of a note as code. The
// documents of this repository do not need footnotes, so one is reported.
const FOOTNOTE = /\[\^[^\]\s]+\]:/;

const countLines = (text: string): number => text.split('\n').length - 1;

/** Reads the links and the headings of a piece of raw HTML that starts at `firstLine`. */
function readHtml(html: string, firstLine: number, document: MarkdownDocument): void {
  let line = firstLine;
  let counted = 0;
  for (const piece of html.matchAll(HTML_PIECE)) {
    line += countLines(html.slice(counted, piece.index));
    counted = piece.index;
    const tag = piece[1]?.toLowerCase();
    // A comment.
    if (tag === undefined) continue;
    const heading = HEADING_TAG.exec(tag);
    if (heading !== null) document.headings.push({ level: Number(heading[1]), line });
    const wanted = LINK_ATTRIBUTE[tag];
    if (wanted === undefined) continue;
    for (const attribute of (piece[2] ?? '').matchAll(ATTRIBUTE)) {
      if (attribute[1]?.toLowerCase() !== wanted) continue;
      const value = attribute[2] ?? attribute[3] ?? attribute[4];
      if (value === undefined) {
        document.unread.push({ line, message: 'link this check cannot read' });
      } else if (wanted === 'srcset') {
        // A list of candidates, each one a URL and an optional size.
        for (const candidate of value.split(',')) {
          const target = candidate.trim().split(/\s+/)[0] ?? '';
          if (target !== '') document.links.push({ target, line });
        }
      } else {
        document.links.push({ target: value, line });
      }
    }
  }
}

/** Reads the headings and the links of a Markdown document. */
export function readMarkdown(text: string): MarkdownDocument {
  const document: MarkdownDocument = { headings: [], links: [], unread: [] };
  // Below this depth the parser stops reading, and GitHub does not.
  const deepest = parser.options.maxNesting - 1;
  let tooDeep = false;
  const walk = (tokens: readonly Token[], firstLine: number): void => {
    let line = firstLine;
    for (const token of tokens) {
      // The parser gives the lines of a block. Inside a paragraph, the line of a link is
      // counted from the line breaks before it. A code span that goes on for several lines
      // hides its own breaks, so a link after it gets a line that is too low.
      if (token.map !== null) line = token.map[0] + 1;
      if (token.level >= deepest && !tooDeep) {
        tooDeep = true;
        document.unread.push({ line, message: 'nesting deeper than this check reads' });
      }
      if (token.type === 'heading_open') {
        document.headings.push({ level: Number(token.tag.slice(1)), line });
      } else if (token.type === 'link_open') {
        document.links.push({ target: String(token.attrGet('href') ?? ''), line });
      } else if (token.type === 'image') {
        // Its children are the alternative text, which GitHub shows as plain text.
        document.links.push({ target: String(token.attrGet('src') ?? ''), line });
      } else if (token.type === 'html_block' || token.type === 'html_inline') {
        readHtml(token.content, line, document);
        line += countLines(token.content);
      } else if (token.type === 'text' && FOOTNOTE.test(token.content)) {
        document.unread.push({ line, message: 'footnote, which this check cannot read' });
      } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
        line++;
      } else if (token.type === 'inline') {
        walk(token.children ?? [], line);
      }
    }
  };
  const environment: Record<string, unknown> = {};
  walk(parser.parse(text, environment), 1);
  // A note of one word was read as a link definition, which leaves no token behind. The
  // parser keeps the labels of the definitions, in upper case, without their lines.
  const sourceLines = text.split('\n');
  const references = environment.references;
  const labels =
    typeof references === 'object' && references !== null ? Object.keys(references) : [];
  for (const label of labels) {
    if (!label.startsWith('^')) continue;
    const at = sourceLines.findIndex((line) => line.toUpperCase().includes(`[${label}]:`));
    document.unread.push({
      line: at === -1 ? 1 : at + 1,
      message: 'footnote, which this check cannot read',
    });
  }
  return document;
}
