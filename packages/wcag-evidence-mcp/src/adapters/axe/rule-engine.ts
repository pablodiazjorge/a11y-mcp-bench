import axe from 'axe-core';
import * as z from 'zod';
import type { LoadedPage } from '../../core/browser.ts';
import {
  engineFindingSchema,
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
        }),
      ),
    }),
  ),
});
type RawCheck = z.infer<typeof rawCheckSchema>;

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
const walk = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    order.set(node, next++);
    if (node.shadowRoot) walk(node.shadowRoot);
  }
};
walk(document);
const checks = (list) => list.map((check) => ({ id: check.id, data: check.data ?? null }));
return {
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
      };
    }),
  })),
};
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
