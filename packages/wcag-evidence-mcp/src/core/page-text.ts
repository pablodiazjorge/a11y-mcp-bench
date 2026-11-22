// Text that the page's own code wrote, made safe to hand to the agent (ADR 0006). Whoever controls
// a page controls this text, so it can hold instructions aimed at the agent. The output keeps it
// apart under `fromPage` keys, and this module caps it and drops what the agent does not need.

/** The most UTF-16 units of each kind of page text in the output. */
export const PAGE_TEXT_CAPS = {
  /** The accessible name, as ADR 0006 sets. */
  accessibleName: 120,
  /** One attribute value in the opening tag, as ADR 0006 sets: axe-core's own cut. */
  attributeValue: 20,
  /**
   * One attribute name in the opening tag: the longest name of HTML and ARIA,
   * `aria-brailleroledescription`, has 27, and 40 leaves room for the usual `data-` names.
   */
  attributeName: 40,
  /** The tag name in the opening tag: the same cap as the tag of a component (`rule-engine.ts`). */
  tagName: 64,
  /**
   * The whole opening tag: room for a tag and about five attributes at the cut of their values,
   * less than the 300 of axe-core's own HTML fragment.
   */
  openingTag: 200,
  /**
   * The selector: axe-core writes short selectors that are unique on the page, and 200 keeps
   * several steps of a longer one while it bounds what the page writes there.
   */
  selector: 200,
} as const;

const ELLIPSIS = '\u{2026}';

// Characters that a reader does not see: C0 and C1 controls; format characters (category Cf), such
// as the controls that reorder text when it is shown, zero-width spaces and the tag characters of
// U+E0000 to U+E007F, which map one to one onto ASCII and so can carry a hidden sentence; and the
// supplementary variation selectors, U+E0100 to U+E01EF, which can carry one too. The zero-width
// non-joiner and joiner, U+200C and U+200D, are kept: some scripts and emoji need them.
const INVISIBLE = /(?![\u{200C}\u{200D}])[\p{Cc}\p{Cf}\u{E0100}-\u{E01EF}]/gu;

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * The longest start of `text` of at most `max` UTF-16 units that ends at the end of a grapheme, the
 * unit that a reader sees as one character. An emoji, a letter with its accents or a surrogate pair
 * is never split: the result can be a little shorter than `max`.
 */
export function cutAtGrapheme(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = 0;
  for (const { index, segment } of graphemes.segment(text)) {
    if (index + segment.length > max) break;
    end = index + segment.length;
  }
  return text.slice(0, end);
}

/** `text` cut to `max` units, with an ellipsis that takes the last of them when it is cut. */
function capped(text: string, max: number): string {
  return text.length <= max ? text : `${cutAtGrapheme(text, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * `text` on one line, so that it cannot start a line that reads as a line of the output, and
 * without the characters that a reader does not see, which can hide text that the model reads and
 * a person reviewing the output does not. Runs of space become one space before the invisible
 * characters go, so that a line break between two words still parts them. A lone surrogate, half
 * of a pair and no character, becomes U+FFFD.
 */
function plain(text: string): string {
  return text
    .toWellFormed()
    .replace(/\s+/gu, ' ')
    .replace(INVISIBLE, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * The accessible name for the output: on one line, without invisible characters, and at most 120
 * units, ending in an ellipsis when it is cut.
 */
export function pageName(name: string): string {
  return capped(plain(name), PAGE_TEXT_CAPS.accessibleName);
}

export interface ElementAttributes {
  /** The element's tag, such as `img`. */
  readonly tag: string;
  /** Its attributes, in order, as the page wrote them. */
  readonly attributes: readonly { readonly name: string; readonly value: string }[];
  /** How many attributes the element has, which can be more than `attributes` holds. */
  readonly attributeCount: number;
}

// An attribute name and a tag name as HTML writes them in practice. Any other attribute name is left
// out of the tag, and any other tag name is written as `element`: the HTML parser accepts quotes and
// `=` in a tag name, which would read as attributes.
const ATTRIBUTE_NAME = /^[A-Za-z_:][\w:.-]*$/;
const TAG_NAME = /^[A-Za-z][\w:.-]*$/;
// The attributes that Angular adds for the styles of a component, such as `_ngcontent-ng-c1234`.
// Their number changes with each build, and the component of the finding already says what they
// would, so they are left out without a mark, as the identifier leaves them out of the selector.
const ANGULAR_STYLE_ATTRIBUTE = /^_ng(?:content|host)-/;

/**
 * `value` with the characters that would end it or the tag written as entities, so that the
 * opening tag reads as one tag whatever the page wrote.
 */
function escaped(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * The element's opening tag, without its children or its comments: each value cut to 20 units
 * before its entities are written, the value of an event handler (`on…`) left out since it is
 * code, names that are not plain or longer than 40 units left out, Angular's style attributes left
 * out, a tag name that is not plain written as `element`, and the whole tag at most 200 units.
 * ` …` before the end says that attributes were left out, and `…` at the end of a value that it was
 * cut.
 */
export function openingTag(element: ElementAttributes): string {
  const tagName = plain(element.tag);
  const name = TAG_NAME.test(tagName) ? capped(tagName, PAGE_TEXT_CAPS.tagName) : 'element';
  const end = '>';
  const more = ` ${ELLIPSIS}`;
  let tag = `<${name}`;
  let complete = element.attributeCount === element.attributes.length;
  for (const attribute of element.attributes) {
    if (ANGULAR_STYLE_ATTRIBUTE.test(attribute.name)) continue;
    if (
      !ATTRIBUTE_NAME.test(attribute.name) ||
      attribute.name.length > PAGE_TEXT_CAPS.attributeName
    ) {
      complete = false;
      continue;
    }
    const value = /^on/i.test(attribute.name)
      ? null
      : escaped(capped(plain(attribute.value), PAGE_TEXT_CAPS.attributeValue));
    const written =
      value === null || value === '' ? ` ${attribute.name}` : ` ${attribute.name}="${value}"`;
    if (tag.length + written.length + more.length + end.length > PAGE_TEXT_CAPS.openingTag) {
      complete = false;
      break;
    }
    tag += written;
  }
  return `${tag}${complete ? '' : more}${end}`;
}

/**
 * `selector` with each invisible character written as a CSS escape, such as `\202E `: the
 * selector still matches the element, and the character shows.
 */
function visibleSelector(selector: string): string {
  return selector
    .toWellFormed()
    .replace(
      INVISIBLE,
      (character) => `\\${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()} `,
    );
}

// A CSS escape: a backslash with up to six hex digits and the one space that may end them, as in
// `.\31 a` for the class `1a`, or with any one character, as in `\"`.
const ESCAPE = /\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|.)?/suy;

/**
 * Splits CSS selector text before each character for which `boundary` says `start`, and at each
 * for which it says `drop`, leaving that one out. Only outside brackets, parentheses, quotes and
 * escapes, so that `button[aria-label="a b"]` and `.\31 a` are not split at their spaces.
 */
function splitSelector(text: string, boundary: (character: string) => 'start' | 'drop' | null) {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const character = text.charAt(index);
    if (character === '\\') {
      ESCAPE.lastIndex = index;
      const escape = ESCAPE.exec(text)?.[0] ?? character;
      current += escape;
      index += escape.length - 1;
      continue;
    }
    if (quote !== null) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    const split = depth === 0 ? boundary(character) : null;
    if (split !== null && current !== '') parts.push(current);
    if (split !== null) current = '';
    if (split === 'drop') continue;
    if (character === '"' || character === "'") quote = character;
    else if (character === '[' || character === '(') depth += 1;
    else if (character === ']' || character === ')') depth -= 1;
    current += character;
  }
  if (current !== '') parts.push(current);
  return parts;
}

const COMBINATORS = new Set(['>', '+', '~', '>>>']);

export interface PageSelector {
  readonly selector: string;
  /** Whether only the last steps of the selector are given. */
  readonly cut: boolean;
}

/**
 * The selector for the output, at most 200 units. A longer one keeps its last steps, from a step
 * that is not a combinator: it still matches the element, though maybe others too, and the
 * rectangle tells them apart. When the last step alone is longer, it keeps the first simple
 * selectors of that step that fit, such as `button.a` of `button.a[title="…"]`, or else `*`: fewer
 * conditions on the element, which it still meets. A selector that crosses shadow roots (` >>> `)
 * and is cut can start inside one of them, and then matches from that shadow root.
 */
export function pageSelector(selector: string): PageSelector {
  // Its spaces stay as they are: they can be part of an attribute value that the selector matches.
  const clean = visibleSelector(selector);
  if (clean.length <= PAGE_TEXT_CAPS.selector) return { selector: clean, cut: false };
  const steps = splitSelector(clean, (character) => (character === ' ' ? 'drop' : null));
  let tail = '';
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index] ?? '';
    const longer = tail === '' ? step : `${step} ${tail}`;
    if (longer.length > PAGE_TEXT_CAPS.selector) break;
    tail = longer;
  }
  // A selector does not start with a combinator.
  const parts = tail.split(' ');
  while (parts.length > 0 && COMBINATORS.has(parts[0] ?? '')) parts.shift();
  const kept = parts.join(' ');
  if (kept !== '') return { selector: kept, cut: true };
  const simple = splitSelector(steps.at(-1) ?? '', (character) =>
    '.#[:'.includes(character) ? 'start' : null,
  );
  let start = '';
  for (const part of simple) {
    if (start.length + part.length > PAGE_TEXT_CAPS.selector) break;
    start += part;
  }
  return { selector: start === '' ? '*' : start, cut: true };
}
