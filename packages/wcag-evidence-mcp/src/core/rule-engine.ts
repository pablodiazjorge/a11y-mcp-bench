// The rule engine port (ADR 0004): what the core needs from the engine that runs the rules on a
// page. The engine works on the page that the browser port gives, through
// `LoadedPage.evaluateIsolated`, so its adapter never imports the browser's adapter.

import * as z from 'zod';
import type { LoadedPage } from './browser.ts';

const pixels = z.number().finite();

/** Where an element is drawn, in CSS pixels from the top left of the page, rounded. */
export const rectSchema = z
  .strictObject({
    x: pixels.describe('From the left edge of the page, in CSS pixels'),
    y: pixels.describe('From the top edge of the page, scrolled or not, in CSS pixels'),
    width: pixels.nonnegative().describe('In CSS pixels'),
    height: pixels.nonnegative().describe('In CSS pixels'),
  })
  .describe('Where the element is drawn, in whole CSS pixels from the top left of the page');

/** A color as the engine computed it, written by the server as six hex digits. */
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/);
/** The id of one of the engine's own checks, such as `has-alt`. */
export const checkIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

/**
 * What the engine measured on a failing element. Every value is a number, a color or an id that
 * the server writes, never text taken from the page.
 */
export const contrastSchema = z
  .strictObject({
    kind: z.literal('contrast'),
    ratio: z
      .number()
      .positive()
      .describe('The contrast of the text with its background, such as 2.84 for 2.84:1'),
    required: z
      .number()
      .positive()
      .describe('The contrast that the text needs: 4.5, or 3 for large text'),
    foreground: hexColor.describe('The color of the text, as #rrggbb'),
    background: hexColor.describe('The color behind the text, as #rrggbb'),
    fontSizePx: z.number().positive().describe('The size of the text, in CSS pixels'),
    bold: z.boolean().describe('Whether the text is bold, which makes 18.66 px count as large'),
  })
  .describe('Text whose contrast with its background is too low');

export const targetSizeSchema = z
  .strictObject({
    kind: z.literal('target-size'),
    width: pixels
      .nonnegative()
      .nullable()
      .describe('The width of the target, in CSS pixels, when axe-core measured it'),
    height: pixels
      .nonnegative()
      .nullable()
      .describe('The height of the target, in CSS pixels, when axe-core measured it'),
    required: pixels.positive().describe('The width and height that pass, in CSS pixels: 24'),
    offset: pixels
      .nonnegative()
      .nullable()
      .describe('The space to the nearest other target, in CSS pixels, when measured'),
    requiredOffset: pixels
      .positive()
      .nullable()
      .describe('The space that passes when the target is smaller, in CSS pixels: 24'),
  })
  .describe('A pointer target that is too small and too close to another one');

export const failedChecksSchema = z
  .strictObject({
    kind: z.literal('failed-checks'),
    checks: z
      .array(checkIdSchema)
      .min(1)
      .describe(
        "The ids of axe-core's checks that the element fails, such as has-alt and aria-label: each names one way the element could pass",
      ),
  })
  .describe('A rule without numbers to report: what the element lacks');

export const measurementSchema = z.discriminatedUnion('kind', [
  contrastSchema,
  targetSizeSchema,
  failedChecksSchema,
]);

/**
 * The tag of an element of the page that names a component, such as `app-card`. It is text of the
 * page, so only a plain custom element name passes: lowercase ASCII letters and digits in two or
 * more parts joined by hyphens, from 3 to 64 characters. The pattern has no lookahead, so that a
 * validator of JSON schemas with RE2 regular expressions can read it.
 */
const COMPONENT_TAG = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const componentTag = z.string().min(3).max(64).regex(COMPONENT_TAG);

/**
 * Whether `text` can name a component. `ng-component`, the tag that Angular gives a component
 * without a selector, names nothing that the agent could search for.
 */
export function isComponentTag(text: string): boolean {
  return componentTag.safeParse(text).success && text !== 'ng-component';
}

/** The Angular component that declares the element, as read from the page (docs/architecture.md). */
export const componentSchema = z
  .strictObject({
    tag: componentTag.describe(
      'The tag of the component to search the code for, such as app-card. Its file is not given',
    ),
    usedIn: componentTag
      .nullable()
      .describe(
        "Only with nearest-custom-element: the app's component whose template uses the tag, such as the one that holds a mat-checkbox. Null when that component has no styles to read it from",
      ),
    method: z
      .enum(['style-attribute', 'nearest-custom-element'])
      .describe(
        'style-attribute: read from the attribute that Angular adds to the elements of a component with styles, which names the component that declares the element. nearest-custom-element: the element had no such attribute, so the closest enclosing custom element is given, a guess; for content projected from a component without styles, it names the component that the content is projected into, the wrong one',
      ),
  })
  .nullable()
  .describe(
    "The Angular component that declares the element, read from the page's own elements and attributes: a hint of where to look in the code, not a file. Null when the page is not an Angular app, the element is outside every component, or the tag is not a plain custom element name, as for a component with an attribute selector such as button[mat-button]",
  );

export const engineFindingSchema = z.strictObject({
  rule: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  /** The engine's CSS selector of the element, which can hold text of the page's own code. */
  selector: z.string().min(1),
  rect: rectSchema,
  /** The element's position among the elements of the document, open shadow roots included. */
  documentIndex: z.number().int().nonnegative(),
  measurement: measurementSchema,
  component: componentSchema,
  /**
   * The element's tag and attributes, as the page wrote them, for its opening tag. The engine
   * leaves out its children and comments; the core caps the rest (ADR 0006).
   */
  element: z.strictObject({
    tag: z.string(),
    attributes: z.array(z.strictObject({ name: z.string(), value: z.string() })),
    attributeCount: z.number().int().nonnegative(),
  }),
  /** The element's accessible name, as the page wrote it, or null when the engine has none. */
  accessibleName: z.string().nullable(),
});

export type Rect = z.infer<typeof rectSchema>;
export type Measurement = z.infer<typeof measurementSchema>;
export type EngineFinding = z.infer<typeof engineFindingSchema>;
export type Component = z.infer<typeof componentSchema>;

export interface RuleEngine {
  /** The name and version of the engine, such as `axe-core 4.14.0`. */
  readonly name: string;
  /**
   * Runs `rules` on `page` and returns one entry per element and rule that fails. It throws when
   * it cannot read what the engine returned: the page could have changed it.
   */
  run(page: LoadedPage, rules: readonly string[]): Promise<readonly EngineFinding[]>;
}
