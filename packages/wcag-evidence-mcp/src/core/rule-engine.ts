// The rule engine port (ADR 0004): what the core needs from the engine that runs the rules on a
// page. The engine works on the page that the browser port gives, through
// `LoadedPage.evaluateIsolated`, so its adapter never imports the browser's adapter.

import * as z from 'zod';
import { CLICK_EVENTS, STYLE_PROPERTIES, type LoadedPage } from './browser.ts';
import type { ElementKey } from './element-key.ts';

const pixels = z.number().finite();

/** Where an element is drawn, in CSS pixels from the top left of the page, rounded. */
export const rectSchema = z
  .strictObject({
    x: pixels.describe('From the left edge of the page, in CSS pixels'),
    y: pixels.describe('From the top edge of the page, whatever the scroll, in CSS pixels'),
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
    kind: z.literal('contrast').describe('A measurement of contrast'),
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
    kind: z.literal('target-size').describe('A measurement of the size of a target'),
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
    kind: z
      .literal('failed-checks')
      .describe('The checks that failed, for a rule with no numbers to report'),
    checks: z
      .array(checkIdSchema)
      .min(1)
      .describe(
        "The ids of axe-core's checks that the element fails, such as has-alt and aria-label: each names one way the element could pass",
      ),
  })
  .describe('A rule without numbers to report: what the element lacks');

// The measurements of the server's own keyboard checks (ADR 0007). Their values are numbers and
// the server's own names: a changed style is named, never given its value, which can be page text.

export const focusVisibleSchema = z
  .strictObject({
    kind: z
      .literal('focus-visible')
      .describe('A measurement of the focus indicator, with pixels (2.4.7)'),
    key: z.literal('Tab').describe('The key that gave the element focus'),
    focusVisible: z
      .boolean()
      .describe('Whether the element matched :focus-visible, which a key sets, once it had focus'),
    reference: z
      .enum(['load', 'leave'])
      .describe(
        'The capture without focus that the element was compared with: the page as it loaded, or, for an element outside the viewport or focused at load, the page once focus had left it',
      ),
    margin: pixels
      .nonnegative()
      .describe('How far around the element the comparison looked, in CSS pixels: 12'),
    changedPixels: z
      .number()
      .int()
      .nonnegative()
      .describe('How many pixels of the area changed with focus: none for a finding'),
    threshold: z
      .number()
      .int()
      .positive()
      .describe(
        'How much one of red, green or blue, from 0 to 255, has to differ for a pixel to count as changed: 10',
      ),
    changedProperties: z
      .array(z.enum(STYLE_PROPERTIES))
      .describe(
        'The computed styles that changed with focus, on the element, its ancestors, its ::before and ::after, and the elements within 24 px. Names only, to explain the verdict: a change that draws nothing, such as an outline in the color of the background, can be listed',
      ),
  })
  .describe('An element that Tab reaches with no visible change: no focus indicator');

export const keyboardTrapSchema = z
  .strictObject({
    kind: z.literal('keyboard-trap').describe('A cycle of keyboard focus (2.1.2)'),
    directions: z
      .array(z.enum(['forward', 'backward']))
      .min(1)
      .describe('Forward is Tab, backward is Shift+Tab'),
    stops: z.number().int().positive().describe('How many elements the cycle goes through'),
    keys: z
      .array(z.enum(['Tab', 'Shift+Tab', 'Escape']))
      .min(1)
      .describe(
        'The keys tried, in order, in each direction: the key of the direction, Escape once, and the key again, which did not leave the cycle',
      ),
  })
  .describe(
    "Focus goes round a cycle of elements without passing through the page body, and Escape does not get it out. The finding's location is the first element of the cycle in document order; the others are only counted in stops",
  );

export const focusOrderSchema = z
  .strictObject({
    kind: z.literal('focus-order').describe('A jump back in the order of Tab (2.4.3)'),
    upPx: pixels
      .nonnegative()
      .describe('How far up the element is from the one before it in the order, in CSS pixels'),
    leftPx: pixels
      .nonnegative()
      .describe('How far left the element is from the one before it in the order, in CSS pixels'),
    inversions: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'Data on the whole page, not a finding: the pairs of elements that Tab reaches in the other order than reading, by rows and then from left to right',
      ),
    pairs: z
      .number()
      .int()
      .nonnegative()
      .describe('How many pairs of elements Tab reached on the page, for inversions'),
  })
  .describe(
    'Tab went from an element to this one, above it in the same column or left of it in the same row: the order may not follow the layout',
  );

export const clickNotReachableSchema = z
  .strictObject({
    kind: z
      .literal('click-not-reachable')
      .describe('An element that responds to a click and that Tab does not reach (2.1.1)'),
    events: z
      .array(z.enum(CLICK_EVENTS))
      .min(1)
      .describe('The events that the page listens to on the element'),
    reached: z.boolean().describe('Whether Tab reached the element itself'),
    ancestorReached: z.boolean().describe('Whether Tab reached an element that contains it'),
    descendantReached: z.boolean().describe('Whether Tab reached an element inside it'),
  })
  .describe(
    'An element with a listener of a click that Tab reaches neither on it nor around it: the function may need a mouse. In a finding, reached, ancestorReached and descendantReached are all false; they show what was checked',
  );

export const measurementSchema = z.discriminatedUnion('kind', [
  contrastSchema,
  targetSizeSchema,
  failedChecksSchema,
  focusVisibleSchema,
  keyboardTrapSchema,
  focusOrderSchema,
  clickNotReachableSchema,
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

/** Where an element is, as a finding locates it: the engine's own fields of a finding. */
export const elementLocationSchema = engineFindingSchema.pick({
  selector: true,
  rect: true,
  documentIndex: true,
  component: true,
  element: true,
});

export type Rect = z.infer<typeof rectSchema>;
export type Measurement = z.infer<typeof measurementSchema>;
export type EngineFinding = z.infer<typeof engineFindingSchema>;
export type Component = z.infer<typeof componentSchema>;
export type ElementLocation = z.infer<typeof elementLocationSchema>;

export interface RuleEngine {
  /** The name and version of the engine, such as `axe-core 4.14.0`. */
  readonly name: string;
  /**
   * Runs `rules` on `page` and returns one entry per element and rule that fails. It throws when
   * it cannot read what the engine returned: the page could have changed it.
   */
  run(page: LoadedPage, rules: readonly string[]): Promise<readonly EngineFinding[]>;
  /**
   * Locates the elements of the registry of `element-key.ts` as the engine locates those of a
   * finding: null for an element that is no longer in the page. The keyboard walk asks it at each
   * stop, so the selector is that of the moment.
   */
  locate(
    page: LoadedPage,
    keys: readonly ElementKey[],
  ): Promise<readonly (ElementLocation | null)[]>;
}
