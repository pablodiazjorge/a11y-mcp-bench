import axe from 'axe-core';
import * as z from 'zod';
import type { LoadedPage } from '../../core/browser.ts';
import {
  engineFindingSchema,
  isComponentTag,
  type Component,
  type EngineFinding,
  type Measurement,
  type RuleEngine,
} from '../../core/rule-engine.ts';

// What the script returns. It runs in a world that the page's scripts cannot reach, but it still
// reads the page's DOM, so the adapter checks the fields that it uses and the core checks the
// findings again with strict schemas. Anything else makes the run fail.
const rawCheckSchema = z.object({ id: z.string(), data: z.unknown() });
const rawResultSchema = z.object({
  version: z.string(),
  violations: z.array(
    z.object({
      rule: z.string(),
      nodes: z.array(
        z.object({
          target: z.array(z.union([z.string(), z.array(z.string()).min(1)])).min(1),
          rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
          documentIndex: z.number(),
          checks: z.array(rawCheckSchema),
          component: z
            .object({
              tag: z.string(),
              usedIn: z.string().nullable(),
              method: z.enum(['style-attribute', 'nearest-custom-element']),
            })
            .nullable(),
          element: z.object({
            tag: z.string(),
            attributes: z.array(z.object({ name: z.string(), value: z.string() })),
            attributeCount: z.number().int().nonnegative(),
          }),
          accessibleName: z.string().nullable(),
        }),
      ),
    }),
  ),
});
type RawCheck = z.infer<typeof rawCheckSchema>;
type RawComponent = z.infer<
  typeof rawResultSchema
>['violations'][number]['nodes'][number]['component'];

const contrastDataSchema = z.object({
  fgColor: z.string(),
  bgColor: z.string(),
  contrastRatio: z.number(),
  // Such as `10.5pt (14px)`.
  fontSize: z.string().regex(/\((\d+(?:\.\d+)?)px\)$/),
  fontWeight: z.enum(['normal', 'bold']),
  // Such as `4.5:1`.
  expectedContrastRatio: z.string().regex(/^\d+(?:\.\d+)?:1$/),
});
const targetSizeDataSchema = z.object({
  minSize: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
});
const targetOffsetDataSchema = z.object({
  minOffset: z.number(),
  closestOffset: z.number().optional(),
});

// The ids of axe-core's own checks, from the installed package. A result may name only these, so
// no text of the page can pass for a check id.
const CHECK_IDS: ReadonlySet<string> = new Set(
  Object.keys(
    z.object({ _audit: z.object({ checks: z.record(z.string(), z.unknown()) }) }).parse(axe)._audit
      .checks,
  ),
);

/**
 * The part of the page script that names the Angular component that declares an element. It reads
 * the page only: the server gives the tag to search the code for, and reads no file.
 *
 * Angular adds `_ngcontent-<key>` to each element of the template of a component that has styles,
 * and `_nghost-<key>`, with the same key, to the component's own element. So an element with the
 * first attribute was declared by the component whose element has the second, even when it is drawn
 * elsewhere: projected into another component, or in an overlay hung from `<body>`. The key starts
 * with the app's id, which Angular allows to hold letters, digits, `-` and `_`, and writes in
 * lowercase. The host is looked for first among the element's ancestors, then in its shadow root,
 * then in the document, since a document search does not see into shadow roots.
 *
 * An element without the attribute belongs to a component without styles, to one that turns the
 * attribute off (`ViewEncapsulation.None`, as Angular Material does), or to code that made it by
 * hand. Then the closest enclosing custom element is given, and the component of the app that
 * uses it, through that element's own attribute. That is a guess, and the output says so.
 *
 * The guess would name a custom element on any page, so it runs only on an Angular app: one whose
 * root component carries `ng-version`, or where some element carries `_nghost-`. The second needs
 * the walk of the whole document that also numbers the elements (`hosts`). On any other page, no
 * element gets a component.
 */
const COMPONENT_SCRIPT = String.raw`
const angular = hosts || document.querySelector('[ng-version]') !== null;
const keyOf = (element) => {
  const name = element.getAttributeNames().find((each) => each.startsWith('_ngcontent-'));
  const key = name === undefined ? '' : name.slice('_ngcontent-'.length);
  return /^[a-z0-9_-]{1,64}$/.test(key) ? key : null;
};
const hostTag = (element, key) => {
  const selector = '[_nghost-' + key + ']';
  const root = element.getRootNode();
  const host =
    element.closest(selector) ??
    (root instanceof ShadowRoot ? root.querySelector(selector) : null) ??
    document.querySelector(selector);
  return host?.localName ?? null;
};
const parentOf = (element) => {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
};
const componentOf = (element) => {
  if (!angular) return null;
  const key = keyOf(element);
  const declaring = key === null ? null : hostTag(element, key);
  if (declaring !== null) return { tag: declaring, usedIn: null, method: 'style-attribute' };
  for (let parent = parentOf(element); parent; parent = parentOf(parent)) {
    if (!parent.localName.includes('-')) continue;
    const usedKey = keyOf(parent);
    const usedIn = usedKey === null ? null : hostTag(parent, usedKey);
    return { tag: parent.localName, usedIn, method: 'nearest-custom-element' };
  }
  return null;
};
`;

/**
 * The component as the script read it. A tag that is not a plain custom element name counts as no
 * tag at all, since the tag is text of the page; so does `ng-component`, the tag that Angular gives
 * a component without a selector, which names nothing to search for.
 */
function plainComponent(read: RawComponent): Component {
  if (read === null || !isComponentTag(read.tag)) return null;
  const usedIn = read.usedIn !== null && isComponentTag(read.usedIn) ? read.usedIn : null;
  return { tag: read.tag, usedIn, method: read.method };
}

/**
 * The script that runs axe-core in the page's isolated world and returns plain JSON. The rectangle
 * and the position in the document of each element are read there, from the element that axe-core
 * reports, since an element cannot leave the page.
 *
 * Frames are not audited. axe-core is loaded into the top document only, and `iframes: false`
 * keeps it from asking frames: a frame that loads its own axe-core would answer with nodes that
 * have no element in the top document, which fails the run, and asking takes longer. Auditing
 * frames would mean loading axe-core into each one, in a world of its own, and placing its findings
 * on the top page. An Angular app draws its views in the top document, so a frame holds content of
 * another app, such as a map.
 */
function pageScript(rules: readonly string[]): string {
  return `(async () => {
${axe.source}
const engine = window.axe;
const result = await engine.run(document, {
  runOnly: { type: 'rule', values: ${JSON.stringify(rules)} },
  resultTypes: ['violations'],
  iframes: false,
  elementRef: true,
});
const order = new Map();
let next = 0;
let hosts = false;
const walk = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    order.set(node, next++);
    hosts ||= node.getAttributeNames().some((name) => name.startsWith('_nghost-'));
    if (node.shadowRoot) walk(node.shadowRoot);
  }
};
walk(document);
${COMPONENT_SCRIPT}
const checks = (list) => list.map((check) => ({ id: check.id, data: check.data ?? null }));
// The page text that the server may pass on is read here, with limits on how much leaves the page;
// the server cuts it to its own caps. The opening tag reads the attributes only. The accessible name
// reads the children as a screen reader does, hidden ones and comments left out.
engine.setup(document);
const nameOf = (element) => {
  try {
    return engine.commons.text.accessibleText(element).slice(0, 1000);
  } catch {
    return null;
  }
};
const elementOf = (element) => ({
  tag: element.localName.slice(0, 100),
  attributes: Array.from(element.attributes)
    .slice(0, 64)
    .map((attribute) => ({ name: attribute.name.slice(0, 100), value: attribute.value.slice(0, 100) })),
  attributeCount: element.attributes.length,
});
const read = {
  version: engine.version,
  violations: result.violations.map((violation) => ({
    rule: violation.id,
    nodes: violation.nodes.map((node) => {
      const box = node.element.getBoundingClientRect();
      return {
        target: node.target,
        rect: { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height },
        documentIndex: order.has(node.element) ? order.get(node.element) : -1,
        checks: [...checks(node.any), ...checks(node.all), ...checks(node.none)],
        component: componentOf(node.element),
        element: elementOf(node.element),
        accessibleName: nameOf(node.element),
      };
    }),
  })),
};
engine.teardown();
return read;
})()`;
}

/** The rule engine adapter: axe-core, run inside the page that the browser port loaded. */
export function createAxeRuleEngine(): RuleEngine {
  return {
    name: `axe-core ${axe.version}`,
    async run(page: LoadedPage, rules: readonly string[]): Promise<readonly EngineFinding[]> {
      if (rules.length === 0) return [];
      const raw = rawResultSchema.parse(await page.evaluateIsolated(pageScript(rules)));
      // The script brings the pinned axe-core into a world of its own; this stays as a second guard.
      if (raw.version !== axe.version)
        throw new Error('the script ran another version of axe-core');
      for (const { nodes } of raw.violations) {
        for (const { checks } of nodes) {
          if (checks.some(({ id }) => !CHECK_IDS.has(id))) {
            throw new Error('the result names a check that axe-core does not have');
          }
        }
      }
      return raw.violations.flatMap(({ rule, nodes }) =>
        nodes.map((node) =>
          engineFindingSchema.parse({
            rule,
            // A target with more than one part goes through shadow roots.
            selector: node.target
              .map((part) => (Array.isArray(part) ? part.join(' >>> ') : part))
              .join(' >>> '),
            rect: {
              x: Math.round(node.rect.x),
              y: Math.round(node.rect.y),
              width: Math.round(node.rect.width),
              height: Math.round(node.rect.height),
            },
            documentIndex: node.documentIndex,
            measurement: measure(rule, node.checks),
            component: plainComponent(node.component),
            element: node.element,
            accessibleName: node.accessibleName,
          }),
        ),
      );
    },
  };
}

/** What a rule measured, from the data of its checks: numbers and colors, never page text. */
function measure(rule: string, checks: readonly RawCheck[]): Measurement {
  const data = (id: string): unknown => checks.find((check) => check.id === id)?.data;
  if (rule === 'color-contrast') {
    const contrast = contrastDataSchema.parse(data('color-contrast'));
    return {
      kind: 'contrast',
      ratio: contrast.contrastRatio,
      required: Number.parseFloat(contrast.expectedContrastRatio),
      foreground: contrast.fgColor,
      background: contrast.bgColor,
      fontSizePx: Number.parseFloat(/\((\d+(?:\.\d+)?)px\)$/.exec(contrast.fontSize)?.[1] ?? ''),
      bold: contrast.fontWeight === 'bold',
    };
  }
  if (rule === 'target-size') {
    const size = targetSizeDataSchema.parse(data('target-size'));
    const offset = targetOffsetDataSchema.optional().parse(data('target-offset') ?? undefined);
    return {
      kind: 'target-size',
      width: size.width ?? null,
      height: size.height ?? null,
      required: size.minSize,
      offset: offset?.closestOffset ?? null,
      requiredOffset: offset?.minOffset ?? null,
    };
  }
  return { kind: 'failed-checks', checks: [...new Set(checks.map(({ id }) => id))] };
}
